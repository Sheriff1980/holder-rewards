import { getPointsBalance, getRewardSettings } from "./points.js";
import { changeDiscordRole } from "./rules.js";
import type { Env } from "./types.js";

export type Raffle = {
  id: string;
  guildId: string;
  title: string;
  prize: string;
  prizeRoleId: string | null;
  entryCost: number;
  maxEntriesPerMember: number;
  status: "open" | "drawn" | "cancelled";
  winnerDiscordUserId: string | null;
  totalEntries: number;
};

export class RaffleError extends Error {}

type RaffleRow = {
  id: string;
  guild_id: string;
  title: string;
  prize: string;
  prize_role_id: string | null;
  entry_cost: number;
  max_entries_per_member: number;
  status: string;
  winner_discord_user_id: string | null;
  total_entries: number | string | null;
};

function parseRaffle(row: RaffleRow): Raffle | null {
  if (row.status !== "open" && row.status !== "drawn" && row.status !== "cancelled") return null;
  if (!Number.isSafeInteger(row.entry_cost) || !Number.isSafeInteger(row.max_entries_per_member)) {
    return null;
  }
  const totalEntries = Number(row.total_entries ?? 0);
  return {
    id: row.id,
    guildId: row.guild_id,
    title: row.title,
    prize: row.prize,
    prizeRoleId: row.prize_role_id,
    entryCost: row.entry_cost,
    maxEntriesPerMember: row.max_entries_per_member,
    status: row.status,
    winnerDiscordUserId: row.winner_discord_user_id,
    totalEntries: Number.isSafeInteger(totalEntries) ? totalEntries : 0
  };
}

export async function listRaffles(env: Env, guildId: string): Promise<Raffle[]> {
  const rows = await env.DB.prepare(
    `SELECT raffles.id, raffles.guild_id, raffles.title, raffles.prize, raffles.prize_role_id,
       raffles.entry_cost, raffles.max_entries_per_member, raffles.status,
       raffles.winner_discord_user_id,
       COALESCE(SUM(raffle_entries.entries), 0) AS total_entries
     FROM raffles
     LEFT JOIN raffle_entries ON raffle_entries.raffle_id = raffles.id
     WHERE raffles.guild_id = ?
     GROUP BY raffles.id
     ORDER BY raffles.status = 'open' DESC, raffles.created_at DESC`
  )
    .bind(guildId)
    .all<RaffleRow>();
  return rows.results.map(parseRaffle).filter((raffle): raffle is Raffle => raffle !== null);
}

async function getRaffle(env: Env, guildId: string, raffleId: string): Promise<Raffle | null> {
  const raffles = await listRaffles(env, guildId);
  return raffles.find((raffle) => raffle.id === raffleId || raffle.id.startsWith(raffleId)) ?? null;
}

