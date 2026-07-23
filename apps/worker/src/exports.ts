import { shortWalletAddress } from "./audit.js";
import type { Env } from "./types.js";

export type ExportKind = "holders" | "balances" | "wallets" | "audit";

const MAX_EXPORT_ROWS = 10_000;

function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function csv(headers: string[], rows: unknown[][]): string {
  return `\uFEFF${[headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

function exportFilename(kind: ExportKind, now = new Date()): string {
  return `holder-rewards-${kind}-${now.toISOString().slice(0, 10)}.csv`;
}

export async function buildGuildExport(
  env: Env,
  guildId: string,
  kind: ExportKind,
  managersCanViewFullAddresses: boolean
): Promise<{ filename: string; content: string }> {
  if (kind === "holders") {
    const result = await env.DB.prepare(
      `SELECT discord_user_id, created_at, last_verified_at, last_synced_at, last_sync_error
       FROM guild_memberships WHERE guild_id = ? ORDER BY created_at LIMIT ?`
    )
      .bind(guildId, MAX_EXPORT_ROWS)
      .all<Record<string, unknown>>();
    return {
      filename: exportFilename(kind),
      content: csv(
        ["discord_user_id", "joined_at", "last_verified_at", "last_synced_at", "last_sync_error"],
        result.results.map((row) => [
          row.discord_user_id,
          row.created_at,
          row.last_verified_at,
          row.last_synced_at,
          row.last_sync_error
        ])
      )
    };
  }

  if (kind === "balances") {
    const result = await env.DB.prepare(
      `SELECT discord_user_id, SUM(amount) AS balance, COUNT(*) AS transaction_count,
              MAX(created_at) AS last_transaction_at
       FROM point_transactions WHERE guild_id = ?
       GROUP BY discord_user_id ORDER BY balance DESC, discord_user_id LIMIT ?`
    )
      .bind(guildId, MAX_EXPORT_ROWS)
      .all<Record<string, unknown>>();
    return {
      filename: exportFilename(kind),
      content: csv(
        ["discord_user_id", "balance", "transaction_count", "last_transaction_at"],
        result.results.map((row) => [
          row.discord_user_id,
          row.balance,
          row.transaction_count,
          row.last_transaction_at
        ])
      )
    };
  }

  if (kind === "wallets") {
    const result = await env.DB.prepare(
      `SELECT wallets.discord_user_id, wallets.chain, wallets.address, wallets.created_at
       FROM wallets
       INNER JOIN guild_memberships
         ON guild_memberships.discord_user_id = wallets.discord_user_id
       WHERE guild_memberships.guild_id = ?
       ORDER BY wallets.created_at LIMIT ?`
    )
      .bind(guildId, MAX_EXPORT_ROWS)
      .all<Record<string, unknown>>();
    return {
      filename: exportFilename(kind),
      content: csv(
        ["discord_user_id", "chain", "wallet_address", "linked_at", "address_visibility"],
        result.results.map((row) => [
          row.discord_user_id,
          row.chain,
          managersCanViewFullAddresses
            ? row.address
            : shortWalletAddress(String(row.address ?? "")),
          row.created_at,
          managersCanViewFullAddresses ? "full" : "shortened"
        ])
      )
    };
  }

  const result = await env.DB.prepare(
    `SELECT created_at, actor_discord_user_id, subject_discord_user_id, action, detail
     FROM audit_events WHERE guild_id = ? ORDER BY created_at DESC LIMIT ?`
  )
    .bind(guildId, MAX_EXPORT_ROWS)
    .all<Record<string, unknown>>();
  return {
    filename: exportFilename(kind),
    content: csv(
      ["created_at", "actor_discord_user_id", "subject_discord_user_id", "action", "detail"],
      result.results.map((row) => [
        row.created_at,
        row.actor_discord_user_id,
        row.subject_discord_user_id,
        row.action,
        row.detail
      ])
    )
  };
}
