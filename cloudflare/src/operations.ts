import type { Env } from "./types.js";

type CountRow = { count: number | string };
type StateRow = { value: string };

type RoleEventRow = {
  created_at: string;
  discord_user_id: string;
  role_id: string;
  action: string;
  reason: string | null;
};

type PointEventRow = {
  created_at: string;
  discord_user_id: string;
  amount: number;
  source: string;
};

type AuditEventRow = {
  created_at: string;
  actor_discord_user_id: string | null;
  subject_discord_user_id: string | null;
  action: string;
  detail: string;
};

export type GuildActivity = {
  kind: "role" | "points" | "audit";
  createdAt: string;
  discordUserId: string;
  action: string;
  detail: string;
};

export type GuildOperations = {
  verifiedMembers: number;
  linkedWallets: number;
  activeRules: number;
  syncProblems: number;
  pointTransactions: number;
  lastScheduledRun: string | null;
  activity: GuildActivity[];
};

async function count(env: Env, sql: string, guildId: string): Promise<number> {
  const row = await env.DB.prepare(sql).bind(guildId).first<CountRow>();
  const value = Number(row?.count ?? 0);
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function pointSourceLabel(source: string): string {
  if (source.startsWith("daily_claim:")) return "Daily claim";
  if (source === "admin_grant") return "Manager reward";
  return source.replaceAll("_", " ");
}

function auditActionLabel(action: string): string {
  const labels: Record<string, string> = {
    wallet_linked: "Linked wallet",
    wallet_unlinked: "Unlinked wallet",
    branding_updated: "Updated community branding",
    brand_logo_updated: "Updated community logo",
    brand_logo_removed: "Removed community logo",
    reward_settings_updated: "Updated reward settings",
    currency_icon_updated: "Updated currency image",
    currency_icon_removed: "Removed currency image",
    wallet_privacy_updated: "Updated wallet privacy",
    rule_added: "Added holder rule",
    rule_updated: "Updated holder rule",
    rule_removed: "Removed holder rule",
    custom_chain_saved: "Saved custom network"
  };
  return labels[action] ?? action.replaceAll("_", " ");
}

export async function getGuildOperations(env: Env, guildId: string): Promise<GuildOperations> {
  const [
    verifiedMembers,
    linkedWallets,
    activeRules,
    syncProblems,
    pointTransactions,
    scheduled,
    roleEvents,
    pointEvents,
    auditEvents
  ] = await Promise.all([
    count(env, "SELECT COUNT(*) AS count FROM guild_memberships WHERE guild_id = ?", guildId),
    count(
      env,
      `SELECT COUNT(DISTINCT wallets.id) AS count
       FROM wallets
       JOIN guild_memberships ON guild_memberships.discord_user_id = wallets.discord_user_id
       WHERE guild_memberships.guild_id = ?`,
      guildId
    ),
    count(env, "SELECT COUNT(*) AS count FROM role_rules WHERE guild_id = ? AND enabled = 1", guildId),
    count(
      env,
      "SELECT COUNT(*) AS count FROM guild_memberships WHERE guild_id = ? AND last_sync_error IS NOT NULL",
      guildId
    ),
    count(env, "SELECT COUNT(*) AS count FROM point_transactions WHERE guild_id = ?", guildId),
    env.DB.prepare("SELECT value FROM app_state WHERE key = 'last_scheduled_run'").first<StateRow>(),
    env.DB.prepare(
      `SELECT created_at, discord_user_id, role_id, action, reason
       FROM role_sync_events WHERE guild_id = ? ORDER BY created_at DESC LIMIT 10`
    )
      .bind(guildId)
      .all<RoleEventRow>(),
    env.DB.prepare(
      `SELECT created_at, discord_user_id, amount, source
       FROM point_transactions WHERE guild_id = ? ORDER BY created_at DESC LIMIT 10`
    )
      .bind(guildId)
      .all<PointEventRow>(),
    env.DB.prepare(
      `SELECT created_at, actor_discord_user_id, subject_discord_user_id, action, detail
       FROM audit_events WHERE guild_id = ? ORDER BY created_at DESC LIMIT 15`
    )
      .bind(guildId)
      .all<AuditEventRow>()
  ]);

  const activity: GuildActivity[] = [
    ...roleEvents.results.map((event) => ({
      kind: "role" as const,
      createdAt: event.created_at,
      discordUserId: event.discord_user_id,
      action: `${event.action === "add" ? "Added" : event.action === "remove" ? "Removed" : "Checked"} holder role`,
      detail: event.reason ?? `Role ${event.role_id}`
    })),
    ...pointEvents.results.map((event) => ({
      kind: "points" as const,
      createdAt: event.created_at,
      discordUserId: event.discord_user_id,
      action: `${event.amount >= 0 ? "+" : ""}${event.amount} points`,
      detail: pointSourceLabel(event.source)
    })),
    ...auditEvents.results.map((event) => ({
      kind: "audit" as const,
      createdAt: event.created_at,
      discordUserId: event.actor_discord_user_id ?? event.subject_discord_user_id ?? "unknown",
      action: auditActionLabel(event.action),
      detail: event.detail
    }))
  ]
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, 15);

  return {
    verifiedMembers,
    linkedWallets,
    activeRules,
    syncProblems,
    pointTransactions,
    lastScheduledRun: scheduled?.value ?? null,
    activity
  };
}
