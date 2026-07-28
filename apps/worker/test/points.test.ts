import { describe, expect, it } from "vitest";
import {
  auditPointsLedger,
  accrueDailyHolderPoints,
  claimDailyPoints,
  getPointsBalance,
  getPointsLeaderboard,
  getRewardSettings,
  grantPoints,
  TipError,
  tipPoints,
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
    if (this.sql.includes("INSERT OR IGNORE INTO guild_settings")) {
      if (!this.db.settings.has(String(this.values[0]))) {
        this.db.settings.set(String(this.values[0]), {
          reward_currency_name: "Points",
          daily_claim_amount: 10,
          holder_daily_amount: 0,
          tip_daily_limit: 100
        });
      }
      return { success: true, meta: { changes: 1 } } as D1Result;
    }
    if (this.sql.includes("UPDATE guild_settings")) {
      this.db.settings.set(String(this.values[4]), {
        reward_currency_name: String(this.values[0]),
        daily_claim_amount: Number(this.values[1]),
        holder_daily_amount: Number(this.values[2]),
        tip_daily_limit: Number(this.values[3])
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
      (transaction.source.startsWith("daily_claim:") ||
        transaction.source.startsWith("holder_accrual:")) &&
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
    if (this.sql.includes("COUNT(DISTINCT discord_user_id)")) {
      const transactions = this.db.transactions.filter((item) => item.guildId === this.values[0]);
      return {
        transaction_count: transactions.length,
        member_count: new Set(transactions.map((item) => item.discordUserId)).size,
        net_points: transactions.reduce((sum, item) => sum + item.amount, 0)
      } as T;
    }
    if (this.sql.includes("source LIKE 'tip:%'")) {
      const tipped = this.db.transactions
        .filter(
          (item) =>
            item.guildId === this.values[0] &&
            item.discordUserId === this.values[1] &&
            item.amount < 0 &&
            item.source.startsWith("tip:")
        )
        .reduce((sum, item) => sum + -item.amount, 0);
      return { tipped } as T;
    }
    const balance = this.db.transactions
      .filter(
        (item) => item.guildId === this.values[0] && item.discordUserId === this.values[1]
      )
      .reduce((sum, item) => sum + item.amount, 0);
    return { balance } as T;
  }

  async all<T>(): Promise<D1Result<T>> {
    if (this.sql.includes("FROM role_rules")) {
      const roleIds = this.values.slice(1).map(String);
      return {
        success: true,
        results: roleIds.map((role_id) => ({
          role_id,
          reward_multiplier: this.db.multipliers.get(role_id) ?? 1
        })),
        meta: {}
      } as unknown as D1Result<T>;
    }
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
  settings = new Map<string, {
    reward_currency_name: string;
    daily_claim_amount: number;
    holder_daily_amount: number;
    tip_daily_limit: number;
  }>();
  multipliers = new Map<string, number>();

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
    await expect(auditPointsLedger(env, "guild-1")).resolves.toEqual({
      transactionCount: 2,
      memberCount: 1,
      netPoints: 35
    });
  });

  it("uses browser-managed reward settings independently for each server", async () => {
    const env = createEnv();
    await expect(
      updateRewardSettings(env, "guild-1", { currencyName: "Bananas", dailyClaimAmount: 25 })
    ).rejects.toThrow("Holder reward");
    await expect(
      updateRewardSettings(env, "guild-1", {
        currencyName: "Bananas",
        dailyClaimAmount: 25,
        holderDailyAmount: 4,
        tipDailyLimit: 150
      })
    ).resolves.toEqual({ currencyName: "Bananas", dailyClaimAmount: 25, holderDailyAmount: 4, tipDailyLimit: 150 });
    await expect(getRewardSettings(env, "guild-1")).resolves.toEqual({
      currencyName: "Bananas",
      dailyClaimAmount: 25,
      holderDailyAmount: 4,
      tipDailyLimit: 150
    });
    await expect(
      claimDailyPoints(env, "guild-1", "user-1", new Date("2026-07-22T12:00:00.000Z"))
    ).resolves.toMatchObject({ amount: 25, currencyName: "Bananas" });
    await expect(getRewardSettings(env, "guild-2")).resolves.toEqual({
      currencyName: "Points",
      dailyClaimAmount: 10,
      holderDailyAmount: 0,
      tipDailyLimit: 100
    });
  });

  it("awards holder accrual once per role and day with role multipliers", async () => {
    const db = new MemoryD1();
    db.settings.set("guild-1", {
      reward_currency_name: "Points",
      daily_claim_amount: 10,
      holder_daily_amount: 5,
      tip_daily_limit: 100
    });
    db.multipliers.set("role-1", 1);
    db.multipliers.set("role-2", 3);
    const env = createEnv(db);
    const day = new Date("2026-07-22T12:00:00.000Z");

    await expect(
      accrueDailyHolderPoints(env, "guild-1", "user-1", ["role-1", "role-2"], day)
    ).resolves.toEqual({ awarded: 20, balance: 20 });
    await expect(
      accrueDailyHolderPoints(env, "guild-1", "user-1", ["role-1", "role-2"], day)
    ).resolves.toEqual({ awarded: 0, balance: 20 });
    await expect(
      accrueDailyHolderPoints(
        env,
        "guild-1",
        "user-1",
        ["role-1"],
        new Date("2026-07-23T12:00:00.000Z")
      )
    ).resolves.toEqual({ awarded: 5, balance: 25 });
  });
});

