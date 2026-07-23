import nacl from "tweetnacl";
import type { DiscordInteraction, Env } from "./types.js";
import { createAdminSession, listManageableDiscordRoles } from "./admin.js";
import { recordAuditEvent } from "./audit.js";
import { createVerificationSession } from "./verification.js";
import {
  addRoleRule,
  listRoleRules,
  removeRoleRule,
  syncMemberRoles,
  updateRoleMatchMode
} from "./rules.js";
import {
  auditPointsLedger,
  claimDailyPoints,
  getPointsBalance,
  getPointsLeaderboard,
  getRewardSettings,
  grantPoints
} from "./points.js";
import { brandLogoUrl, currencyIconUrl, hasBrandLogo, hasCurrencyIcon } from "./assets.js";
import { accentColorNumber, getGuildBranding } from "./branding.js";

const EPHEMERAL = 1 << 6;
const MANAGE_GUILD = 1n << 5n;
const ADMINISTRATOR = 1n << 3n;
const DISCORD_SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000;

export const discordCommands = [
  {
    name: "verify",
    description: "Link a wallet and manage holder verification.",
    integration_types: [0],
    contexts: [0],
    options: [
      { name: "panel", description: "Post a verification panel in this channel.", type: 1 },
      { name: "status", description: "Check your wallet and holder-role status.", type: 1 },
      { name: "refresh", description: "Refresh your holder roles.", type: 1 }
    ]
  },
  {
    name: "points",
    description: "View and collect community reward points.",
    integration_types: [0],
    contexts: [0],
    options: [
      { name: "claim", description: "Collect your daily points.", type: 1 },
      { name: "balance", description: "Check your current points balance.", type: 1 },
      { name: "leaderboard", description: "Show the server points leaderboard.", type: 1 },
      { name: "audit", description: "Recalculate and summarize the rewards ledger.", type: 1 },
      {
        name: "grant",
        description: "Reward points to a server member.",
        type: 1,
        options: [
          { name: "member", description: "Member receiving the reward.", type: 6, required: true },
          { name: "amount", description: "Whole number of points.", type: 4, min_value: 1, max_value: 1000000, required: true },
          { name: "reason", description: "Optional reward note.", type: 3, max_length: 200 }
        ]
      }
    ]
  },
  {
    name: "rules",
    description: "Configure holder role rules.",
    integration_types: [0],
    contexts: [0],
    default_member_permissions: MANAGE_GUILD.toString(),
    options: [
      { name: "manage", description: "Open the private holder-role manager.", type: 1 },
      {
        name: "add-nft",
        description: "Give a role for holding NFTs from an ERC-721 collection.",
        type: 1,
        options: [
          { name: "chain", description: "Chain ID, such as apechain or ethereum.", type: 3, required: true },
          { name: "contract", description: "ERC-721 collection contract address.", type: 3, required: true },
          { name: "minimum", description: "Minimum NFTs across all linked wallets.", type: 4, min_value: 1, required: true },
          { name: "role", description: "Discord role to manage.", type: 8, required: true }
        ]
      },
      {
        name: "add-token",
        description: "Give a role for holding an ERC-20 token balance.",
        type: 1,
        options: [
          { name: "chain", description: "Chain ID, such as apechain or ethereum.", type: 3, required: true },
          { name: "contract", description: "ERC-20 token contract address.", type: 3, required: true },
          { name: "minimum", description: "Minimum token amount, such as 1000 or 1.5.", type: 3, required: true },
          { name: "role", description: "Discord role to manage.", type: 8, required: true }
        ]
      },
      {
        name: "add-trait",
        description: "Give a role for an exact ERC-721 metadata trait.",
        type: 1,
        options: [
          { name: "chain", description: "Chain ID, such as apechain or ethereum.", type: 3, required: true },
          { name: "contract", description: "Enumerable ERC-721 collection contract.", type: 3, required: true },
          { name: "trait", description: "Exact metadata trait name, such as Background.", type: 3, required: true },
          { name: "value", description: "Exact metadata trait value, such as Gold.", type: 3, required: true },
          { name: "minimum", description: "Minimum matching NFTs across linked wallets.", type: 4, min_value: 1, required: true },
          { name: "role", description: "Discord role to manage.", type: 8, required: true }
        ]
      },
      {
        name: "add-nft-id",
        description: "Give a role for owning one exact ERC-721 token ID.",
        type: 1,
        options: [
          { name: "chain", description: "Chain ID, such as apechain or ethereum.", type: 3, required: true },
          { name: "contract", description: "ERC-721 collection contract address.", type: 3, required: true },
          { name: "token-id", description: "Exact ERC-721 token ID.", type: 3, required: true },
          { name: "role", description: "Discord role to manage.", type: 8, required: true }
        ]
      },
      {
        name: "add-erc1155",
        description: "Give a role for an ERC-1155 token-ID balance.",
        type: 1,
        options: [
          { name: "chain", description: "Chain ID, such as apechain or ethereum.", type: 3, required: true },
          { name: "contract", description: "ERC-1155 contract address.", type: 3, required: true },
          { name: "token-id", description: "Exact ERC-1155 token ID.", type: 3, required: true },
          { name: "minimum", description: "Minimum units across linked wallets.", type: 3, required: true },
          { name: "role", description: "Discord role to manage.", type: 8, required: true }
        ]
      },
      {
        name: "add-solana",
        description: "Give a role for holding a Solana token or exact NFT mint.",
        type: 1,
        options: [
          { name: "mint", description: "Solana token or NFT mint address.", type: 3, required: true },
          { name: "minimum", description: "Minimum amount, or 1 for an NFT mint.", type: 3, required: true },
          { name: "role", description: "Discord role to manage.", type: 8, required: true }
        ]
      },
      {
        name: "mode",
        description: "Choose whether a role needs any or all of its requirements.",
        type: 1,
        options: [
          { name: "role", description: "Discord holder role to update.", type: 8, required: true },
          {
            name: "match",
            description: "How this role's requirements are combined.",
            type: 3,
            required: true,
            choices: [
              { name: "Any requirement", value: "any" },
              { name: "All requirements", value: "all" }
            ]
          }
        ]
      },
      { name: "list", description: "List enabled holder role rules.", type: 1 },
      {
        name: "remove",
        description: "Disable a holder role rule.",
        type: 1,
        options: [
          { name: "rule-id", description: "Rule ID shown by /rules list.", type: 3, required: true }
        ]
      }
    ]
  }
];

