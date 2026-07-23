import type { Env } from "./types.js";

const ADMIN_SESSION_LIFETIME_MS = 30 * 60 * 1000;

type AdminSessionRow = {
  discord_user_id: string;
  guild_id: string;
  expires_at: string;
};

type DiscordRole = {
  id: string;
  name: string;
  color: number;
  position: number;
  managed: boolean;
};

export type ManageableDiscordRole = Pick<DiscordRole, "id" | "name" | "color" | "position">;

export class AdminError extends Error {
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

export async function createAdminSession(
  env: Env,
  discordUserId: string,
  guildId: string
): Promise<string> {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + ADMIN_SESSION_LIFETIME_MS).toISOString();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO discord_users (id, updated_at) VALUES (?, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP"
    ).bind(discordUserId),
    env.DB.prepare(
      "INSERT INTO guilds (id, updated_at) VALUES (?, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP"
    ).bind(guildId),
    env.DB.prepare(
      "INSERT INTO admin_sessions (id, token_hash, discord_user_id, guild_id, expires_at) VALUES (?, ?, ?, ?, ?)"
    ).bind(crypto.randomUUID(), await hashToken(token), discordUserId, guildId, expiresAt)
  ]);
  return token;
}

export async function requireAdminSession(env: Env, token: unknown): Promise<AdminSessionRow> {
  if (typeof token !== "string" || token.length < 32 || token.length > 128) {
    throw new AdminError("This manager link is invalid or incomplete.", 401);
  }
  const session = await env.DB.prepare(
    "SELECT discord_user_id, guild_id, expires_at FROM admin_sessions WHERE token_hash = ?"
  )
    .bind(await hashToken(token))
    .first<AdminSessionRow>();
  if (!session || Date.parse(session.expires_at) <= Date.now()) {
    throw new AdminError("This manager link has expired. Return to Discord and use /rules manage again.", 401);
  }
  return session;
}

async function discordJson<T>(env: Env, path: string): Promise<T> {
  const response = await fetch(`https://discord.com/api/v10${path}`, {
    headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` }
  });
  if (!response.ok) {
    throw new AdminError(`Discord could not load server roles (${response.status}).`, 502);
  }
  return response.json() as Promise<T>;
}

export async function listManageableDiscordRoles(
  env: Env,
  guildId: string
): Promise<ManageableDiscordRole[]> {
  const [roles, botUser] = await Promise.all([
    discordJson<DiscordRole[]>(env, `/guilds/${guildId}/roles`),
    discordJson<{ id: string }>(env, "/users/@me")
  ]);
  const botMember = await discordJson<{ roles?: string[] }>(
    env,
    `/guilds/${guildId}/members/${botUser.id}`
  );
  const botRoleIds = new Set(botMember.roles ?? []);
  const highestBotPosition = roles.reduce(
    (highest, role) => (botRoleIds.has(role.id) ? Math.max(highest, role.position) : highest),
    0
  );

  return roles
    .filter(
      (role) =>
        role.id !== guildId &&
        !role.managed &&
        role.position < highestBotPosition
    )
    .sort((left, right) => right.position - left.position)
    .map(({ id, name, color, position }) => ({ id, name, color, position }));
}
