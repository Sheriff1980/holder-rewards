import { describe, expect, it } from "vitest";
import {
  claimDailyPoints,
  getPointsBalance,
  getPointsLeaderboard,
  getRewardSettings,
  grantPoints,
  updateRewardSettings
} from "../src/points.js";
import type { Env } from "../src/types.js";

type Transaction = {
  guildId: string;
  discordUserId: string;
  amount: number;
  source: string;
};

class Statement {
  private values: unknown[] = [];

  constructor(private readonly db: MemoryD1, private readonly sql: string) {}

  bind(...values: unknown[]): this {
    this.values = values;
    return this;
  }

  async run(): Promise<D1Result> {
    if (this.sql.includes("INSERT INTO guild_settings")) {
      this.db.settings.set(String(this.values[0]), {
        reward_currency_name: String(this.values[1]),
        daily_claim_amount: Number(this.values[2])
      });
      return { success: true, meta: { changes: 1 } } as D1Result;
    }
    if (!this.sql.includes("point_transactions")) {
      return { success: true, meta: { changes: 1 } } as D1Result;
    }
    const transaction = {
      guildId: String(this.values[1]),
      discordUserId: String(this.values[2]),
      amount: Number(this.values[3]),
      source: this.sql.includes("'admin_grant'") ? "admin_grant" : String(this.values[4])
    };
    const duplicate =
      transaction.source.startsWith("daily_claim:") &&
      this.db.transactions.some(
        (item) =>
          item.guildId === transaction.guildId &&
          item.discordUserId === transaction.discordUserId &&
          item.source === transaction.source
      );
    if (!duplicate) this.db.transactions.push(transaction);
    return { success: true, meta: { changes: duplicate ? 0 : 1 } } as D1Result;
  }

  async first<T>(): Promise<T | null> {
    if (this.sql.includes("FROM guild_settings")) {
      return (this.db.settings.get(String(this.values[0])) ?? null) as T | null;
    }
    const balance = this.db.transactions
      .filter(
        (item) => item.guildId === this.values[0] && item.discordUserId === this.values[1]
      )
      .reduce((sum, item) => sum + item.amount, 0);
    return { balance } as T;
  }

  async all<T>(): Promise<D1Result<T>> {
    const balances = new Map<string, number>();
    for (const transaction of this.db.transactions.filter((item) => item.guildId === this.values[0])) {
      balances.set(
        transaction.discordUserId,
        (balances.get(transaction.discordUserId) ?? 0) + transaction.amount
      );
    }
    const results = [...balances]
      .filter(([, balance]) => balance > 0)
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 10)
      .map(([discord_user_id, balance]) => ({ discord_user_id, balance }));
    return { success: true, results, meta: {} } as unknown as D1Result<T>;
  }
}

class MemoryD1 {
  transactions: Transaction[] = [];
  settings = new Map<string, { reward_currency_name: string; daily_claim_amount: number }>();

  prepare(sql: string): Statement {
    return new Statement(this, sql);
  }

  async batch(statements: Statement[]): Promise<D1Result[]> {
    return Promise.all(statements.map((statement) => statement.run()));
  }
}

function createEnv(db = new MemoryD1()): Env {
  return {
    DB: db as unknown as D1Database,
    APP_NAME: "Holder Rewards",
    REWARD_CURRENCY_NAME: "Points",
    DAILY_CLAIM_AMOUNT: "10",
    DISCORD_BOT_TOKEN: "token"
  };
}

describe("points ledger", () => {
  it("allows one daily claim per member and keeps an append-only balance", async () => {
    const env = createEnv();
    const day = new Date("2026-07-22T12:00:00.000Z");
    await expect(claimDailyPoints(env, "guild-1", "user-1", day)).resolves.toEqual({
      claimed: true,
      amount: 10,
      balance: 10,
      currencyName: "Points"
    });
    await expect(claimDailyPoints(env, "guild-1", "user-1", day)).resolves.toEqual({
      claimed: false,
      amount: 10,
      balance: 10,
      currencyName: "Points"
    });
    await expect(getPointsBalance(env, "guild-1", "user-1")).resolves.toBe(10);
  });

  it("keeps balances isolated by server and ranks the top balances", async () => {
    const db = new MemoryD1();
    const env = createEnv(db);
    const day = new Date("2026-07-22T12:00:00.000Z");
    await claimDailyPoints(env, "guild-1", "user-2", day);
    await claimDailyPoints(env, "guild-1", "user-1", day);
    db.transactions.push({ guildId: "guild-1", discordUserId: "user-2", amount: 5, source: "bonus" });
    await claimDailyPoints(env, "guild-2", "user-1", day);

    await expect(getPointsLeaderboard(env, "guild-1")).resolves.toEqual([
      { discordUserId: "user-2", balance: 15 },
      { discordUserId: "user-1", balance: 10 }
    ]);
    await expect(getPointsBalance(env, "guild-2", "user-1")).resolves.toBe(10);
  });

  it("appends manager grants without replacing the member's balance", async () => {
    const env = createEnv();
    await claimDailyPoints(env, "guild-1", "user-1", new Date("2026-07-22T12:00:00.000Z"));
    await expect(
      grantPoints(env, {
        guildId: "guild-1",
        discordUserId: "user-1",
        amount: 25,
        grantedBy: "manager-1",
        reason: "Contest winner"
      })
    ).resolves.toEqual({ amount: 25, balance: 35, currencyName: "Points" });
  });

  it("uses browser-managed reward settings independently for each server", async () => {
    const env = createEnv();
    await expect(
      updateRewardSettings(env, "guild-1", { currencyName: "Bananas", dailyClaimAmount: 25 })
    ).resolves.toEqual({ currencyName: "Bananas", dailyClaimAmount: 25 });
    await expect(getRewardSettings(env, "guild-1")).resolves.toEqual({
      currencyName: "Bananas",
      dailyClaimAmount: 25
    });
    await expect(
      claimDailyPoints(env, "guild-1", "user-1", new Date("2026-07-22T12:00:00.000Z"))
    ).resolves.toMatchObject({ amount: 25, currencyName: "Bananas" });
    await expect(getRewardSettings(env, "guild-2")).resolves.toEqual({
      currencyName: "Points",
      dailyClaimAmount: 10
    });
  });
});
