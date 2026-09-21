import type { Env } from "./types.js";

const MEMBER_SESSION_LIFETIME_MS = 4 * 60 * 60 * 1000;

export type MemberSession = {
  discord_user_id: string;
  guild_id: string;
  expires_at: string;
};

export class MemberSessionError extends Error {
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

export async function createMemberSession(
  env: Env,
  discordUserId: string,
  guildId: string
): Promise<string> {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + MEMBER_SESSION_LIFETIME_MS).toISOString();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO discord_users (id, updated_at) VALUES (?, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP"
    ).bind(discordUserId),
    env.DB.prepare(
      "INSERT INTO guilds (id, updated_at) VALUES (?, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP"
    ).bind(guildId),
    env.DB.prepare(
      "INSERT INTO member_sessions (id, token_hash, discord_user_id, guild_id, expires_at) VALUES (?, ?, ?, ?, ?)"
    ).bind(crypto.randomUUID(), await hashToken(token), discordUserId, guildId, expiresAt),
    env.DB.prepare("DELETE FROM member_sessions WHERE datetime(expires_at) <= CURRENT_TIMESTAMP")
  ]);
  return token;
}

export async function requireMemberSession(env: Env, token: unknown): Promise<MemberSession> {
  if (typeof token !== "string" || token.length < 32 || token.length > 128) {
    throw new MemberSessionError("This rewards link is invalid. Return to Discord and use the rewards panel again.", 401);
  }
  const session = await env.DB.prepare(
    "SELECT discord_user_id, guild_id, expires_at FROM member_sessions WHERE token_hash = ?"
  )
    .bind(await hashToken(token))
    .first<MemberSession>();
  if (!session || Date.parse(session.expires_at) <= Date.now()) {
    throw new MemberSessionError("This rewards link has expired. Return to Discord and use the rewards panel again.", 401);
  }
  return session;
}
