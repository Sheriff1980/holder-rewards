import {
  ensureDiscordSetup,
  getDiscordPublicKey,
  handleDiscordInteraction,
  verifyDiscordRequest
} from "./discord.js";
import { listChains, parseCustomChain, saveCustomChain } from "./chains.js";
import {
  IndexerConfigError,
  listIndexerConfigs,
  removeIndexerConfig,
  saveIndexerConfig
} from "./indexers.js";
import {
  checkQuest,
  createQuest,
  listPendingSubmissions,
  listQuests,
  listQuestsWithStatus,
  QuestError,
  removeQuest,
  reviewQuestSubmission,
  submitQuestCode,
  submitQuestProof
} from "./quests.js";
import {
  cancelRaffle,
  createRaffle,
  drawRaffle,
  enterRaffle,
  listRaffleEntriesForMember,
  listRaffles,
  RaffleError
} from "./raffles.js";
import {
  createStoreItem,
  listRecentPurchases,
  listStoreItems,
  listStorePurchaseCountsForMember,
  purchaseStoreItem,
  removeStoreItem,
  StoreError
} from "./store.js";
import {
  createSalesWatch,
  listSalesWatches,
  listTextChannels,
  removeSalesWatch,
  SalesWatchError
} from "./sales.js";
import { hostedOnboardingPage, managerPage, memberRewardsPage, setupPage, verifyPage } from "./html.js";
import type { DiscordInteraction, Env, RoleSyncQueueMessage } from "./types.js";
import { AdminError, listManageableDiscordRoles, requireAdminSession } from "./admin.js";
import {
  completeWalletChallenge,
  createWalletChallenge,
  getVerificationSession,
  listLinkedWallets,
  unlinkWallet,
  VerificationError
} from "./verification.js";
import {
  addRoleRule,
  listRoleRules,
  removeRoleRule,
  RuleError,
  syncMemberRoles,
  updateGroupMatchMode,
  updateRoleMatchMode,
  updateRoleRewardMultiplier
} from "./rules.js";
import { processRoleSyncQueue, retryFailedRoleSyncs, runScheduledRoleSync } from "./scheduler.js";
import { pollSalesWatches } from "./sales.js";
import { getPointsBalance, getRewardSettings, RewardSettingsError, updateRewardSettings } from "./points.js";
import {
  AssetError,
  brandLogoUrl,
  currencyIconUrl,
  getBrandLogo,
  getCurrencyIcon,
  hasCurrencyIcon,
  hasBrandLogo,
  removeBrandLogo,
  removeCurrencyIcon,
  saveBrandLogo,
  saveCurrencyIcon
} from "./assets.js";
import { BrandingError, getGuildBranding, updateGuildBranding } from "./branding.js";
import { getGuildOperations } from "./operations.js";
import { recordAuditEvent } from "./audit.js";
import { buildGuildExport, type ExportKind } from "./exports.js";
import { getWalletPrivacySettings, updateWalletPrivacySettings } from "./privacy.js";
import { checkChainProviders } from "./health.js";
import { checkLaunchReadiness } from "./readiness.js";
import { MemberSessionError, requireMemberSession } from "./member.js";
import {
  AnnouncementError,
  announceQuest,
  announceRaffle,
  announceStoreItem,
  configureQuestChannel,
  configureRewardsChannel,
  getQuestChannelSettings,
  getRewardsChannelSettings
} from "./announcements.js";
import {
  beginHostedLogin,
  completeHostedLogin,
  HostedOnboardingError,
  hostedOnboardingEnabled,
  hostedSessionCookie,
  readHostedCookie,
  requireHostedSession,
  selectHostedGuild
} from "./hosted.js";
import {
  applyDripMigration,
  DripMigrationError,
  getDripMigration,
  listDripMigrations,
  previewDripApi,
  previewDripCsv,
  rollbackDripMigration
} from "./drip-migration.js";

const securityHeaders = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY"
};

function htmlResponse(body: string): Response {
  return new Response(body, {
    headers: {
      ...securityHeaders,
      "Content-Type": "text/html; charset=utf-8"
    }
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: securityHeaders
  });
}

function privateJsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { ...securityHeaders, "Cache-Control": "private, no-store" }
  });
}

function csvResponse(filename: string, content: string): Response {
  return new Response(content, {
    headers: {
      ...securityHeaders,
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Type": "text/csv; charset=utf-8"
    }
  });
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  let difference = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);

  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return difference === 0;
}

function hasSetupAccess(request: Request, env: Env): boolean {
  if (!env.SETUP_TOKEN) return false;
  const authorization = request.headers.get("Authorization");
  const suppliedToken = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
  return constantTimeEqual(suppliedToken, env.SETUP_TOKEN);
}

function bearerToken(request: Request): string {
  const authorization = request.headers.get("Authorization");
  return authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
}