export async function createRaffle(
  env: Env,
  input: {
    guildId: unknown;
    title: unknown;
    prize: unknown;
    prizeRoleId?: unknown;
    entryCost: unknown;
    maxEntriesPerMember?: unknown;
    createdBy: string;
  }
): Promise<Raffle> {
  if (typeof input.guildId !== "string" || !/^[0-9]{15,22}$/.test(input.guildId)) {
    throw new RaffleError("Server must be a valid Discord ID.");
  }
  if (typeof input.title !== "string" || input.title.trim().length < 2 || input.title.trim().length > 80) {
    throw new RaffleError("Raffle title must be between 2 and 80 characters.");
  }
  if (typeof input.prize !== "string" || input.prize.trim().length < 2 || input.prize.trim().length > 120) {
    throw new RaffleError("Prize description must be between 2 and 120 characters.");
  }
  const entryCost = Number(input.entryCost);
  if (!Number.isSafeInteger(entryCost) || entryCost < 1 || entryCost > 1_000_000) {
    throw new RaffleError("Entry cost must be a whole number between 1 and 1,000,000.");
  }
  const maxEntries = input.maxEntriesPerMember === undefined || input.maxEntriesPerMember === null || input.maxEntriesPerMember === ""
    ? 10
    : Number(input.maxEntriesPerMember);
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 1_000) {
    throw new RaffleError("Maximum entries per member must be a whole number between 1 and 1,000.");
  }
  let prizeRoleId: string | null = null;
  if (typeof input.prizeRoleId === "string" && input.prizeRoleId.length > 0) {
    if (!/^[0-9]{15,22}$/.test(input.prizeRoleId)) {
      throw new RaffleError("Prize role must be a valid Discord role.");
    }
    prizeRoleId = input.prizeRoleId;
  }

  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO guilds (id, updated_at) VALUES (?, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP"
    ).bind(input.guildId),
    env.DB.prepare(
      `INSERT INTO raffles (id, guild_id, title, prize, prize_role_id, entry_cost, max_entries_per_member, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id,
      input.guildId,
      input.title.trim(),
      input.prize.trim(),
      prizeRoleId,
      entryCost,
      maxEntries,
      input.createdBy
    )
  ]);
  return {
    id,
    guildId: input.guildId,
    title: input.title.trim(),
    prize: input.prize.trim(),
    prizeRoleId,
    entryCost,
    maxEntriesPerMember: maxEntries,
    status: "open",
    winnerDiscordUserId: null,
    totalEntries: 0
  };
}

export async function enterRaffle(
  env: Env,
  input: { guildId: string; raffleId: string; discordUserId: string; count: unknown }
): Promise<{ raffle: Raffle; count: number; cost: number; balance: number; currencyName: string }> {
  const raffle = await getRaffle(env, input.guildId, input.raffleId);
  if (!raffle) throw new RaffleError("That raffle was not found. Check the raffle ID from /raffle list.");
  if (raffle.status !== "open") throw new RaffleError("That raffle is no longer open.");
  const count = Number(input.count);
  if (!Number.isSafeInteger(count) || count < 1 || count > 100) {
    throw new RaffleError("Entries must be a whole number between 1 and 100.");
  }
  const existing = await env.DB.prepare(
    "SELECT entries FROM raffle_entries WHERE raffle_id = ? AND discord_user_id = ?"
  )
    .bind(raffle.id, input.discordUserId)
    .first<{ entries: number }>();
  const currentEntries = Number(existing?.entries ?? 0);
  if (currentEntries + count > raffle.maxEntriesPerMember) {
    const remaining = Math.max(0, raffle.maxEntriesPerMember - currentEntries);
    throw new RaffleError(
      remaining === 0
        ? `You already hold the maximum of ${raffle.maxEntriesPerMember} entries.`
        : `You can buy ${remaining} more entr${remaining === 1 ? "y" : "ies"} in this raffle.`
    );
  }
  const cost = count * raffle.entryCost;
  const [balance, settings] = await Promise.all([
    getPointsBalance(env, input.guildId, input.discordUserId),
    getRewardSettings(env, input.guildId)
  ]);
  if (balance < cost) {
    throw new RaffleError(`That costs ${cost.toLocaleString()} ${settings.currencyName} but your balance is ${balance.toLocaleString()}.`);
  }
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO discord_users (id, updated_at) VALUES (?, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP"
    ).bind(input.discordUserId),
    env.DB.prepare(
      `INSERT INTO point_transactions (id, guild_id, discord_user_id, amount, source, metadata)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(
      crypto.randomUUID(),
      input.guildId,
      input.discordUserId,
      -cost,
      `raffle_entry:${raffle.id}`,
      JSON.stringify({ kind: "raffle_entry", raffleId: raffle.id, count })
    ),
    env.DB.prepare(
      `INSERT INTO raffle_entries (raffle_id, guild_id, discord_user_id, entries, updated_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(raffle_id, discord_user_id) DO UPDATE SET
         entries = entries + excluded.entries,
         updated_at = CURRENT_TIMESTAMP`
    ).bind(raffle.id, input.guildId, input.discordUserId, count)
  ]);
  return {
    raffle,
    count,
    cost,
    balance: balance - cost,
    currencyName: settings.currencyName
  };
}

