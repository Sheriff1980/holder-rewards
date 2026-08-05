import { parse } from "csv-parse/sync";
import { recordAuditEvent } from "./audit.js";
import { getRewardSettings } from "./points.js";
import type { Env } from "./types.js";

const MAX_IMPORT_ROWS = 10_000;
const MAX_CSV_BYTES = 5 * 1024 * 1024;
const WRITE_BATCH_SIZE = 75;

type PreviewRecord = {
  discordUserId?: string;
  balance?: unknown;
  note?: string;
};

type MigrationBatchRow = {
  id: string;
  guild_id: string;
  source: "drip_api" | "drip_csv";
  status: "preview" | "applied" | "rolled_back";
  source_currency: string;
  target_currency: string;
  conversion_ratio: string;
  created_by: string;
  row_count: number;
  matched_count: number;
  skipped_count: number;
  source_total: number;
  import_total: number;
  created_at: string;
  applied_at: string | null;
  rolled_back_at: string | null;
};

type MigrationRow = {
  row_number: number;
  discord_user_id: string | null;
  source_balance: number | null;
  import_amount: number | null;
  status: "ready" | "skipped" | "imported" | "rolled_back";
  note: string | null;
};

type DripCredential = {
  format?: string;
  publicIdentifier?: string;
  oauthProvider?: string;
  oauthAccountId?: string;
};

type DripBalance = {
  balance?: unknown;
  currencyId?: string;
  currencyName?: string;
  realmPoint?: { id?: string; name?: string };
};

type DripMember = {
  credentials?: DripCredential[];
  balances?: DripBalance[];
  pointBalances?: DripBalance[];
};

export type MigrationBatch = {
  id: string;
  source: "drip_api" | "drip_csv";
  status: "preview" | "applied" | "rolled_back";
  sourceCurrency: string;
  targetCurrency: string;
  conversionRatio: string;
  rowCount: number;
  matchedCount: number;
  skippedCount: number;
  sourceTotal: number;
  importTotal: number;
  createdAt: string;
  appliedAt: string | null;
  rolledBackAt: string | null;
};

export type MigrationPreview = MigrationBatch & {
  rows: Array<{
    discordUserId: string | null;
    sourceBalance: number | null;
    importAmount: number | null;
    status: string;
    note: string | null;
  }>;
};

export class DripMigrationError extends Error {}

function validDiscordId(value: unknown): string | undefined {
  const id = typeof value === "string" ? value.trim() : String(value ?? "").trim();
  return /^\d{15,22}$/.test(id) ? id : undefined;
}

function wholeBalance(value: unknown): number | undefined {
  if (value === "" || value === null || value === undefined) return undefined;
  const balance = Number(value);
  return Number.isSafeInteger(balance) && balance >= 0 && balance <= 9_000_000_000_000_000
    ? balance
    : undefined;
}

function conversionRatio(value: unknown): { value: number; text: string } {
  const ratio = Number(value ?? 1);
  if (!Number.isFinite(ratio) || ratio <= 0 || ratio > 1_000) {
    throw new DripMigrationError("Conversion ratio must be greater than 0 and no more than 1,000.");
  }
  const text = ratio.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  return { value: ratio, text };
}

function importedAmount(balance: number, ratio: number): number | undefined {
  const amount = Math.round(balance * ratio);
  return Number.isSafeInteger(amount) && amount >= 0 && amount <= 9_000_000_000_000_000
    ? amount
    : undefined;
}

function publicBatch(row: MigrationBatchRow): MigrationBatch {
  return {
    id: row.id,
    source: row.source,
    status: row.status,
    sourceCurrency: row.source_currency,
    targetCurrency: row.target_currency,
    conversionRatio: row.conversion_ratio,
    rowCount: Number(row.row_count),
    matchedCount: Number(row.matched_count),
    skippedCount: Number(row.skipped_count),
    sourceTotal: Number(row.source_total),
    importTotal: Number(row.import_total),
    createdAt: row.created_at,
    appliedAt: row.applied_at,
    rolledBackAt: row.rolled_back_at
  };
}

async function runInChunks(env: Env, statements: D1PreparedStatement[]): Promise<void> {
  for (let offset = 0; offset < statements.length; offset += WRITE_BATCH_SIZE) {
    await env.DB.batch(statements.slice(offset, offset + WRITE_BATCH_SIZE));
  }
}