describe("tipping", () => {
  it("moves points between members and enforces the daily limit", async () => {
    const env = createEnv();
    await grantPoints(env, {
      guildId: "guild-1",
      discordUserId: "user-1",
      amount: 150,
      grantedBy: "manager-1"
    });

    await expect(
      tipPoints(env, { guildId: "guild-1", senderId: "user-1", recipientId: "user-2", amount: 60 })
    ).resolves.toEqual({
      amount: 60,
      senderBalance: 90,
      recipientBalance: 60,
      currencyName: "Points"
    });

    await expect(
      tipPoints(env, { guildId: "guild-1", senderId: "user-1", recipientId: "user-2", amount: 50 })
    ).rejects.toThrow("40");

    await expect(
      tipPoints(env, { guildId: "guild-1", senderId: "user-1", recipientId: "user-2", amount: 40 })
    ).resolves.toMatchObject({ senderBalance: 50, recipientBalance: 100 });
    await expect(getPointsBalance(env, "guild-1", "user-1")).resolves.toBe(50);
    await expect(getPointsBalance(env, "guild-1", "user-2")).resolves.toBe(100);
  });

  it("rejects self-tips, bad amounts, and empty balances", async () => {
    const env = createEnv();
    await expect(
      tipPoints(env, { guildId: "guild-1", senderId: "user-1", recipientId: "user-1", amount: 10 })
    ).rejects.toBeInstanceOf(TipError);
    await expect(
      tipPoints(env, { guildId: "guild-1", senderId: "user-1", recipientId: "user-2", amount: 0 })
    ).rejects.toBeInstanceOf(TipError);
    await expect(
      tipPoints(env, { guildId: "guild-1", senderId: "user-1", recipientId: "user-2", amount: 100001 })
    ).rejects.toBeInstanceOf(TipError);
    await expect(
      tipPoints(env, { guildId: "guild-1", senderId: "user-1", recipientId: "user-2", amount: 10 })
    ).rejects.toThrow("not enough");
  });

  it("stops tipping when a server turns it off", async () => {
    const env = createEnv();
    await grantPoints(env, {
      guildId: "guild-1",
      discordUserId: "user-1",
      amount: 50,
      grantedBy: "manager-1"
    });
    await updateRewardSettings(env, "guild-1", {
      currencyName: "Points",
      dailyClaimAmount: 10,
      holderDailyAmount: 0,
      tipDailyLimit: 0
    });
    await expect(
      tipPoints(env, { guildId: "guild-1", senderId: "user-1", recipientId: "user-2", amount: 10 })
    ).rejects.toThrow("turned off");
  });
});
