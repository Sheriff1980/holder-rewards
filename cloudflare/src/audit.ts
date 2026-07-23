import type { Env } from "./types.js";

export type AuditAction =
  | "wallet_linked"
  | "wallet_unlinked"
  | "branding_updated"
  | "brand_logo_updated"
  | "brand_logo_removed"
  | "reward_settings_updated"
  | "currency_icon_updated"
  | "currency_icon_removed"
  | "wallet_privacy_updated"
  | "rule_added"
  | "rule_updated"
  | "rule_removed"
  | "custom_chain_saved";

export async function recordAuditEvent(
  env: Env,
  event: {
    guildId: string;
    actorDiscordUserId?: string;
    subjectDiscordUserId?: string;
    action: AuditAction;
    detail: string;
  }
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO audit_events
      (id, guild_id, actor_discord_user_id, subject_discord_user_id, action, detail)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(
      crypto.randomUUID(),
      event.guildId,
      event.actorDiscordUserId ?? null,
      event.subjectDiscordUserId ?? null,
      event.action,
      event.detail.slice(0, 300)
    )
    .run();
}

export function shortWalletAddress(address: string): string {
  return address.length > 16 ? `${address.slice(0, 8)}...${address.slice(-6)}` : address;
}