async function createPreview(
  env: Env,
  input: {
    guildId: string;
    createdBy: string;
    source: "drip_api" | "drip_csv";
    sourceCurrency: string;
    ratio: unknown;
    records: PreviewRecord[];
  }
): Promise<MigrationPreview> {
  if (input.records.length === 0) throw new DripMigrationError("No Drip balances were found.");
  if (input.records.length > MAX_IMPORT_ROWS) {
    throw new DripMigrationError(`A migration can contain at most ${MAX_IMPORT_ROWS.toLocaleString()} rows.`);
  }
  const ratio = conversionRatio(input.ratio);
  const targetCurrency = (await getRewardSettings(env, input.guildId)).currencyName;
  const aggregated = new Map<string, { balance: number; count: number }>();
  const skipped: MigrationRow[] = [];

  input.records.forEach((record, index) => {
    const discordUserId = validDiscordId(record.discordUserId);
    const balance = wholeBalance(record.balance);
    if (!discordUserId || balance === undefined) {
      skipped.push({
        row_number: index + 1,
        discord_user_id: discordUserId ?? null,
        source_balance: balance ?? null,
        import_amount: null,
        status: "skipped",
        note: record.note ?? (!discordUserId ? "Missing or invalid Discord user ID." : "Balance must be a non-negative whole number.")
      });
      return;
    }
    const current = aggregated.get(discordUserId) ?? { balance: 0, count: 0 };
    const total = current.balance + balance;
    if (!Number.isSafeInteger(total)) {
      skipped.push({
        row_number: index + 1,
        discord_user_id: discordUserId,
        source_balance: balance,
        import_amount: null,
        status: "skipped",
        note: "Combined balance is too large to import safely."
      });
      return;
    }
    aggregated.set(discordUserId, { balance: total, count: current.count + 1 });
  });

  const ready: MigrationRow[] = [];
  let nextRow = input.records.length + 1;
  for (const [discordUserId, value] of aggregated) {
    const amount = importedAmount(value.balance, ratio.value);
    if (amount === undefined) {
      skipped.push({
        row_number: nextRow++, discord_user_id: discordUserId, source_balance: value.balance,
        import_amount: null, status: "skipped", note: "Converted balance is too large to import safely."
      });
      continue;
    }
    ready.push({
      row_number: nextRow++,
      discord_user_id: discordUserId,
      source_balance: value.balance,
      import_amount: amount,
      status: amount > 0 ? "ready" : "skipped",
      note: amount === 0 ? "Zero balance; no ledger entry is needed." : value.count > 1 ? `Combined ${value.count} duplicate rows.` : null
    });
  }

  const importable = ready.filter((row) => row.status === "ready");
  if (importable.length === 0) {
    throw new DripMigrationError("No positive balances with valid Discord user IDs were found.");
  }
  const allRows = [...ready, ...skipped];
  let sourceTotal = 0;
  let importTotal = 0;
  for (const row of importable) {
    sourceTotal += row.source_balance ?? 0;
    importTotal += row.import_amount ?? 0;
    if (!Number.isSafeInteger(sourceTotal) || !Number.isSafeInteger(importTotal)) {
      throw new DripMigrationError("The migration total is too large to import safely in one batch.");
    }
  }
  const batchId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO migration_batches
      (id, guild_id, source, source_currency, target_currency, conversion_ratio, created_by,
       row_count, matched_count, skipped_count, source_total, import_total)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    batchId, input.guildId, input.source, input.sourceCurrency.slice(0, 64), targetCurrency,
    ratio.text, input.createdBy, input.records.length, importable.length,
    allRows.filter((row) => row.status === "skipped").length, sourceTotal, importTotal
  ).run();
  await runInChunks(env, allRows.map((row) => env.DB.prepare(
    `INSERT INTO migration_rows
      (batch_id, row_number, discord_user_id, source_balance, import_amount, status, note)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    batchId, row.row_number, row.discord_user_id, row.source_balance, row.import_amount, row.status, row.note
  )));
  return getDripMigration(env, input.guildId, batchId);
}

function csvValue(record: Record<string, unknown>, names: string[]): unknown {
  for (const name of names) {
    const key = Object.keys(record).find((candidate) => candidate.trim().toLowerCase() === name);
    if (key !== undefined) return record[key];
  }
  return undefined;
}

export async function previewDripCsv(
  env: Env,
  guildId: string,
  createdBy: string,
  input: { csv?: unknown; sourceCurrency?: unknown; ratio?: unknown }
): Promise<MigrationPreview> {
  if (typeof input.csv !== "string" || input.csv.length === 0) {
    throw new DripMigrationError("Choose a Drip CSV file first.");
  }
  if (new TextEncoder().encode(input.csv).byteLength > MAX_CSV_BYTES) {
    throw new DripMigrationError("The CSV file must be 5 MB or smaller.");
  }
  const sourceCurrency = typeof input.sourceCurrency === "string" ? input.sourceCurrency.trim() : "";
  if (!sourceCurrency || sourceCurrency.length > 64) throw new DripMigrationError("Enter the Drip currency name.");
  let parsed: Record<string, unknown>[];
  try {
    parsed = parse(input.csv, { columns: true, bom: true, skip_empty_lines: true, trim: true, relax_column_count: false });
  } catch {
    throw new DripMigrationError("The CSV could not be read. Use a header row with discord_user_id and balance columns.");
  }
  const records = parsed.map((record) => ({
    discordUserId: String(csvValue(record, ["discord_user_id", "discord_id", "discordid", "discord user id"]) ?? ""),
    balance: csvValue(record, ["balance", "points", "amount", "token_balance"])
  }));
  return createPreview(env, { guildId, createdBy, source: "drip_csv", sourceCurrency, ratio: input.ratio, records });
}

function dripDiscordId(member: DripMember): string | undefined {
  for (const credential of member.credentials ?? []) {
    const provider = `${credential.oauthProvider ?? ""} ${credential.format ?? ""}`.toLowerCase();
    if (!provider.includes("discord")) continue;
    const id = validDiscordId(credential.oauthAccountId ?? credential.publicIdentifier);
    if (id) return id;
  }
  return undefined;
}

function dripBalance(member: DripMember, currency: string): unknown {
  const expected = currency.toLowerCase();
  const balances = member.balances ?? member.pointBalances ?? [];
  const match = balances.find((balance) =>
    balance.currencyId?.toLowerCase() === expected ||
    balance.currencyName?.toLowerCase() === expected ||
    balance.realmPoint?.id?.toLowerCase() === expected ||
    balance.realmPoint?.name?.toLowerCase() === expected
  );
  return match?.balance;
}

export async function previewDripApi(
  env: Env,
  guildId: string,
  createdBy: string,
  input: { realmId?: unknown; apiKey?: unknown; sourceCurrency?: unknown; ratio?: unknown }
): Promise<MigrationPreview> {
  const realmId = typeof input.realmId === "string" ? input.realmId.trim() : "";
  const apiKey = typeof input.apiKey === "string" ? input.apiKey.trim() : "";
  const sourceCurrency = typeof input.sourceCurrency === "string" ? input.sourceCurrency.trim() : "";
  if (!/^[0-9a-fA-F]{24}$/.test(realmId)) throw new DripMigrationError("Enter the 24-character Drip Realm ID.");
  if (apiKey.length < 16 || apiKey.length > 500) throw new DripMigrationError("Enter a valid read-only Drip API key.");
  if (!sourceCurrency || sourceCurrency.length > 64) throw new DripMigrationError("Enter the Drip currency name or ID.");

  const records: PreviewRecord[] = [];
  for (let page = 1; page <= 100; page += 1) {
    const url = new URL(`https://api.drip.re/api/v1/realms/${realmId}/members/`);
    url.searchParams.set("page", String(page));
    url.searchParams.set("limit", "100");
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      signal: AbortSignal.timeout(15_000)
    });
    if (response.status === 401 || response.status === 403) {
      throw new DripMigrationError("Drip rejected that key. Use a read-only key with realm and member access.");
    }
    if (!response.ok) throw new DripMigrationError(`Drip could not provide member balances (${response.status}).`);
    const body = await response.json() as { data?: DripMember[]; meta?: { totalPages?: number } };
    const members = Array.isArray(body.data) ? body.data : [];
    for (const member of members) {
      records.push({ discordUserId: dripDiscordId(member), balance: dripBalance(member, sourceCurrency) });
    }
    if (records.length > MAX_IMPORT_ROWS) throw new DripMigrationError(`This migration exceeds ${MAX_IMPORT_ROWS.toLocaleString()} members.`);
    const totalPages = Number(body.meta?.totalPages);
    if (members.length < 100 || (Number.isSafeInteger(totalPages) && totalPages > 0 && page >= totalPages)) break;
  }
  return createPreview(env, { guildId, createdBy, source: "drip_api", sourceCurrency, ratio: input.ratio, records });
}