export type DiscordSetupStatus = {
  ready: boolean;
  local: boolean;
  inviteUrl: string;
  message: string;
};

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function saveAppState(env: Env, key: string, value: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO app_state (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`
  )
    .bind(key, value)
    .run();
}

async function loadAppState(env: Env, key: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT value FROM app_state WHERE key = ?")
    .bind(key)
    .first<{ value: string }>();
  return row?.value ?? null;
}

type DiscordApplication = {
  id?: string;
  verify_key?: string;
};

async function discoverDiscordApplication(env: Env): Promise<Required<DiscordApplication>> {
  const response = await fetch("https://discord.com/api/v10/applications/@me", {
    headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` }
  });
  if (!response.ok) {
    throw new Error(`Discord credentials could not be verified (${response.status}).`);
  }

  const application = (await response.json()) as DiscordApplication;
  if (!application.id || !/^\d+$/.test(application.id)) {
    throw new Error("Discord did not return a valid application ID.");
  }
  if (!application.verify_key || !/^[0-9a-f]{64}$/i.test(application.verify_key)) {
    throw new Error("Discord did not return a valid interaction verification key.");
  }
  return { id: application.id, verify_key: application.verify_key };
}

export async function getDiscordPublicKey(env: Env): Promise<string | null> {
  return loadAppState(env, "discord_public_key");
}