async function memberApiResponse(request: Request, env: Env, path: string): Promise<Response> {
  try {
    const session = await requireMemberSession(env, bearerToken(request));

    if (request.method === "GET" && path === "session") {
      const [branding, rewards, balance, quests, raffles, entries, storeItems, storePurchases] = await Promise.all([
        getGuildBranding(env, session.guild_id),
        getRewardSettings(env, session.guild_id),
        getPointsBalance(env, session.guild_id, session.discord_user_id),
        listQuestsWithStatus(env, session.guild_id, session.discord_user_id),
        listRaffles(env, session.guild_id),
        listRaffleEntriesForMember(env, session.guild_id, session.discord_user_id),
        listStoreItems(env, session.guild_id),
        listStorePurchaseCountsForMember(env, session.guild_id, session.discord_user_id)
      ]);
      return privateJsonResponse({
        guildId: session.guild_id,
        branding,
        rewards,
        balance,
        quests,
        raffles: raffles
          .filter((raffle) => raffle.status === "open")
          .map((raffle) => ({ ...raffle, memberEntries: entries.get(raffle.id) ?? 0 })),
        storeItems: storeItems.map((item) => ({
          ...item,
          memberPurchases: storePurchases.get(item.id) ?? 0
        }))
      });
    }

    if (request.method === "POST" && path.startsWith("quests/") && path.endsWith("/check")) {
      const questId = path.slice("quests/".length, -"/check".length);
      return privateJsonResponse(await checkQuest(env, session.guild_id, questId, session.discord_user_id));
    }

    if (request.method === "POST" && path === "quests/code") {
      const input = (await request.json()) as Record<string, unknown>;
      return privateJsonResponse(await submitQuestCode(env, session.guild_id, session.discord_user_id, input.code));
    }

    if (request.method === "POST" && path.startsWith("quests/") && path.endsWith("/proof")) {
      const questId = path.slice("quests/".length, -"/proof".length);
      const input = (await request.json()) as Record<string, unknown>;
      return privateJsonResponse(await submitQuestProof(env, session.guild_id, questId, session.discord_user_id, input.proof));
    }

    if (request.method === "POST" && path.startsWith("raffles/") && path.endsWith("/enter")) {
      const raffleId = path.slice("raffles/".length, -"/enter".length);
      const input = (await request.json()) as Record<string, unknown>;
      return privateJsonResponse(await enterRaffle(env, {
        guildId: session.guild_id,
        raffleId,
        discordUserId: session.discord_user_id,
        count: input.count
      }));
    }

    if (request.method === "POST" && path.startsWith("store/") && path.endsWith("/buy")) {
      const itemId = path.slice("store/".length, -"/buy".length);
      return privateJsonResponse(await purchaseStoreItem(env, {
        guildId: session.guild_id,
        itemId,
        discordUserId: session.discord_user_id
      }));
    }
  } catch (error) {
    if (error instanceof MemberSessionError) return privateJsonResponse({ error: error.message }, error.status);
    if (error instanceof QuestError || error instanceof RaffleError || error instanceof StoreError) {
      return privateJsonResponse({ error: error.message }, 400);
    }
    if (error instanceof SyntaxError) return privateJsonResponse({ error: "Request body must be valid JSON." }, 400);
    console.error("Member rewards request failed", { method: request.method, path, error });
    return privateJsonResponse({ error: "Community rewards are temporarily unavailable." }, 503);
  }
  return privateJsonResponse({ error: "Not found" }, 404);
}

async function healthResponse(env: Env): Promise<Response> {
  try {
    const result = await env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
    const database = result?.ok === 1;
    return jsonResponse({ ok: database, service: "worker", database }, database ? 200 : 503);
  } catch {
    return jsonResponse({ ok: false, service: "worker", database: false }, 503);
  }
}

async function interactionResponse(
  request: Request,
  env: Env,
  waitUntil?: (promise: Promise<unknown>) => void
): Promise<Response> {
  const rawBody = await request.text();
  const publicKey = await getDiscordPublicKey(env);
  if (!publicKey) {
    return new Response("Discord setup is not complete", { status: 503 });
  }
  const valid = verifyDiscordRequest(
    rawBody,
    request.headers.get("X-Signature-Ed25519"),
    request.headers.get("X-Signature-Timestamp"),
    publicKey
  );

  if (!valid) {
    return new Response("Invalid request signature", { status: 401 });
  }

  let interaction: DiscordInteraction;
  try {
    interaction = JSON.parse(rawBody) as DiscordInteraction;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  return handleDiscordInteraction(interaction, new URL(request.url), env, waitUntil);
}

async function setupResponse(request: Request, env: Env): Promise<Response> {
  if (!hasSetupAccess(request, env)) {
    return jsonResponse({ error: "Incorrect setup password." }, 403);
  }

  try {
    const status = await ensureDiscordSetup(env, new URL(request.url).origin);
    return status.ready
      ? jsonResponse({ ok: true, inviteUrl: status.inviteUrl })
      : jsonResponse({ error: status.message }, 502);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Discord setup failed.";
    return jsonResponse({ error: message }, 502);
  }
}

async function customChainResponse(request: Request, env: Env): Promise<Response> {
  if (!hasSetupAccess(request, env)) {
    return jsonResponse({ error: "Incorrect setup password." }, 403);
  }

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return jsonResponse({ error: "Request body must be valid JSON." }, 400);
  }

  if (!input || typeof input !== "object") {
    return jsonResponse({ error: "Request body must be a chain object." }, 400);
  }

  const parsed = parseCustomChain(input);
  if (!parsed.success) {
    return jsonResponse({ error: parsed.error }, 400);
  }

  try {
    await saveCustomChain(env, parsed.chain);
    return jsonResponse({ ok: true, chain: parsed.chain }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Custom chain could not be saved.";
    return jsonResponse({ error: message }, 409);
  }
}

async function verificationApiResponse(request: Request, env: Env, action: string): Promise<Response> {
  let input: Record<string, unknown>;
  try {
    input = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: "Request body must be valid JSON." }, 400);
  }

  try {
    if (action === "session") {
      const session = await getVerificationSession(env, input.sessionToken as string | null);
      const [chains, wallets, branding, hasLogo] = await Promise.all([
        listChains(env).then((items) => items.filter((chain) => chain.family === "evm" || chain.family === "solana")),
        listLinkedWallets(env, input.sessionToken),
        getGuildBranding(env, session.guildId),
        hasBrandLogo(env, session.guildId)
      ]);
      return jsonResponse({
        session,
        chains,
        wallets,
        branding,
        brandLogoUrl: hasLogo ? brandLogoUrl(new URL(request.url).origin, session.guildId) : null
      });
    }
    if (action === "challenge") {
      return jsonResponse(await createWalletChallenge(env, new URL(request.url).origin, input), 201);
    }
    if (action === "complete") {
      const linked = await completeWalletChallenge(env, input);
      let roleSync;
      try {
        roleSync = await syncMemberRoles(env, linked.guildId, linked.discordUserId);
      } catch {
        roleSync = { added: [], removed: [], unchanged: [], qualified: [], errors: [{ message: "Role sync is temporarily unavailable." }] };
      }
      return jsonResponse({
        ok: true,
        wallet: { address: linked.address, family: linked.family, chainId: linked.chainId },
        roleSync
      });
    }
    if (action === "unlink") {
      const unlinked = await unlinkWallet(env, input.sessionToken, input.walletId);
      let roleSync;
      try {
        roleSync = await syncMemberRoles(env, unlinked.guildId, unlinked.discordUserId);
      } catch {
        roleSync = { added: [], removed: [], unchanged: [], qualified: [], errors: [{ message: "Role sync is temporarily unavailable." }] };
      }
      return jsonResponse({ ok: true, roleSync });
    }
  } catch (error) {
    if (error instanceof VerificationError) {
      return jsonResponse({ error: error.message }, error.status);
    }
    return jsonResponse({ error: "Wallet verification is temporarily unavailable." }, 503);
  }

  return jsonResponse({ error: "Not found" }, 404);
}

