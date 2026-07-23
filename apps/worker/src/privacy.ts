import type { Env } from "./types.js";

export type WalletPrivacySettings = {
  managersCanViewFullAddresses: boolean;
};

export async function getWalletPrivacySettings(
  env: Env,
  guildId: string
): Promise<WalletPrivacySettings> {
  const row = await env.DB.prepare(
    "SELECT manager_full_wallet_visibility FROM guild_settings WHERE guild_id = ?"
  )
    .bind(guildId)
    .first<{ manager_full_wallet_visibility: number }>();
  return { managersCanViewFullAddresses: row?.manager_full_wallet_visibility === 1 };
}

export async function updateWalletPrivacySettings(
  env: Env,
  guildId: string,
  enabled: unknown
): Promise<WalletPrivacySettings> {
  if (typeof enabled !== "boolean") {
    throw new Error("Choose whether managers can view full wallet addresses.");
  }
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO guilds (id, updated_at) VALUES (?, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP"
    ).bind(guildId),
    env.DB.prepare(
      `INSERT INTO guild_settings (guild_id, manager_full_wallet_visibility, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(guild_id) DO UPDATE SET
         manager_full_wallet_visibility = excluded.manager_full_wallet_visibility,
         updated_at = CURRENT_TIMESTAMP`
    ).bind(guildId, enabled ? 1 : 0)
  ]);
  return { managersCanViewFullAddresses: enabled };
}