export async function ensureDiscordSetup(env: Env, origin: string): Promise<DiscordSetupStatus> {
  const requestedUrl = new URL(origin);
  if (requestedUrl.protocol !== "https:") {
    return {
      ready: false,
      local: true,
      inviteUrl: "",
      message: "This is a local preview. Discord connects automatically after the app is deployed."
    };
  }

  try {
    const application = await discoverDiscordApplication(env);
    const applicationId = application.id;
    const storedApplicationId = await loadAppState(env, "discord_application_id");
    const storedPublicKey = await loadAppState(env, "discord_public_key");
    if (storedApplicationId !== applicationId) {
      await saveAppState(env, "discord_application_id", applicationId);
    }
    if (storedPublicKey !== application.verify_key) {
      await saveAppState(env, "discord_public_key", application.verify_key);
    }

    const inviteUrl = createDiscordInviteUrl(applicationId);
    const storedOrigin = await loadAppState(env, "public_origin");
    const publicOrigin = storedOrigin ?? requestedUrl.origin;
    const interactionEndpoint = new URL("/interactions", publicOrigin).toString();
    if (!storedOrigin) await saveAppState(env, "public_origin", publicOrigin);
    const fingerprint = await sha256(
      JSON.stringify({ applicationId, interactionEndpoint, commands: discordCommands })
    );
    const current = await loadAppState(env, "discord_setup_hash");
    if (current === fingerprint) {
      return { ready: true, local: false, inviteUrl, message: "Discord is connected and up to date." };
    }

    const applicationResponse = await fetch("https://discord.com/api/v10/applications/@me", {
      method: "PATCH",
      headers: {
        Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ interactions_endpoint_url: interactionEndpoint })
    });
    if (!applicationResponse.ok) {
      throw new Error(`Discord connection failed (${applicationResponse.status}).`);
    }
    const patchedApplication = (await applicationResponse.json()) as DiscordApplication;
    if (patchedApplication.id !== applicationId) {
      throw new Error("Discord returned a different application while connecting the bot.");
    }

    await registerDiscordCommands(env, applicationId);
    await saveAppState(env, "discord_setup_hash", fingerprint);
    await saveAppState(env, "commands_registered_at", new Date().toISOString());
    return { ready: true, local: false, inviteUrl, message: "Discord is connected and up to date." };
  } catch (error) {
    return {
      ready: false,
      local: false,
      inviteUrl: "",
      message: error instanceof Error ? error.message : "Discord could not be connected."
    };
  }
}

function hexToBytes(value: string): Uint8Array | null {
  if (value.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(value)) {
    return null;
  }

  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }
  return bytes;
}

export function verifyDiscordRequest(
  rawBody: string,
  signatureHex: string | null,
  timestamp: string | null,
  publicKeyHex: string
): boolean {
  if (!signatureHex || !timestamp) {
    return false;
  }

  if (!/^\d+$/.test(timestamp)) {
    return false;
  }
  const signedAtMs = Number(timestamp) * 1000;
  if (!Number.isSafeInteger(signedAtMs) || Math.abs(Date.now() - signedAtMs) > DISCORD_SIGNATURE_MAX_AGE_MS) {
    return false;
  }

  const signature = hexToBytes(signatureHex);
  const publicKey = hexToBytes(publicKeyHex);
  if (!signature || !publicKey) {
    return false;
  }

  return nacl.sign.detached.verify(
    new TextEncoder().encode(timestamp + rawBody),
    signature,
    publicKey
  );
}

function ephemeralMessage(content: string): Response {
  return Response.json({
    type: 4,
    data: {
      content,
      flags: EPHEMERAL,
      allowed_mentions: { parse: [] }
    }
  });
}

function ephemeralRewardMessage(content: string, iconUrl: string | null): Response {
  return Response.json({
    type: 4,
    data: {
      content,
      flags: EPHEMERAL,
      allowed_mentions: { parse: [] },
      ...(iconUrl ? { embeds: [{ thumbnail: { url: iconUrl } }] } : {})
    }
  });
}

function canManageGuild(interaction: DiscordInteraction): boolean {
  if (!interaction.member?.permissions) {
    return false;
  }

  const permissions = BigInt(interaction.member.permissions);
  return (permissions & MANAGE_GUILD) !== 0n || (permissions & ADMINISTRATOR) !== 0n;
}

function commandValue(interaction: DiscordInteraction, name: string): string | number | boolean | undefined {
  return interaction.data?.options?.[0]?.options?.find((option) => option.name === name)?.value;
}

async function reserveDiscordInteraction(env: Env, interactionId: string): Promise<boolean> {
  const result = await env.DB.prepare(
    "INSERT OR IGNORE INTO discord_interactions (interaction_id) VALUES (?)"
  )
    .bind(interactionId)
    .run();
  const inserted = result.meta.changes !== 0;
  if (inserted) {
    await env.DB.prepare(
      "DELETE FROM discord_interactions WHERE received_at < datetime('now', '-1 day')"
    ).run();
  }
  return inserted;
}

