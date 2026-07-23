import type { Env } from "./types.js";

type BrandingRow = {
  app_name: string;
  accent_color: string;
};

export type GuildBranding = {
  name: string;
  accentColor: string;
};

export class BrandingError extends Error {}

export async function getGuildBranding(env: Env, guildId: string): Promise<GuildBranding> {
  const row = await env.DB.prepare(
    "SELECT app_name, accent_color FROM guild_settings WHERE guild_id = ?"
  )
    .bind(guildId)
    .first<BrandingRow>();
  return row
    ? { name: row.app_name, accentColor: row.accent_color.toUpperCase() }
    : { name: env.APP_NAME, accentColor: "#2F80ED" };
}

export async function updateGuildBranding(
  env: Env,
  guildId: string,
  input: { name?: unknown; accentColor?: unknown }
): Promise<GuildBranding> {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (name.length < 1 || name.length > 50) {
    throw new BrandingError("Community name must be between 1 and 50 characters.");
  }
  const accentColor = typeof input.accentColor === "string" ? input.accentColor.toUpperCase() : "";
  if (!/^#[0-9A-F]{6}$/.test(accentColor)) {
    throw new BrandingError("Choose a valid accent color.");
  }
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO guilds (id, updated_at) VALUES (?, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP"
    ).bind(guildId),
    env.DB.prepare(
      `INSERT INTO guild_settings (guild_id, app_name, accent_color, updated_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(guild_id) DO UPDATE SET
         app_name = excluded.app_name,
         accent_color = excluded.accent_color,
         updated_at = CURRENT_TIMESTAMP`
    ).bind(guildId, name, accentColor)
  ]);
  return { name, accentColor };
}

export function accentColorNumber(value: string): number {
  return Number.parseInt(value.slice(1), 16);
}