export async function listDripMigrations(env: Env, guildId: string): Promise<MigrationBatch[]> {
  const rows = await env.DB.prepare(
    "SELECT * FROM migration_batches WHERE guild_id = ? ORDER BY created_at DESC LIMIT 20"
  ).bind(guildId).all<MigrationBatchRow>();
  return rows.results.map(publicBatch);
}

export async function getDripMigration(env: Env, guildId: string, batchId: string): Promise<MigrationPreview> {
  const batch = await env.DB.prepare(
    "SELECT * FROM migration_batches WHERE id = ? AND guild_id = ?"
  ).bind(batchId, guildId).first<MigrationBatchRow>();
  if (!batch) throw new DripMigrationError("That migration preview was not found.");
  const rows = await env.DB.prepare(
    `SELECT row_number, discord_user_id, source_balance, import_amount, status, note
     FROM migration_rows WHERE batch_id = ? ORDER BY row_number LIMIT 200`
  ).bind(batchId).all<MigrationRow>();
  return {
    ...publicBatch(batch),
    rows: rows.results.map((row) => ({
      discordUserId: row.discord_user_id,
      sourceBalance: row.source_balance,
      importAmount: row.import_amount,
      status: row.status,
      note: row.note
    }))
  };
}

export async function applyDripMigration(
  env: Env,
  guildId: string,
  actorDiscordUserId: string,
  batchId: string
): Promise<MigrationPreview> {
  const preview = await getDripMigration(env, guildId, batchId);
  if (preview.status === "rolled_back") throw new DripMigrationError("A rolled-back migration cannot be applied again.");
  if (preview.status === "applied") return preview;
  const rows = await env.DB.prepare(
    `SELECT row_number, discord_user_id, source_balance, import_amount, status, note
     FROM migration_rows WHERE batch_id = ? AND status IN ('ready', 'imported') ORDER BY row_number`
  ).bind(batchId).all<MigrationRow>();
  const statements: D1PreparedStatement[] = [];
  for (const row of rows.results) {
    if (!row.discord_user_id || !row.import_amount || row.import_amount <= 0) continue;
    statements.push(
      env.DB.prepare(
        "INSERT INTO discord_users (id, updated_at) VALUES (?, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP"
      ).bind(row.discord_user_id),
      env.DB.prepare(
        `INSERT OR IGNORE INTO point_transactions
          (id, guild_id, discord_user_id, amount, source, metadata)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(
        `drip:${batchId}:${row.discord_user_id}`,
        guildId,
        row.discord_user_id,
        row.import_amount,
        `migration:${batchId}:${row.discord_user_id}`,
        JSON.stringify({ kind: "drip_migration", batchId, sourceBalance: row.source_balance, sourceCurrency: preview.sourceCurrency, conversionRatio: preview.conversionRatio })
      ),
      env.DB.prepare("UPDATE migration_rows SET status = 'imported' WHERE batch_id = ? AND row_number = ?")
        .bind(batchId, row.row_number)
    );
  }
  await runInChunks(env, statements);
  await env.DB.prepare(
    "UPDATE migration_batches SET status = 'applied', applied_at = COALESCE(applied_at, CURRENT_TIMESTAMP) WHERE id = ? AND guild_id = ?"
  ).bind(batchId, guildId).run();
  await recordAuditEvent(env, {
    guildId,
    actorDiscordUserId,
    action: "drip_migration_applied",
    detail: `Imported ${preview.importTotal} ${preview.targetCurrency} for ${preview.matchedCount} members from batch ${batchId}`
  });
  return getDripMigration(env, guildId, batchId);
}

export async function rollbackDripMigration(
  env: Env,
  guildId: string,
  actorDiscordUserId: string,
  batchId: string
): Promise<MigrationPreview> {
  const preview = await getDripMigration(env, guildId, batchId);
  if (preview.status === "rolled_back") return preview;
  if (preview.status !== "applied") throw new DripMigrationError("Only an applied migration can be rolled back.");
  const rows = await env.DB.prepare(
    `SELECT row_number, discord_user_id, source_balance, import_amount, status, note
     FROM migration_rows WHERE batch_id = ? AND status = 'imported' ORDER BY row_number`
  ).bind(batchId).all<MigrationRow>();
  const statements: D1PreparedStatement[] = [];
  for (const row of rows.results) {
    if (!row.discord_user_id || !row.import_amount || row.import_amount <= 0) continue;
    statements.push(
      env.DB.prepare(
        `INSERT OR IGNORE INTO point_transactions
          (id, guild_id, discord_user_id, amount, source, metadata)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(
        `drip-rollback:${batchId}:${row.discord_user_id}`,
        guildId,
        row.discord_user_id,
        -row.import_amount,
        `migration_rollback:${batchId}:${row.discord_user_id}`,
        JSON.stringify({ kind: "drip_migration_rollback", batchId })
      ),
      env.DB.prepare("UPDATE migration_rows SET status = 'rolled_back' WHERE batch_id = ? AND row_number = ?")
        .bind(batchId, row.row_number)
    );
  }
  await runInChunks(env, statements);
  await env.DB.prepare(
    "UPDATE migration_batches SET status = 'rolled_back', rolled_back_at = CURRENT_TIMESTAMP WHERE id = ? AND guild_id = ?"
  ).bind(batchId, guildId).run();
  await recordAuditEvent(env, {
    guildId,
    actorDiscordUserId,
    action: "drip_migration_rolled_back",
    detail: `Rolled back Drip migration batch ${batchId}`
  });
  return getDripMigration(env, guildId, batchId);
}
