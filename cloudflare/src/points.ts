import type { Env } from "./types.js";

type BalanceRow = { balance: number | string | null };

type RewardSettingsRow = {
  reward_currency_name: string;
  daily_claim_amount: number;
};

export type RewardSettings = {
  currencyName: string;
  dailyClaimAmount: number;
};

export class RewardSettingsError extends Error {}

export type LeaderboardEntry = {
  discordUserId: string;
  balance: number;
};

function configuredDailyAmount(env: Env): number {
  const amount = Number(env.DAILY_CLAIM_AMOUNT ?? "10");
  return Number.isSafeInteger(amount) && amount > 0 && amount <= 1_000_000 ? amount : 10;
}

function defaultSettings(env: Env): RewardSettings {
  return {
    currencyName: env.REWARD_CURRENCY_NAME || "Points",
    dailyClaimAmount: configuredDailyAmount(env)
  };
}

export async function getRewardSettings(env: Env, guildId: string): Promise<RewardSettings> {
  const row = await env.DB.prepare(
    "SELECT reward_currency_name, daily_claim_amount FROM guild_settings WHERE guild_id = ?"
  )
    .bind(guildId)
    .first<RewardSettingsRow>();
  return row
    ? {
        currencyName: row.reward_currency_name,
        dailyClaimAmount: row.daily_claim_amount
      }
    : defaultSettings(env);
}

export async function updateRewardSettings(
  env: Env,
  guildId: string,
  input: { currencyName?: unknown; dailyClaimAmount?: unknown }
): Promise<RewardSettings> {
  const currencyName = typeof input.currencyName === "string" ? input.currencyName.trim() : "";
  if (currencyName.length < 1 || currencyName.length > 32) {
    throw new RewardSettingsError("Currency name must be between 1 and 32 characters.");
  }
  const dailyClaimAmount = Number(input.dailyClaimAmount);
  if (!Number.isSafeInteger(dailyClaimAmount) || dailyClaimAmount < 1 || dailyClaimAmount > 1_000_000) {
    throw new RewardSettingsError("Daily reward must be a whole number between 1 and 1,000,000.");
  }
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO guilds (id, updated_at) VALUES (?, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP"
    ).bind(guildId),
    env.DB.prepare(
      `INSERT INTO guild_settings (guild_id, reward_currency_name, daily_claim_amount, updated_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(guild_id) DO UPDATE SET
         reward_currency_name = excluded.reward_currency_name,
         daily_claim_amount = excluded.daily_claim_amount,
         updated_at = CURRENT_TIMESTAMP`
    ).bind(guildId, currencyName, dailyClaimAmount)
  ]);
  return { currencyName, dailyClaimAmount };
}

function numericBalance(value: number | string | null | undefined): number {
  const balance = Number(value ?? 0);
  return Number.isSafeInteger(balance) ? balance : 0;
}

export async function getPointsBalance(
  env: Env,
  guildId: string,
  discordUserId: string
): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COALESCE(SUM(amount), 0) AS balance FROM point_transactions WHERE guild_id = ? AND discord_user_id = ?"
  )
    .bind(guildId, discordUserId)
    .first<BalanceRow>();
  return numericBalance(row?.balance);
}

export async function claimDailyPoints(
  env: Env,
  guildId: string,
  discordUserId: string,
  now = new Date()
): Promise<{ claimed: boolean; amount: number; balance: number; currencyName: string }> {
  const settings = await getRewardSettings(env, guildId);
  const amount = settings.dailyClaimAmount;
  const day = now.toISOString().slice(0, 10);
  const source = `daily_claim:${day}`;
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO discord_users (id, updated_at) VALUES (?, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP"
    ).bind(discordUserId),
    env.DB.prepare(
      "INSERT INTO guilds (id, updated_at) VALUES (?, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP"
    ).bind(guildId)
  ]);
  const result = await env.DB.prepare(
    `INSERT OR IGNORE INTO point_transactions
      (id, guild_id, discord_user_id, amount, source, metadata)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(
      crypto.randomUUID(),
      guildId,
      discordUserId,
      amount,
      source,
      JSON.stringify({ day, kind: "daily_claim" })
    )
    .run();
  return {
    claimed: (result.meta.changes ?? 0) === 1,
    amount,
    balance: await getPointsBalance(env, guildId, discordUserId),
    currencyName: settings.currencyName
  };
}

export async function getPointsLeaderboard(env: Env, guildId: string): Promise<LeaderboardEntry[]> {
  const rows = await env.DB.prepare(
    `SELECT discord_user_id, SUM(amount) AS balance
     FROM point_transactions
     WHERE guild_id = ?
     GROUP BY discord_user_id
     HAVING SUM(amount) > 0
     ORDER BY balance DESC, discord_user_id
     LIMIT 10`
  )
    .bind(guildId)
    .all<{ discord_user_id: string; balance: number | string }>();
  return rows.results.map((row) => ({
    discordUserId: row.discord_user_id,
    balance: numericBalance(row.balance)
  }));
}

export async function grantPoints(
  env: Env,
  input: {
    guildId: string;
    discordUserId: string;
    amount: unknown;
    grantedBy: string;
    reason?: unknown;
  }
): Promise<{ amount: number; balance: number; currencyName: string }> {
  const amount = Number(input.amount);
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > 1_000_000) {
    throw new Error("Reward amount must be a whole number between 1 and 1,000,000.");
  }
  const reason = typeof input.reason === "string" ? input.reason.trim().slice(0, 200) : "";
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO discord_users (id, updated_at) VALUES (?, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP"
    ).bind(input.discordUserId),
    env.DB.prepare(
      "INSERT INTO guilds (id, updated_at) VALUES (?, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP"
    ).bind(input.guildId)
  ]);
  await env.DB.prepare(
    `INSERT INTO point_transactions
      (id, guild_id, discord_user_id, amount, source, metadata)
     VALUES (?, ?, ?, ?, 'admin_grant', ?)`
  )
    .bind(
      crypto.randomUUID(),
      input.guildId,
      input.discordUserId,
      amount,
      JSON.stringify({ grantedBy: input.grantedBy, reason })
    )
    .run();
  return {
    amount,
    balance: await getPointsBalance(env, input.guildId, input.discordUserId),
    currencyName: (await getRewardSettings(env, input.guildId)).currencyName
  };
}