export async function drawRaffle(
  env: Env,
  input: { guildId: string; raffleId: string }
): Promise<{ raffle: Raffle; winnerDiscordUserId: string; roleGranted: boolean }> {
  const raffle = await getRaffle(env, input.guildId, input.raffleId);
  if (!raffle) throw new RaffleError("That raffle was not found.");
  if (raffle.status !== "open") throw new RaffleError("That raffle was already drawn or cancelled.");
  const entries = await env.DB.prepare(
    "SELECT discord_user_id, entries FROM raffle_entries WHERE raffle_id = ? ORDER BY discord_user_id"
  )
    .bind(raffle.id)
    .all<{ discord_user_id: string; entries: number }>();
  const total = entries.results.reduce((sum, row) => sum + Number(row.entries), 0);
  if (total === 0) {
    throw new RaffleError("Nobody entered this raffle. Cancel it to refund nothing, or keep it open.");
  }

  const draw = crypto.getRandomValues(new Uint32Array(1))[0]! % total;
  let cursor = 0;
  let winner = entries.results[entries.results.length - 1]!.discord_user_id;
  for (const row of entries.results) {
    cursor += Number(row.entries);
    if (draw < cursor) {
      winner = row.discord_user_id;
      break;
    }
  }

  const closed = await env.DB.prepare(
    "UPDATE raffles SET status = 'drawn', winner_discord_user_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'open'"
  )
    .bind(winner, raffle.id)
    .run();
  if ((closed.meta.changes ?? 0) !== 1) {
    throw new RaffleError("That raffle was already drawn or cancelled.");
  }

  let roleGranted = false;
  if (raffle.prizeRoleId) {
    await changeDiscordRole(env, raffle.guildId, winner, raffle.prizeRoleId, "add");
    roleGranted = true;
  }
  return { raffle, winnerDiscordUserId: winner, roleGranted };
}

export async function cancelRaffle(
  env: Env,
  input: { guildId: string; raffleId: string }
): Promise<{ raffle: Raffle; refundedMembers: number; refundedPoints: number }> {
  const raffle = await getRaffle(env, input.guildId, input.raffleId);
  if (!raffle) throw new RaffleError("That raffle was not found.");
  if (raffle.status !== "open") throw new RaffleError("That raffle was already drawn or cancelled.");
  const entries = await env.DB.prepare(
    "SELECT discord_user_id, entries FROM raffle_entries WHERE raffle_id = ?"
  )
    .bind(raffle.id)
    .all<{ discord_user_id: string; entries: number }>();

  const statements = [
    env.DB.prepare(
      "UPDATE raffles SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'open'"
    ).bind(raffle.id),
    ...entries.results.map((row) =>
      env.DB.prepare(
        `INSERT INTO point_transactions (id, guild_id, discord_user_id, amount, source, metadata)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(
        crypto.randomUUID(),
        raffle.guildId,
        row.discord_user_id,
        Number(row.entries) * raffle.entryCost,
        `raffle_refund:${raffle.id}`,
        JSON.stringify({ kind: "raffle_refund", raffleId: raffle.id })
      )
    )
  ];
  await env.DB.batch(statements);
  return {
    raffle,
    refundedMembers: entries.results.length,
    refundedPoints: entries.results.reduce((sum, row) => sum + Number(row.entries) * raffle.entryCost, 0)
  };
}

export async function listRaffleEntriesForMember(
  env: Env,
  guildId: string,
  discordUserId: string
): Promise<Map<string, number>> {
  const rows = await env.DB.prepare(
    "SELECT raffle_id, entries FROM raffle_entries WHERE guild_id = ? AND discord_user_id = ?"
  )
    .bind(guildId, discordUserId)
    .all<{ raffle_id: string; entries: number }>();
  return new Map(rows.results.map((row) => [row.raffle_id, Number(row.entries)]));
}
