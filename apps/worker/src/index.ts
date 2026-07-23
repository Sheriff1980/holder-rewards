import {
  ensureDiscordSetup,
  getDiscordPublicKey,
  handleDiscordInteraction,
  verifyDiscordRequest
} from "./discord.js";
import { listChains, parseCustomChain, saveCustomChain } from "./chains.js";
import { managerPage, setupPage, verifyPage } from "./html.js";
import type { DiscordInteraction, Env } from "./types.js";
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
  updateRoleMatchMode,
  updateRoleRewardMultiplier
} from "./rules.js";
import { retryFailedRoleSyncs, runScheduledRoleSync } from "./scheduler.js";
import { getRewardSettings, RewardSettingsError, updateRewardSettings } from "./points.js";
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

const ruleTypes = new Set(["erc721", "erc20", "erc721-trait", "erc721-token", "erc1155", "spl-token"]);

async function managerApiResponse(request: Request, env: Env, path: string): Promise<Response> {
  try {
    const session = await requireAdminSession(env, bearerToken(request));
    if (request.method === "GET" && path === "session") {
      const [chains, roles, rules, rewards, branding, operations, privacy, hasIcon, hasLogo] = await Promise.all([
        listChains(env),
        listManageableDiscordRoles(env, session.guild_id),
        listRoleRules(env, session.guild_id),
        getRewardSettings(env, session.guild_id),
        getGuildBranding(env, session.guild_id),
        getGuildOperations(env, session.guild_id),
        getWalletPrivacySettings(env, session.guild_id),
        hasCurrencyIcon(env, session.guild_id),
        hasBrandLogo(env, session.guild_id)
      ]);
      return jsonResponse({
        expiresAt: session.expires_at,
        chains: chains.filter((chain) => chain.family === "evm" || chain.family === "solana"),
        roles,
        rules,
        rewards,
        branding,
        operations,
        privacy,
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
        type: input.type as "erc721" | "erc20" | "erc721-trait" | "erc721-token" | "erc1155" | "spl-token",
        contractAddress: input.contractAddress,
        minimum: input.minimum,
        traitName: input.traitName,
        traitValue: input.traitValue,
        tokenId: input.tokenId,
        matchMode: input.matchMode,
        rewardMultiplier: input.rewardMultiplier
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

    if (request.method === "PUT" && path === "role-multiplier") {
      const input = (await request.json()) as Record<string, unknown>;
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
    if (error instanceof SyntaxError) {
      return jsonResponse({ error: "Request body must be valid JSON." }, 400);
    }
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
      env.DB.prepare(
        "INSERT INTO app_state (key, value, updated_at) VALUES ('last_scheduled_run', ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP"
      ).bind(new Date().toISOString())
    ]);
    const origin = await env.DB.prepare("SELECT value FROM app_state WHERE key = 'public_origin'")
      .first<{ value: string }>();
    if (origin?.value) await ensureDiscordSetup(env, origin.value);
    await runScheduledRoleSync(env);
  }
} satisfies ExportedHandler<Env>;