const ruleTypes = new Set(["erc721", "erc20", "erc721-trait", "erc721-token", "erc1155", "spl-token", "solana-collection"]);

async function managerApiResponse(request: Request, env: Env, path: string): Promise<Response> {
  try {
    const session = await requireAdminSession(env, bearerToken(request));
    if (request.method === "GET" && path === "session") {
      const [chains, roles, rules, rewards, branding, operations, privacy, indexers, quests, raffles, storeItems, recentPurchases, pendingSubmissions, salesWatches, channels, rewardsChannel, questChannel, queue, hasIcon, hasLogo] = await Promise.all([
        listChains(env, { includeDemo: true }),
        listManageableDiscordRoles(env, session.guild_id),
        listRoleRules(env, session.guild_id),
        getRewardSettings(env, session.guild_id),
        getGuildBranding(env, session.guild_id),
        getGuildOperations(env, session.guild_id),
        getWalletPrivacySettings(env, session.guild_id),
        listIndexerConfigs(env),
        listQuests(env, session.guild_id),
        listRaffles(env, session.guild_id),
        listStoreItems(env, session.guild_id),
        listRecentPurchases(env, session.guild_id),
        listPendingSubmissions(env, session.guild_id),
        listSalesWatches(env, session.guild_id),
        listTextChannels(env, session.guild_id).catch(() => []),
        getRewardsChannelSettings(env, session.guild_id),
        getQuestChannelSettings(env, session.guild_id),
        env.DB.prepare("SELECT value FROM app_state WHERE key = 'last_queue_run'")
          .first<{ value: string }>()
          .then((row) => ({ enabled: Boolean(env.ROLE_SYNC_QUEUE), lastRunAt: row?.value ?? null })),
        hasCurrencyIcon(env, session.guild_id),
        hasBrandLogo(env, session.guild_id)
      ]);
      return jsonResponse({
        expiresAt: session.expires_at,
        chains: chains.filter((chain) => chain.family === "evm" || chain.family === "solana" || chain.family === "mock"),
        roles,
        rules,
        rewards,
        branding,
        operations,
        privacy,
        indexers,
        quests,
        raffles,
        storeItems,
        recentPurchases,
        pendingSubmissions,
        salesWatches,
        channels,
        rewardsChannel,
        questChannel,
        queue,
        currencyIconUrl: hasIcon
          ? `${currencyIconUrl(new URL(request.url).origin, session.guild_id)}?v=${Date.now()}`
          : null,
        brandLogoUrl: hasLogo
          ? `${brandLogoUrl(new URL(request.url).origin, session.guild_id)}?v=${Date.now()}`
          : null
      });
    }

    if (request.method === "GET" && path === "provider-health") {
      const providers = await checkChainProviders(env);
      return jsonResponse({
        ok: providers.every((provider) => provider.status === "healthy"),
        checkedAt: new Date().toISOString(),
        providers
      });
    }

    if (request.method === "GET" && path === "migrations/drip") {
      return jsonResponse({ migrations: await listDripMigrations(env, session.guild_id) });
    }

    if (request.method === "GET" && path.startsWith("migrations/drip/")) {
      const batchId = path.slice("migrations/drip/".length);
      return jsonResponse({ migration: await getDripMigration(env, session.guild_id, batchId) });
    }

    if (request.method === "POST" && path === "migrations/drip/preview") {
      const input = await request.json() as Record<string, unknown>;
      const migration = input.mode === "api"
        ? await previewDripApi(env, session.guild_id, session.discord_user_id, input)
        : await previewDripCsv(env, session.guild_id, session.discord_user_id, input);
      return jsonResponse({ ok: true, migration });
    }

    const applyMigrationMatch = /^migrations\/drip\/([^/]+)\/apply$/.exec(path);
    if (request.method === "POST" && applyMigrationMatch) {
      const migration = await applyDripMigration(
        env, session.guild_id, session.discord_user_id, applyMigrationMatch[1]!
      );
      return jsonResponse({ ok: true, migration });
    }

    const rollbackMigrationMatch = /^migrations\/drip\/([^/]+)\/rollback$/.exec(path);
    if (request.method === "POST" && rollbackMigrationMatch) {
      const migration = await rollbackDripMigration(
        env, session.guild_id, session.discord_user_id, rollbackMigrationMatch[1]!
      );
      return jsonResponse({ ok: true, migration });
    }

    if (request.method === "POST" && path === "rewards-channel") {
      const input = (await request.json()) as Record<string, unknown>;
      if (typeof input.channelId !== "string") {
        return jsonResponse({ error: "Choose a Discord channel for store and raffle posts." }, 400);
      }
      const channels = await listTextChannels(env, session.guild_id);
      if (!channels.some((channel) => channel.id === input.channelId)) {
        return jsonResponse({ error: "Choose a text channel from this Discord server." }, 400);
      }
      const rewardsChannel = await configureRewardsChannel(
        env,
        session.guild_id,
        input.channelId,
        new URL(request.url).origin
      );
      return jsonResponse({ ok: true, rewardsChannel });
    }

    if (request.method === "POST" && path === "quest-channel") {
      const input = (await request.json()) as Record<string, unknown>;
      if (typeof input.channelId !== "string") {
        return jsonResponse({ error: "Choose a Discord channel for quest posts." }, 400);
      }
      const channels = await listTextChannels(env, session.guild_id);
      if (!channels.some((channel) => channel.id === input.channelId)) {
        return jsonResponse({ error: "Choose a text channel from this Discord server." }, 400);
      }
      const questChannel = await configureQuestChannel(
        env,
        session.guild_id,
        input.channelId,
        new URL(request.url).origin
      );
      return jsonResponse({ ok: true, questChannel });
    }

    if (request.method === "POST" && path === "retry-sync-problems") {
      const report = await retryFailedRoleSyncs(env, session.guild_id);
      return jsonResponse({
        ok: report.failed === 0,
        processed: report.processed,
        failed: report.failed
      });
    }

    if (request.method === "PUT" && path === "privacy") {
      const input = (await request.json()) as Record<string, unknown>;
      if (typeof input.managersCanViewFullAddresses !== "boolean") {
        return jsonResponse({ error: "Choose whether managers can view full wallet addresses." }, 400);
      }
      const privacy = await updateWalletPrivacySettings(
        env,
        session.guild_id,
        input.managersCanViewFullAddresses
      );
      await recordAuditEvent(env, {
        guildId: session.guild_id,
        actorDiscordUserId: session.discord_user_id,
        action: "wallet_privacy_updated",
        detail: privacy.managersCanViewFullAddresses
          ? "Managers may export full wallet addresses"
          : "Manager exports use shortened wallet addresses"
      });
      return jsonResponse({ ok: true, privacy });
    }

    if (request.method === "GET" && path.startsWith("exports/")) {
      const kind = path.slice("exports/".length);
      if (!new Set(["holders", "balances", "wallets", "audit"]).has(kind)) {
        return jsonResponse({ error: "Choose an available export." }, 404);
      }
      const privacy = await getWalletPrivacySettings(env, session.guild_id);
      const exported = await buildGuildExport(
        env,
        session.guild_id,
        kind as ExportKind,
        privacy.managersCanViewFullAddresses
      );
      return csvResponse(exported.filename, exported.content);
    }

    if (request.method === "PUT" && path === "branding") {
      const input = (await request.json()) as Record<string, unknown>;
      const branding = await updateGuildBranding(env, session.guild_id, input);
      await recordAuditEvent(env, {
        guildId: session.guild_id,
        actorDiscordUserId: session.discord_user_id,
        action: "branding_updated",
        detail: "Community name and accent color"
      });
      return jsonResponse({ ok: true, branding });
    }

    if (request.method === "POST" && path === "brand-logo") {
      const form = await request.formData();
      const logo = form.get("logo");
      if (!(logo instanceof File)) return jsonResponse({ error: "Choose an image to upload." }, 400);
      await saveBrandLogo(env, session.guild_id, logo);
      await recordAuditEvent(env, {
        guildId: session.guild_id,
        actorDiscordUserId: session.discord_user_id,
        action: "brand_logo_updated",
        detail: "Community logo uploaded"
      });
      return jsonResponse({
        ok: true,
        brandLogoUrl: `${brandLogoUrl(new URL(request.url).origin, session.guild_id)}?v=${Date.now()}`
      });
    }

    if (request.method === "DELETE" && path === "brand-logo") {
      const removed = await removeBrandLogo(env, session.guild_id);
      if (removed) await recordAuditEvent(env, {
        guildId: session.guild_id,
        actorDiscordUserId: session.discord_user_id,
        action: "brand_logo_removed",
        detail: "Community logo removed"
      });
      return jsonResponse({ ok: true });
    }

    if (request.method === "POST" && path === "currency-icon") {
      const form = await request.formData();
      const icon = form.get("icon");
      if (!(icon instanceof File)) {
        return jsonResponse({ error: "Choose an image to upload." }, 400);
      }
      await saveCurrencyIcon(env, session.guild_id, icon);
      await recordAuditEvent(env, {
        guildId: session.guild_id,
        actorDiscordUserId: session.discord_user_id,
        action: "currency_icon_updated",
        detail: "Currency image uploaded"
      });
      return jsonResponse({
        ok: true,
        currencyIconUrl: `${currencyIconUrl(new URL(request.url).origin, session.guild_id)}?v=${Date.now()}`
      });
    }

    if (request.method === "DELETE" && path === "currency-icon") {
      const removed = await removeCurrencyIcon(env, session.guild_id);
      if (removed) await recordAuditEvent(env, {
        guildId: session.guild_id,
        actorDiscordUserId: session.discord_user_id,
        action: "currency_icon_removed",
        detail: "Currency image removed"
      });
      return jsonResponse({ ok: true });
    }

    if (request.method === "PUT" && path === "rewards") {
      const input = (await request.json()) as Record<string, unknown>;
      const rewards = await updateRewardSettings(env, session.guild_id, input);
      await recordAuditEvent(env, {
        guildId: session.guild_id,
        actorDiscordUserId: session.discord_user_id,
        action: "reward_settings_updated",
        detail: `Daily claim ${rewards.dailyClaimAmount}; holder reward ${rewards.holderDailyAmount}`
      });
      return jsonResponse({ ok: true, rewards });
    }

    if (request.method === "POST" && path === "chains") {
      const input = (await request.json()) as Record<string, unknown>;
      const parsed = parseCustomChain(input);
      if (!parsed.success) {
        return jsonResponse({ error: parsed.error }, 400);
      }
      await saveCustomChain(env, parsed.chain);
      await recordAuditEvent(env, {
        guildId: session.guild_id,
        actorDiscordUserId: session.discord_user_id,
        action: "custom_chain_saved",
        detail: `${parsed.chain.name} (${parsed.chain.chainReference})`
      });
      return jsonResponse({ ok: true, chain: parsed.chain }, 201);
    }

    if (request.method === "PUT" && path === "chain-indexer") {
      const input = (await request.json()) as Record<string, unknown>;
      const indexer = await saveIndexerConfig(env, { chainId: input.chainId, url: input.url });
      await recordAuditEvent(env, {
        guildId: session.guild_id,
        actorDiscordUserId: session.discord_user_id,
        action: "indexer_config_saved",
        detail: `Indexer configured for ${indexer.chainId}`
      });
      return jsonResponse({ ok: true, indexer });
    }

    if (request.method === "DELETE" && path === "chain-indexer") {
      const input = (await request.json()) as Record<string, unknown>;
      const removed = await removeIndexerConfig(env, input.chainId);
      if (removed) await recordAuditEvent(env, {
        guildId: session.guild_id,
        actorDiscordUserId: session.discord_user_id,
        action: "indexer_config_removed",
        detail: `Indexer removed for ${String(input.chainId)}`
      });
      return removed
        ? jsonResponse({ ok: true })
        : jsonResponse({ error: "That chain has no indexer configured." }, 404);
    }

    if (request.method === "POST" && path === "rules") {
      const input = (await request.json()) as Record<string, unknown>;
      if (typeof input.type !== "string" || !ruleTypes.has(input.type)) {
        return jsonResponse({ error: "Choose a holder requirement." }, 400);
      }
      const roles = await listManageableDiscordRoles(env, session.guild_id);
      if (!roles.some((role) => role.id === input.roleId)) {
        return jsonResponse({ error: "Choose a role below the bot's role in Discord." }, 400);
      }
      const rule = await addRoleRule(env, {
        guildId: session.guild_id,
        roleId: input.roleId,
        chainId: input.chainId,
        type: input.type as "erc721" | "erc20" | "erc721-trait" | "erc721-token" | "erc1155" | "spl-token" | "solana-collection",
        contractAddress: input.contractAddress,
        minimum: input.minimum,
        traitName: input.traitName,
        traitValue: input.traitValue,
        tokenId: input.tokenId,
        matchMode: input.matchMode,
        rewardMultiplier: input.rewardMultiplier,
        groupKey: input.groupKey,
        groupMatchMode: input.groupMatchMode
      });
      await recordAuditEvent(env, {
        guildId: session.guild_id,
        actorDiscordUserId: session.discord_user_id,
        action: "rule_added",
        detail: `Holder rule added for role ...${rule.roleId.slice(-6)}`
      });
      return jsonResponse({ ok: true, rule }, 201);
    }

    if (request.method === "PUT" && path === "rule-mode") {
      const input = (await request.json()) as Record<string, unknown>;
      const roles = await listManageableDiscordRoles(env, session.guild_id);
      if (!roles.some((role) => role.id === input.roleId)) {
        return jsonResponse({ error: "Choose a role below the bot's role in Discord." }, 400);
      }
      const matchMode = await updateRoleMatchMode(
        env,
        session.guild_id,
        input.roleId,
        input.matchMode
      );
      await recordAuditEvent(env, {
        guildId: session.guild_id,
        actorDiscordUserId: session.discord_user_id,
        action: "rule_updated",
        detail: `${matchMode.toUpperCase()} requirements for role ...${String(input.roleId).slice(-6)}`
      });
      return jsonResponse({ ok: true, roleId: input.roleId, matchMode });
    }

    if (request.method === "PUT" && path === "group-mode") {
      const input = (await request.json()) as Record<string, unknown>;
      const roles = await listManageableDiscordRoles(env, session.guild_id);
      if (!roles.some((role) => role.id === input.roleId)) {
        return jsonResponse({ error: "Choose a role below the bot's role in Discord." }, 400);
      }
      const saved = await updateGroupMatchMode(env, session.guild_id, input.roleId, input.groupKey, input.matchMode);
      await recordAuditEvent(env, {
        guildId: session.guild_id,
        actorDiscordUserId: session.discord_user_id,
        action: "rule_updated",
        detail: `${saved.matchMode.toUpperCase()} requirements for group "${saved.groupKey || "Main"}" on role ...${String(input.roleId).slice(-6)}`
      });
      return jsonResponse({ ok: true, roleId: input.roleId, groupKey: saved.groupKey, matchMode: saved.matchMode });
    }

    if (request.method === "PUT" && path === "role-multiplier") {      const input = (await request.json()) as Record<string, unknown>;
      const roles = await listManageableDiscordRoles(env, session.guild_id);
      if (!roles.some((role) => role.id === input.roleId)) {
        return jsonResponse({ error: "Choose a role below the bot's role in Discord." }, 400);
      }
      const rewardMultiplier = await updateRoleRewardMultiplier(
        env,
        session.guild_id,
        input.roleId,
        input.rewardMultiplier
      );
      await recordAuditEvent(env, {
        guildId: session.guild_id,
        actorDiscordUserId: session.discord_user_id,
        action: "reward_settings_updated",
        detail: `Holder role multiplier updated to ${rewardMultiplier}x`
      });
      return jsonResponse({ ok: true, roleId: input.roleId, rewardMultiplier });
    }

    if (request.method === "DELETE" && path.startsWith("rules/")) {
      const ruleId = path.slice("rules/".length);
      const removed = await removeRoleRule(env, session.guild_id, ruleId);
      if (removed) await recordAuditEvent(env, {
        guildId: session.guild_id,
        actorDiscordUserId: session.discord_user_id,
        action: "rule_removed",
        detail: `Holder rule ...${ruleId.slice(-6)} removed`
      });
      return removed
        ? jsonResponse({ ok: true })
        : jsonResponse({ error: "That holder rule was already removed." }, 404);
    }

    if (request.method === "POST" && path === "quests") {
      const input = (await request.json()) as Record<string, unknown>;
      if (input.kind === "hold_role") {
        const roles = await listManageableDiscordRoles(env, session.guild_id);
        if (!roles.some((role) => role.id === input.roleId)) {
          return jsonResponse({ error: "Choose a role below the bot's role in Discord." }, 400);
        }
      }
      const quest = await createQuest(env, {
        guildId: session.guild_id,
        title: input.title,
        kind: input.kind,
        reward: input.reward,
        roleId: input.roleId,
        days: input.days,
        code: input.code,
        instructions: input.instructions
      });
      await recordAuditEvent(env, {
        guildId: session.guild_id,
        actorDiscordUserId: session.discord_user_id,
        action: "quest_created",
        detail: `Quest "${quest.title}" (${quest.kind}, ${quest.reward} points)`
      });
      let announcementWarning: string | null = null;
      let announcementPosted = false;
      try {
        announcementPosted = await announceQuest(
          env,
          session.guild_id,
          new URL(request.url).origin,
          quest
        );
      } catch (error) {
        announcementWarning = error instanceof Error ? error.message : "The quest announcement could not be posted.";
      }
      return jsonResponse({ ok: true, quest, announcementPosted, announcementWarning }, 201);
    }

    if (request.method === "DELETE" && path.startsWith("quests/")) {
      const questId = path.slice("quests/".length);
      const removed = await removeQuest(env, session.guild_id, questId);
      if (removed) await recordAuditEvent(env, {
        guildId: session.guild_id,
        actorDiscordUserId: session.discord_user_id,
        action: "quest_removed",
        detail: `Quest ...${questId.slice(-6)} removed`
      });
      return removed
        ? jsonResponse({ ok: true })
        : jsonResponse({ error: "That quest was already removed." }, 404);
    }

    if (
      request.method === "POST" &&
      path.startsWith("quest-submissions/") &&
      (path.endsWith("/approve") || path.endsWith("/reject"))
    ) {
      const approve = path.endsWith("/approve");
      const submissionId = path.slice(
        "quest-submissions/".length,
        -(approve ? "/approve" : "/reject").length
      );
      const { submission, result } = await reviewQuestSubmission(env, {
        guildId: session.guild_id,
        submissionId,
        reviewerId: session.discord_user_id,
        approve
      });
      await recordAuditEvent(env, {
        guildId: session.guild_id,
        actorDiscordUserId: session.discord_user_id,
        action: approve ? "quest_submission_approved" : "quest_submission_rejected",
        detail: `"${submission.questTitle}" proof from member ...${submission.discordUserId.slice(-6)} ${result}`
      });
      return jsonResponse({ ok: true, result });
    }

    if (request.method === "POST" && path === "raffles") {
      const input = (await request.json()) as Record<string, unknown>;
      if (typeof input.prizeRoleId === "string" && input.prizeRoleId.length > 0) {
        const roles = await listManageableDiscordRoles(env, session.guild_id);
        if (!roles.some((role) => role.id === input.prizeRoleId)) {
          return jsonResponse({ error: "Choose a prize role below the bot's role in Discord." }, 400);
        }
      }
      const raffle = await createRaffle(env, {
        guildId: session.guild_id,
        title: input.title,
        prize: input.prize,
        prizeRoleId: input.prizeRoleId,
        entryCost: input.entryCost,
        maxEntriesPerMember: input.maxEntriesPerMember,
        createdBy: session.discord_user_id
      });
      await recordAuditEvent(env, {
        guildId: session.guild_id,
        actorDiscordUserId: session.discord_user_id,
        action: "raffle_created",
        detail: `Raffle "${raffle.title}" (${raffle.entryCost} points per entry)`
      });
      let announcementWarning: string | null = null;
      let announcementPosted = false;
      try {
        announcementPosted = await announceRaffle(env, session.guild_id, new URL(request.url).origin, raffle);
      } catch (error) {
        announcementWarning = error instanceof Error ? error.message : "The raffle announcement could not be posted.";
      }
      return jsonResponse({ ok: true, raffle, announcementPosted, announcementWarning }, 201);
    }

    if (request.method === "POST" && path.startsWith("raffles/") && path.endsWith("/draw")) {
      const raffleId = path.slice("raffles/".length, -"/draw".length);
      const result = await drawRaffle(env, { guildId: session.guild_id, raffleId });
      await recordAuditEvent(env, {
        guildId: session.guild_id,
        actorDiscordUserId: session.discord_user_id,
        action: "raffle_drawn",
        detail: `Raffle "${result.raffle.title}" drawn; winner ...${result.winnerDiscordUserId.slice(-6)}`
      });
      return jsonResponse(result);
    }

    if (request.method === "POST" && path.startsWith("raffles/") && path.endsWith("/cancel")) {
      const raffleId = path.slice("raffles/".length, -"/cancel".length);
      const result = await cancelRaffle(env, { guildId: session.guild_id, raffleId });
      await recordAuditEvent(env, {
        guildId: session.guild_id,
        actorDiscordUserId: session.discord_user_id,
        action: "raffle_cancelled",
        detail: `Raffle "${result.raffle.title}" cancelled; ${result.refundedPoints} points refunded to ${result.refundedMembers} member(s)`
      });
      return jsonResponse(result);
    }

    if (request.method === "POST" && path === "store-items") {
      const input = (await request.json()) as Record<string, unknown>;
      if (typeof input.roleId === "string" && input.roleId.length > 0) {
        const roles = await listManageableDiscordRoles(env, session.guild_id);
        if (!roles.some((role) => role.id === input.roleId)) {
          return jsonResponse({ error: "Choose a store role below the bot's role in Discord." }, 400);
        }
      }
      const item = await createStoreItem(env, {
        guildId: session.guild_id,
        title: input.title,
        description: input.description,
        price: input.price,
        roleId: input.roleId,
        stock: input.stock,
        purchaseLimitPerMember: input.purchaseLimitPerMember
      });
      await recordAuditEvent(env, {
        guildId: session.guild_id,
        actorDiscordUserId: session.discord_user_id,
        action: "store_item_created",
        detail: `Store item "${item.title}" (${item.price} points)`
      });
      let announcementWarning: string | null = null;
      let announcementPosted = false;
      try {
        announcementPosted = await announceStoreItem(env, session.guild_id, new URL(request.url).origin, item);
      } catch (error) {
        announcementWarning = error instanceof Error ? error.message : "The store announcement could not be posted.";
      }
      return jsonResponse({ ok: true, item, announcementPosted, announcementWarning }, 201);
    }

    if (request.method === "DELETE" && path.startsWith("store-items/")) {
      const itemId = path.slice("store-items/".length);
      const removed = await removeStoreItem(env, session.guild_id, itemId);
      if (removed) await recordAuditEvent(env, {
        guildId: session.guild_id,
        actorDiscordUserId: session.discord_user_id,
        action: "store_item_removed",
        detail: `Store item ...${itemId.slice(-6)} removed`
      });
      return removed
        ? jsonResponse({ ok: true })
        : jsonResponse({ error: "That store item was already removed." }, 404);
    }

    if (request.method === "POST" && path === "sales-watches") {
      const input = (await request.json()) as Record<string, unknown>;
      const watch = await createSalesWatch(env, {
        guildId: session.guild_id,
        chainId: input.chainId,
        contractAddress: input.contractAddress,
        channelId: input.channelId,
        createdBy: session.discord_user_id
      });
      await recordAuditEvent(env, {
        guildId: session.guild_id,
        actorDiscordUserId: session.discord_user_id,
        action: "sales_watch_created",
        detail: `Sales watch for ${watch.contractAddress.slice(0, 10)}... on ${watch.chainId}`
      });
      return jsonResponse({ ok: true, watch }, 201);
    }

    if (request.method === "DELETE" && path.startsWith("sales-watches/")) {
      const watchId = path.slice("sales-watches/".length);
      const removed = await removeSalesWatch(env, session.guild_id, watchId);
      if (removed) await recordAuditEvent(env, {
        guildId: session.guild_id,
        actorDiscordUserId: session.discord_user_id,
        action: "sales_watch_removed",
        detail: `Sales watch ...${watchId.slice(-6)} removed`
      });
      return removed
        ? jsonResponse({ ok: true })
        : jsonResponse({ error: "That sales watch was already removed." }, 404);
    }
  } catch (error) {
    if (error instanceof AdminError || error instanceof RuleError) {
      return jsonResponse({ error: error.message }, error.status);
    }
    if (error instanceof RewardSettingsError) {
      return jsonResponse({ error: error.message }, 400);
    }
    if (error instanceof AssetError) {
      return jsonResponse({ error: error.message }, error.status);
    }
    if (error instanceof BrandingError) {
      return jsonResponse({ error: error.message }, 400);
    }
    if (error instanceof IndexerConfigError) {
      return jsonResponse({ error: error.message }, 400);
    }
    if (error instanceof QuestError) {
      return jsonResponse({ error: error.message }, 400);
    }
    if (error instanceof RaffleError) {
      return jsonResponse({ error: error.message }, 400);
    }
    if (error instanceof StoreError) {
      return jsonResponse({ error: error.message }, 400);
    }
    if (error instanceof SalesWatchError) {
      return jsonResponse({ error: error.message }, 400);
    }
    if (error instanceof AnnouncementError) {
      return jsonResponse({ error: error.message }, 400);
    }
    if (error instanceof DripMigrationError) {
      return jsonResponse({ error: error.message }, 400);
    }
    if (error instanceof SyntaxError) {
      return jsonResponse({ error: "Request body must be valid JSON." }, 400);
    }
    console.error("Admin request failed", {
      method: request.method,
      path,
      error
    });
    return jsonResponse({ error: "The holder-role manager is temporarily unavailable." }, 503);
  }
  return jsonResponse({ error: "Not found" }, 404);
}