function formatRoleSync(summary: Awaited<ReturnType<typeof syncMemberRoles>>): string {
  const changed = summary.added.length + summary.removed.length;
  return [
    `Role refresh complete: ${summary.added.length} added, ${summary.removed.length} removed, ${summary.unchanged.length} unchanged.`,
    summary.errors.length > 0
      ? `${summary.errors.length} role check(s) could not be completed. Ask an admin to check the bot role position and RPC settings.`
      : changed === 0
        ? "Your qualifying roles were already up to date."
        : "Your Discord roles are now up to date."
  ].join("\n");
}

async function editDeferredReply(interaction: DiscordInteraction, content: string): Promise<void> {
  if (!interaction.application_id || !interaction.token) return;
  await fetch(
    `https://discord.com/api/v10/webhooks/${interaction.application_id}/${interaction.token}/messages/@original`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content })
    }
  );
}

export async function handleDiscordInteraction(
  interaction: DiscordInteraction,
  requestUrl: URL,
  env: Env,
  waitUntil?: (promise: Promise<unknown>) => void
): Promise<Response> {
  if (interaction.type === 1) {
    return Response.json({ type: 1 });
  }

  if (!/^\d{16,20}$/.test(interaction.id)) {
    return new Response("Invalid Discord interaction ID", { status: 400 });
  }
  try {
    if (!(await reserveDiscordInteraction(env, interaction.id))) {
      return ephemeralMessage(
        "Discord sent this request more than once. The first copy was already handled, so no action was repeated."
      );
    }
  } catch {
    return ephemeralMessage(
      "This request could not be processed safely right now. Please try the command again."
    );
  }

  if (interaction.type === 3 && interaction.data?.custom_id === "verify:start") {
    const discordUserId = interaction.member?.user?.id ?? interaction.user?.id;
    if (!discordUserId || !interaction.guild_id) {
      return ephemeralMessage("Wallet verification must be started from a server verification panel.");
    }

    let token: string;
    try {
      token = await createVerificationSession(env, discordUserId, interaction.guild_id);
    } catch {
      return ephemeralMessage("Wallet verification is temporarily unavailable. Please try again shortly.");
    }
    const verifyUrl = new URL("/verify", requestUrl.origin);
    verifyUrl.searchParams.set("token", token);

    return Response.json({
      type: 4,
      data: {
        content: "Your private wallet verification link is ready. It expires in 10 minutes.",
        flags: EPHEMERAL,
        components: [
          {
            type: 1,
            components: [
              {
                type: 2,
                style: 5,
                label: "Continue to Wallet",
                url: verifyUrl.toString()
              }
            ]
          }
        ]
      }
    });
  }

  if (interaction.type !== 2 || !interaction.data?.name) {
    return new Response("Unsupported interaction", { status: 400 });
  }

  const subcommand = interaction.data.options?.[0]?.name;

  if (interaction.data.name === "verify" && subcommand === "panel") {
    if (!canManageGuild(interaction)) {
      return ephemeralMessage("You need the Manage Server permission to post a verification panel.");
    }

    const branding = await getGuildBranding(env, interaction.guild_id!);
    const logoUrl = (await hasBrandLogo(env, interaction.guild_id!))
      ? brandLogoUrl(requestUrl.origin, interaction.guild_id!)
      : null;
    return Response.json({
      type: 4,
      data: {
        embeds: [
          {
            title: `${branding.name} Verification`,
            description:
              "Link your wallet to check holder roles. Verification never asks for token approvals or transactions.",
            color: accentColorNumber(branding.accentColor),
            ...(logoUrl ? { thumbnail: { url: logoUrl } } : {})
          }
        ],
        components: [
          {
            type: 1,
            components: [
              {
                type: 2,
                style: 1,
                label: "Verify Wallet",
                custom_id: "verify:start"
              }
            ]
          }
        ]
      }
    });
  }

  if (interaction.data.name === "verify" && subcommand === "status") {
    const discordUserId = interaction.member?.user?.id ?? interaction.user?.id;
    if (!discordUserId) {
      return ephemeralMessage("Your Discord account could not be identified.");
    }

    try {
      const wallets = await env.DB.prepare(
        "SELECT chain, address FROM wallets WHERE discord_user_id = ? ORDER BY created_at LIMIT 10"
      )
        .bind(discordUserId)
        .all<{ chain: string; address: string }>();
      if (wallets.results.length === 0) {
        return ephemeralMessage("No wallet is linked yet. Use this server's Verify Wallet button to begin.");
      }

      const lines = wallets.results.map(
        (wallet) => `- ${wallet.chain.toUpperCase()}: ${wallet.address.slice(0, 8)}...${wallet.address.slice(-6)}`
      );
      return ephemeralMessage(`Linked wallets:\n${lines.join("\n")}`);
    } catch {
      return ephemeralMessage("Wallet status is temporarily unavailable. Please try again shortly.");
    }
  }

  if (interaction.data.name === "verify" && subcommand === "refresh") {
    const discordUserId = interaction.member?.user?.id ?? interaction.user?.id;
    if (!discordUserId || !interaction.guild_id) {
      return ephemeralMessage("Role refresh must be run inside a Discord server.");
    }
    const refresh = async (): Promise<string> => {
      try {
        return formatRoleSync(
          await syncMemberRoles(env, interaction.guild_id!, discordUserId, {
            bypassOwnershipCache: true
          })
        );
      } catch {
        return "Role refresh is temporarily unavailable. Please try again shortly.";
      }
    };

    if (waitUntil && interaction.application_id && interaction.token) {
      waitUntil(refresh().then((content) => editDeferredReply(interaction, content)));
      return Response.json({ type: 5, data: { flags: EPHEMERAL } });
    }
    return ephemeralMessage(await refresh());
  }

  if (interaction.data.name === "points") {
    const discordUserId = interaction.member?.user?.id ?? interaction.user?.id;
    if (!discordUserId || !interaction.guild_id) {
      return ephemeralMessage("Points are available inside a Discord server.");
    }
    try {
      const iconUrl = (await hasCurrencyIcon(env, interaction.guild_id))
        ? currencyIconUrl(requestUrl.origin, interaction.guild_id)
        : null;
      if (subcommand === "grant") {
        if (!canManageGuild(interaction)) {
          return ephemeralMessage("You need the Manage Server permission to reward points.");
        }
        const targetUserId = commandValue(interaction, "member");
        if (typeof targetUserId !== "string") {
          return ephemeralMessage("Choose a server member to reward.");
        }
        const grant = await grantPoints(env, {
          guildId: interaction.guild_id,
          discordUserId: targetUserId,
          amount: commandValue(interaction, "amount"),
          grantedBy: discordUserId,
          reason: commandValue(interaction, "reason")
        });
        return ephemeralRewardMessage(
          `<@${targetUserId}> received ${grant.amount.toLocaleString()} ${grant.currencyName}. New balance: ${grant.balance.toLocaleString()}.`,
          iconUrl
        );
      }
      if (subcommand === "claim") {
        const roleSync = await syncMemberRoles(env, interaction.guild_id, discordUserId);
        if (roleSync.qualified.length === 0) {
          return ephemeralRewardMessage(
            roleSync.errors.length > 0
              ? "Your holder status could not be confirmed right now. No claim was used; please try again shortly."
              : "Link a qualifying wallet and receive a holder role before collecting the daily reward.",
            iconUrl
          );
        }
        const claim = await claimDailyPoints(env, interaction.guild_id, discordUserId);
        return ephemeralRewardMessage(
          claim.claimed
            ? `You collected ${claim.amount.toLocaleString()} ${claim.currencyName}. Balance: ${claim.balance.toLocaleString()}.`
            : `You already collected today's ${claim.currencyName}. Balance: ${claim.balance.toLocaleString()}.`,
          iconUrl
        );
      }
      if (subcommand === "balance") {
        const [balance, settings] = await Promise.all([
          getPointsBalance(env, interaction.guild_id, discordUserId),
          getRewardSettings(env, interaction.guild_id)
        ]);
        return ephemeralRewardMessage(
          `Your ${settings.currencyName} balance is ${balance.toLocaleString()}.`,
          iconUrl
        );
      }
      if (subcommand === "leaderboard") {
        const [leaderboard, settings] = await Promise.all([
          getPointsLeaderboard(env, interaction.guild_id),
          getRewardSettings(env, interaction.guild_id)
        ]);
        if (leaderboard.length === 0) {
          return ephemeralRewardMessage(`No one has collected ${settings.currencyName} yet.`, iconUrl);
        }
        const lines = leaderboard.map(
          (entry, index) => `${index + 1}. <@${entry.discordUserId}> - ${entry.balance.toLocaleString()}`
        );
        return ephemeralRewardMessage(
          `${settings.currencyName} leaderboard\n${lines.join("\n")}`,
          iconUrl
        );
      }
      if (subcommand === "audit") {
        if (!canManageGuild(interaction)) {
          return ephemeralMessage("You need the Manage Server permission to audit rewards.");
        }
        const [audit, settings] = await Promise.all([
          auditPointsLedger(env, interaction.guild_id),
          getRewardSettings(env, interaction.guild_id)
        ]);
        return ephemeralRewardMessage(
          `${settings.currencyName} ledger: ${audit.transactionCount.toLocaleString()} transactions, ${audit.memberCount.toLocaleString()} members, ${audit.netPoints.toLocaleString()} net points.`,
          iconUrl
        );
      }
    } catch {
      return ephemeralMessage(`${env.REWARD_CURRENCY_NAME} are temporarily unavailable. Please try again shortly.`);
    }
  }

  if (interaction.data.name === "rules") {
    if (!canManageGuild(interaction) || !interaction.guild_id) {
      return ephemeralMessage("You need the Manage Server permission to configure holder roles.");
    }

    try {
      if (subcommand === "manage") {
        const discordUserId = interaction.member?.user?.id ?? interaction.user?.id;
        if (!discordUserId) return ephemeralMessage("Your Discord account could not be identified.");
        const token = await createAdminSession(env, discordUserId, interaction.guild_id);
        const manageUrl = new URL("/manage", requestUrl.origin);
        manageUrl.searchParams.set("token", token);
        return Response.json({
          type: 4,
          data: {
            content: "Your private holder-role manager is ready. This link expires in 30 minutes.",
            flags: EPHEMERAL,
            components: [
              {
                type: 1,
                components: [
                  {
                    type: 2,
                    style: 5,
                    label: "Manage Holder Roles",
                    url: manageUrl.toString()
                  }
                ]
              }
            ]
          }
        });
      }

      if (
        subcommand === "add-nft" ||
        subcommand === "add-token" ||
        subcommand === "add-trait" ||
        subcommand === "add-nft-id" ||
        subcommand === "add-erc1155" ||
        subcommand === "add-solana"
      ) {
        const roleId = commandValue(interaction, "role");
        if (typeof roleId !== "string") {
          return ephemeralMessage("Choose a Discord role for this holder rule.");
        }
        const manageableRoles = await listManageableDiscordRoles(env, interaction.guild_id);
        if (!manageableRoles.some((role) => role.id === roleId)) {
          return ephemeralMessage(
            "I cannot manage that role. Move the bot's role above it in Server Settings, then try again."
          );
        }
        const type = subcommand === "add-nft"
          ? "erc721"
          : subcommand === "add-token"
            ? "erc20"
            : subcommand === "add-trait"
              ? "erc721-trait"
              : subcommand === "add-nft-id"
                ? "erc721-token"
                : subcommand === "add-erc1155"
                  ? "erc1155"
                  : "spl-token";
        const rule = await addRoleRule(env, {
          guildId: interaction.guild_id,
          roleId,
          chainId: subcommand === "add-solana" ? "solana" : commandValue(interaction, "chain"),
          type,
          contractAddress: subcommand === "add-solana"
            ? commandValue(interaction, "mint")
            : commandValue(interaction, "contract"),
          minimum: commandValue(interaction, "minimum"),
          traitName: commandValue(interaction, "trait"),
          traitValue: commandValue(interaction, "value"),
          tokenId: commandValue(interaction, "token-id")
        });
        const actorDiscordUserId = interaction.member?.user?.id ?? interaction.user?.id;
        if (actorDiscordUserId) await recordAuditEvent(env, {
          guildId: interaction.guild_id,
          actorDiscordUserId,
          action: "rule_added",
          detail: `Holder rule added for role ...${rule.roleId.slice(-6)}`
        });
        return ephemeralMessage(`Rule ${rule.id} was added for <@&${rule.roleId}> on ${rule.chainId}.`);
      }

      if (subcommand === "mode") {
        const roleId = commandValue(interaction, "role");
        const matchMode = commandValue(interaction, "match");
        const savedMode = await updateRoleMatchMode(env, interaction.guild_id, roleId, matchMode);
        const actorDiscordUserId = interaction.member?.user?.id ?? interaction.user?.id;
        if (actorDiscordUserId) await recordAuditEvent(env, {
          guildId: interaction.guild_id,
          actorDiscordUserId,
          action: "rule_updated",
          detail: `${savedMode.toUpperCase()} requirements for role ...${String(roleId).slice(-6)}`
        });
        return ephemeralMessage(
          `<@&${roleId}> now requires ${savedMode === "all" ? "all" : "any"} configured holder requirement${savedMode === "all" ? "s" : ""}.`
        );
      }

      if (subcommand === "list") {
        const rules = await listRoleRules(env, interaction.guild_id);
        if (rules.length === 0) return ephemeralMessage("This server has no enabled holder role rules.");
        const lines = rules.map((rule) => {
          let minimum: string;
          switch (rule.definition.type) {
            case "spl-token":
              minimum = `${rule.definition.minAmount} of Solana mint ${rule.definition.mintAddress}`;
              break;
            case "erc721":
              minimum = `${rule.definition.minCount} NFT(s)`;
              break;
            case "erc20":
              minimum = `${rule.definition.minAmount} token(s)`;
              break;
            case "erc721-trait":
              minimum = `${rule.definition.minCount} NFT(s) with ${rule.definition.traitName}=${rule.definition.traitValue}`;
              break;
            case "erc721-token":
              minimum = `ERC-721 token #${rule.definition.tokenId}`;
              break;
            case "erc1155":
              minimum = `${rule.definition.minAmount} unit(s) of ERC-1155 #${rule.definition.tokenId}`;
              break;
          }
          const assetAddress = rule.definition.type === "spl-token"
            ? rule.definition.mintAddress
            : rule.definition.contractAddress;
          return `- [${rule.matchMode.toUpperCase()}] ${rule.id}: <@&${rule.roleId}> for ${minimum} on ${rule.chainId} at ${assetAddress}`;
        });
        return ephemeralMessage(`Enabled holder rules:\n${lines.join("\n")}`.slice(0, 1_990));
      }

      if (subcommand === "remove") {
        const ruleId = commandValue(interaction, "rule-id");
        if (typeof ruleId !== "string") return ephemeralMessage("A rule ID is required.");
        const removed = await removeRoleRule(env, interaction.guild_id, ruleId);
        const actorDiscordUserId = interaction.member?.user?.id ?? interaction.user?.id;
        if (removed && actorDiscordUserId) await recordAuditEvent(env, {
          guildId: interaction.guild_id,
          actorDiscordUserId,
          action: "rule_removed",
          detail: `Holder rule ...${ruleId.slice(-6)} removed`
        });
        return ephemeralMessage(removed ? `Rule ${ruleId} was disabled.` : "That enabled rule was not found.");
      }
    } catch (error) {
      return ephemeralMessage(error instanceof Error ? error.message : "The holder rule could not be changed.");
    }
  }

  return ephemeralMessage("That command is not available yet.");
}

export async function registerDiscordCommands(env: Env, applicationId: string): Promise<void> {
  const response = await fetch(
    `https://discord.com/api/v10/applications/${applicationId}/commands`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(discordCommands)
    }
  );

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Discord command registration failed (${response.status}): ${details}`);
  }
}

export function createDiscordInviteUrl(applicationId: string): string {
  const permissions = 268438528;
  const inviteUrl = new URL("https://discord.com/oauth2/authorize");
  inviteUrl.searchParams.set("client_id", applicationId);
  inviteUrl.searchParams.set("scope", "bot applications.commands");
  inviteUrl.searchParams.set("permissions", permissions.toString());
  return inviteUrl.toString();
}
