import { createAdminSession } from "./admin.js";
import { ensureDiscordSetup } from "./discord.js";
import type { Env } from "./types.js";

const OAUTH_STATE_LIFETIME_MS = 10 * 60 * 1000;
const HOSTED_SESSION_LIFETIME_MS = 20 * 60 * 1000;
const MANAGE_GUILD = 1n << 5n;
const ADMINISTRATOR = 1n << 3n;
const BOT_PERMISSIONS = "268438528";

type DiscordGuild = {
  id: string;
  name: string;
  icon?: string | null;
  owner?: boolean;
  permissions?: string;
};

export type HostedGuild = Pick<DiscordGuild, "id" | "name" | "icon">;

type HostedSessionRow = {
  discord_user_id: string;
  guilds_json: string;
  expires_at: string;
};

export class HostedOnboardingError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

function randomToken(byteLength = 32): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hostedConfig(env: Env): { clientSecret: string } {
  if (!env.DISCORD_CLIENT_SECRET) {
    throw new HostedOnboardingError("Hosted onboarding is not enabled on this installation.", 404);
  }
  return { clientSecret: env.DISCORD_CLIENT_SECRET };
}

async function applicationId(env: Env): Promise<string> {
  if (env.DISCORD_APPLICATION_ID && /^\d{15,22}$/.test(env.DISCORD_APPLICATION_ID)) {
    return env.DISCORD_APPLICATION_ID;
  }
  const response = await fetch("https://discord.com/api/v10/oauth2/applications/@me", {
    headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` }
  });
  if (!response.ok) throw new HostedOnboardingError("Discord could not identify the hosted bot.", 502);
  const application = await response.json() as { id?: string };
  if (!application.id) throw new HostedOnboardingError("Discord returned an incomplete bot application.", 502);
  return application.id;
}

function redirectUri(origin: string): string {
  return `${origin}/hosted/callback`;
}

export function hostedOnboardingEnabled(env: Env): boolean {
  return Boolean(env.DISCORD_CLIENT_SECRET);
}

export async function beginHostedLogin(env: Env, origin: string): Promise<string> {
  hostedConfig(env);
  const discordSetup = await ensureDiscordSetup(env, origin);
  if (!discordSetup.ready) {
    throw new HostedOnboardingError(discordSetup.message, 503);
  }
  const state = randomToken();
  await env.DB.prepare(
    "INSERT INTO hosted_oauth_states (token_hash, expires_at) VALUES (?, ?)"
  )
    .bind(await hashToken(state), new Date(Date.now() + OAUTH_STATE_LIFETIME_MS).toISOString())
    .run();
  const url = new URL("https://discord.com/oauth2/authorize");
  url.searchParams.set("client_id", await applicationId(env));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirectUri(origin));
  url.searchParams.set("scope", "identify guilds");
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "consent");
  return url.toString();
}

function canManageGuild(guild: DiscordGuild): boolean {
  if (guild.owner) return true;
  try {
    const permissions = BigInt(guild.permissions ?? "0");
    return (permissions & MANAGE_GUILD) !== 0n || (permissions & ADMINISTRATOR) !== 0n;
  } catch {
    return false;
  }
}

async function discordUserJson<T>(accessToken: string, path: string): Promise<T> {
  const response = await fetch(`https://discord.com/api/v10${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) throw new HostedOnboardingError("Discord sign-in could not load your servers.", 502);
  return response.json() as Promise<T>;
}

export async function completeHostedLogin(
  env: Env,
  origin: string,
  code: unknown,
  state: unknown
): Promise<{ token: string; expiresAt: string }> {
  const { clientSecret } = hostedConfig(env);
  if (typeof code !== "string" || typeof state !== "string" || state.length < 32) {
    throw new HostedOnboardingError("Discord sign-in was cancelled or incomplete.", 401);
  }
  const tokenHash = await hashToken(state);
  const savedState = await env.DB.prepare(
    "SELECT expires_at FROM hosted_oauth_states WHERE token_hash = ?"
  ).bind(tokenHash).first<{ expires_at: string }>();
  await env.DB.prepare("DELETE FROM hosted_oauth_states WHERE token_hash = ?").bind(tokenHash).run();
  if (!savedState || Date.parse(savedState.expires_at) <= Date.now()) {
    throw new HostedOnboardingError("This Discord sign-in has expired. Start again.", 401);
  }

  const body = new URLSearchParams({
    client_id: await applicationId(env),
    client_secret: clientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(origin)
  });
  const tokenResponse = await fetch("https://discord.com/api/v10/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  if (!tokenResponse.ok) throw new HostedOnboardingError("Discord could not complete sign-in.", 502);
  const oauth = await tokenResponse.json() as { access_token?: string };
  if (!oauth.access_token) throw new HostedOnboardingError("Discord returned an incomplete sign-in.", 502);

  const [user, guilds] = await Promise.all([
    discordUserJson<{ id: string }>(oauth.access_token, "/users/@me"),
    discordUserJson<DiscordGuild[]>(oauth.access_token, "/users/@me/guilds")
  ]);
  const manageable = guilds.filter(canManageGuild).slice(0, 200).map(({ id, name, icon }) => ({ id, name, icon }));
  const sessionToken = randomToken();
  const expiresAt = new Date(Date.now() + HOSTED_SESSION_LIFETIME_MS).toISOString();
  await env.DB.prepare(
    "INSERT INTO hosted_sessions (token_hash, discord_user_id, guilds_json, expires_at) VALUES (?, ?, ?, ?)"
  )
    .bind(await hashToken(sessionToken), user.id, JSON.stringify(manageable), expiresAt)
    .run();
  return { token: sessionToken, expiresAt };
}

export function hostedSessionCookie(token: string, maxAgeSeconds = 20 * 60): string {
  return `holder_hosted=${token}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Lax`;
}

export function readHostedCookie(request: Request): string {
  const cookie = request.headers.get("Cookie") ?? "";
  const match = /(?:^|;\s*)holder_hosted=([^;]+)/.exec(cookie);
  return match?.[1] ?? "";
}

export async function requireHostedSession(env: Env, token: unknown): Promise<{
  discordUserId: string;
  guilds: HostedGuild[];
  expiresAt: string;
}> {
  if (typeof token !== "string" || token.length < 32 || token.length > 128) {
    throw new HostedOnboardingError("Sign in with Discord to choose a community.", 401);
  }
  const row = await env.DB.prepare(
    "SELECT discord_user_id, guilds_json, expires_at FROM hosted_sessions WHERE token_hash = ?"
  ).bind(await hashToken(token)).first<HostedSessionRow>();
  if (!row || Date.parse(row.expires_at) <= Date.now()) {
    throw new HostedOnboardingError("Your hosted setup session expired. Sign in again.", 401);
  }
  let guilds: HostedGuild[];
  try {
    guilds = JSON.parse(row.guilds_json) as HostedGuild[];
  } catch {
    throw new HostedOnboardingError("Your hosted setup session is invalid. Sign in again.", 401);
  }
  return { discordUserId: row.discord_user_id, guilds, expiresAt: row.expires_at };
}

async function botIsInstalled(env: Env, guildId: string): Promise<boolean> {
  const response = await fetch(`https://discord.com/api/v10/guilds/${guildId}`, {
    headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` }
  });
  if (response.status === 403 || response.status === 404) return false;
  if (!response.ok) throw new HostedOnboardingError("Discord could not check this server right now.", 502);
  return true;
}

export async function selectHostedGuild(
  env: Env,
  sessionToken: string,
  guildId: unknown
): Promise<{ installed: boolean; guild: HostedGuild; inviteUrl?: string; manageUrl?: string }> {
  const session = await requireHostedSession(env, sessionToken);
  if (typeof guildId !== "string") throw new HostedOnboardingError("Choose a Discord server.");
  const guild = session.guilds.find((candidate) => candidate.id === guildId);
  if (!guild) throw new HostedOnboardingError("You no longer have permission to manage that server.", 403);
  if (!(await botIsInstalled(env, guild.id))) {
    const invite = new URL("https://discord.com/oauth2/authorize");
    invite.searchParams.set("client_id", await applicationId(env));
    invite.searchParams.set("scope", "bot applications.commands");
    invite.searchParams.set("permissions", BOT_PERMISSIONS);
    invite.searchParams.set("guild_id", guild.id);
    invite.searchParams.set("disable_guild_select", "true");
    return { installed: false, guild, inviteUrl: invite.toString() };
  }
  const adminToken = await createAdminSession(env, session.discordUserId, guild.id);
  return { installed: true, guild, manageUrl: `/manage?token=${encodeURIComponent(adminToken)}` };
}