export async function handleRequest(
  request: Request,
  env: Env,
  waitUntil?: (promise: Promise<unknown>) => void
): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/") {
    return htmlResponse(setupPage(env, await ensureDiscordSetup(env, url.origin), Boolean(env.SETUP_TOKEN)));
  }

  if (request.method === "GET" && url.pathname === "/hosted") {
    if (!hostedOnboardingEnabled(env)) return jsonResponse({ error: "Hosted onboarding is not enabled." }, 404);
    return htmlResponse(hostedOnboardingPage(env));
  }

  if (request.method === "GET" && url.pathname === "/hosted/login") {
    try {
      return Response.redirect(await beginHostedLogin(env, url.origin), 302);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Discord sign-in could not start.";
      return Response.redirect(`${url.origin}/hosted?error=${encodeURIComponent(message)}`, 302);
    }
  }

  if (request.method === "GET" && url.pathname === "/hosted/callback") {
    try {
      const session = await completeHostedLogin(
        env, url.origin, url.searchParams.get("code"), url.searchParams.get("state")
      );
      return new Response(null, {
        status: 302,
        headers: { Location: `${url.origin}/hosted`, "Set-Cookie": hostedSessionCookie(session.token), ...securityHeaders }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Discord sign-in could not finish.";
      return Response.redirect(`${url.origin}/hosted?error=${encodeURIComponent(message)}`, 302);
    }
  }

  if (url.pathname.startsWith("/api/hosted/")) {
    try {
      const token = readHostedCookie(request);
      if (request.method === "GET" && url.pathname === "/api/hosted/session") {
        const session = await requireHostedSession(env, token);
        return privateJsonResponse({ guilds: session.guilds, expiresAt: session.expiresAt });
      }
      if (request.method === "POST" && url.pathname === "/api/hosted/select") {
        const input = await request.json() as { guildId?: unknown };
        return privateJsonResponse(await selectHostedGuild(env, token, input.guildId));
      }
      return privateJsonResponse({ error: "Not found" }, 404);
    } catch (error) {
      if (error instanceof HostedOnboardingError) return privateJsonResponse({ error: error.message }, error.status);
      if (error instanceof SyntaxError) return privateJsonResponse({ error: "Request body must be valid JSON." }, 400);
      console.error("Hosted onboarding failed", error);
      return privateJsonResponse({ error: "Hosted setup is temporarily unavailable." }, 503);
    }
  }

  if (request.method === "GET" && url.pathname === "/health") {
    return healthResponse(env);
  }

  if (request.method === "GET" && url.pathname === "/api/setup/readiness") {
    return jsonResponse(await checkLaunchReadiness(env, url.origin));
  }

  if (request.method === "GET" && url.pathname === "/favicon.ico") {
    return new Response(null, { status: 204 });
  }

  if (request.method === "GET" && url.pathname.startsWith("/assets/currency/")) {
    const guildId = url.pathname.slice("/assets/currency/".length);
    if (!/^[0-9]{15,22}$/.test(guildId)) return new Response("Not found", { status: 404 });
    const icon = await getCurrencyIcon(env, guildId);
    if (!icon) return new Response("Not found", { status: 404 });
    return new Response(icon.data, {
      headers: {
        "Content-Type": icon.content_type,
        "Cache-Control": "public, max-age=300",
        "X-Content-Type-Options": "nosniff"
      }
    });
  }

  if (request.method === "GET" && url.pathname.startsWith("/assets/brand/")) {
    const guildId = url.pathname.slice("/assets/brand/".length);
    if (!/^[0-9]{15,22}$/.test(guildId)) return new Response("Not found", { status: 404 });
    const logo = await getBrandLogo(env, guildId);
    if (!logo) return new Response("Not found", { status: 404 });
    return new Response(logo.data, {
      headers: {
        "Content-Type": logo.content_type,
        "Cache-Control": "public, max-age=300",
        "X-Content-Type-Options": "nosniff"
      }
    });
  }

  if (request.method === "GET" && url.pathname === "/verify") {
    return htmlResponse(verifyPage(env, request.url));
  }

  if (request.method === "GET" && url.pathname === "/rewards") {
    return htmlResponse(memberRewardsPage(env));
  }

  if (request.method === "GET" && url.pathname === "/manage") {
    return htmlResponse(managerPage(env));
  }

  if (request.method === "GET" && url.pathname === "/api/chains") {
    try {
      return jsonResponse({ chains: await listChains(env) });
    } catch {
      return jsonResponse({ error: "Chain registry is unavailable." }, 503);
    }
  }

  if (request.method === "POST" && url.pathname === "/interactions") {
    return interactionResponse(request, env, waitUntil);
  }

  if (request.method === "POST" && url.pathname === "/api/setup/register") {
    return setupResponse(request, env);
  }

  if (request.method === "POST" && url.pathname === "/api/setup/chains") {
    return customChainResponse(request, env);
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/verify/")) {
    return verificationApiResponse(request, env, url.pathname.slice("/api/verify/".length));
  }

  if (url.pathname.startsWith("/api/admin/")) {
    return managerApiResponse(request, env, url.pathname.slice("/api/admin/".length));
  }

  if (url.pathname.startsWith("/api/member/")) {
    return memberApiResponse(request, env, url.pathname.slice("/api/member/".length));
  }

  return jsonResponse({ error: "Not found" }, 404);
}

export default {
  fetch(request: Request, env: Env, context: ExecutionContext): Promise<Response> {
    return handleRequest(request, env, (promise) => context.waitUntil(promise));
  },
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM verification_sessions WHERE expires_at <= ?").bind(
        new Date().toISOString()
      ),
      env.DB.prepare("DELETE FROM nft_metadata_cache WHERE expires_at <= ?").bind(
        new Date().toISOString()
      ),
      env.DB.prepare("DELETE FROM admin_sessions WHERE expires_at <= ?").bind(
        new Date().toISOString()
      ),
      env.DB.prepare("DELETE FROM hosted_oauth_states WHERE expires_at <= ?").bind(
        new Date().toISOString()
      ),
      env.DB.prepare("DELETE FROM hosted_sessions WHERE expires_at <= ?").bind(
        new Date().toISOString()
      ),
      env.DB.prepare("DELETE FROM migration_batches WHERE status = 'preview' AND created_at <= ?").bind(
        new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
      ),
      env.DB.prepare(
        "INSERT INTO app_state (key, value, updated_at) VALUES ('last_scheduled_run', ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP"
      ).bind(new Date().toISOString())
    ]);
    const origin = await env.DB.prepare("SELECT value FROM app_state WHERE key = 'public_origin'")
      .first<{ value: string }>();
    if (origin?.value) await ensureDiscordSetup(env, origin.value);
    await runScheduledRoleSync(env);
    try {
      await pollSalesWatches(env);
    } catch (error) {
      console.error("Sales watch poll failed", error);
    }
  },
  async queue(batch: MessageBatch<RoleSyncQueueMessage>, env: Env): Promise<void> {
    await processRoleSyncQueue(env, batch);
  }
} satisfies ExportedHandler<Env, RoleSyncQueueMessage>;
