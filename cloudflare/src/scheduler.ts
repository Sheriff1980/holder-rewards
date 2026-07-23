import { syncMemberRoles, type RoleSyncSummary } from "./rules.js";
import type { Env } from "./types.js";

const MAX_MEMBERS_PER_RUN = 10;
const MAX_RUN_TIME_MS = 45_000;
const CURSOR_KEY = "scheduled_role_sync_cursor";

type MembershipRow = {
  guild_id: string;
  discord_user_id: string;
  cursor_value: string;
};

type StateRow = { value: string };

export type ScheduledSyncReport = {
  processed: number;
  failed: number;
  nextCursor: string;
};

type SyncMember = (
  env: Env,
  guildId: string,
  discordUserId: string
) => Promise<RoleSyncSummary>;

async function loadBatch(env: Env, cursor: string): Promise<MembershipRow[]> {
  const result = await env.DB.prepare(
    `SELECT guild_id, discord_user_id,
       guild_id || ':' || discord_user_id AS cursor_value
     FROM guild_memberships
     WHERE guild_id || ':' || discord_user_id > ?
       AND EXISTS (
         SELECT 1 FROM role_rules
         WHERE role_rules.guild_id = guild_memberships.guild_id
           AND role_rules.enabled = 1
       )
     ORDER BY guild_id, discord_user_id
     LIMIT ?`
  )
    .bind(cursor, MAX_MEMBERS_PER_RUN)
    .all<MembershipRow>();
  return result.results;
}

async function loadFailedBatch(env: Env, guildId: string): Promise<MembershipRow[]> {
  const result = await env.DB.prepare(
    `SELECT guild_id, discord_user_id,
       guild_id || ':' || discord_user_id AS cursor_value
     FROM guild_memberships
     WHERE guild_id = ?
       AND last_sync_error IS NOT NULL
     ORDER BY last_synced_at, discord_user_id
     LIMIT ?`
  )
    .bind(guildId, MAX_MEMBERS_PER_RUN)
    .all<MembershipRow>();
  return result.results;
}

function summarizeErrors(summary: RoleSyncSummary): string | null {
  if (summary.errors.length === 0) return null;
  return summary.errors
    .map((error) => `${error.roleId}: ${error.message}`)
    .join(" | ")
    .slice(0, 1_000);
}

async function recordResult(
  env: Env,
  membership: MembershipRow,
  error: string | null,
  now: string
): Promise<void> {
  await env.DB.prepare(
    `UPDATE guild_memberships
     SET last_synced_at = ?, last_sync_error = ?, updated_at = CURRENT_TIMESTAMP
     WHERE guild_id = ? AND discord_user_id = ?`
  )
    .bind(now, error, membership.guild_id, membership.discord_user_id)
    .run();
}

export async function runScheduledRoleSync(
  env: Env,
  syncMember: SyncMember = syncMemberRoles,
  now = () => Date.now()
): Promise<ScheduledSyncReport> {
  const startedAt = now();
  await env.DB.prepare("DELETE FROM ownership_cache WHERE expires_at <= CURRENT_TIMESTAMP").run();
  const state = await env.DB.prepare("SELECT value FROM app_state WHERE key = ?")
    .bind(CURSOR_KEY)
    .first<StateRow>();
  let cursor = state?.value ?? "";
  let memberships = await loadBatch(env, cursor);

  if (memberships.length === 0 && cursor) {
    cursor = "";
    memberships = await loadBatch(env, cursor);
  }

  let processed = 0;
  let failed = 0;
  for (const membership of memberships) {
    if (processed > 0 && now() - startedAt >= MAX_RUN_TIME_MS) break;
    const timestamp = new Date().toISOString();
    try {
      const summary = await syncMember(
        env,
        membership.guild_id,
        membership.discord_user_id
      );
      const error = summarizeErrors(summary);
      if (error) failed += 1;
      await recordResult(env, membership, error, timestamp);
    } catch (error) {
      failed += 1;
      await recordResult(
        env,
        membership,
        error instanceof Error ? error.message.slice(0, 1_000) : "Role sync failed.",
        timestamp
      );
    }
    processed += 1;
    cursor = membership.cursor_value;
  }

  if (processed === memberships.length && memberships.length < MAX_MEMBERS_PER_RUN) {
    cursor = "";
  }
  await env.DB.prepare(
    `INSERT INTO app_state (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`
  )
    .bind(CURSOR_KEY, cursor)
    .run();

  return { processed, failed, nextCursor: cursor };
}

export async function retryFailedRoleSyncs(
  env: Env,
  guildId: string,
  syncMember: SyncMember = syncMemberRoles
): Promise<ScheduledSyncReport> {
  const memberships = await loadFailedBatch(env, guildId);
  let processed = 0;
  let failed = 0;

  for (const membership of memberships) {
    const timestamp = new Date().toISOString();
    try {
      const summary = await syncMember(env, membership.guild_id, membership.discord_user_id);
      const error = summarizeErrors(summary);
      if (error) failed += 1;
      await recordResult(env, membership, error, timestamp);
    } catch (error) {
      failed += 1;
      await recordResult(
        env,
        membership,
        error instanceof Error ? error.message.slice(0, 1_000) : "Role sync failed.",
        timestamp
      );
    }
    processed += 1;
  }

  return { processed, failed, nextCursor: "" };
}
