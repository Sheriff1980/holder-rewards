import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cancelRaffle,
  createRaffle,
  drawRaffle,
  enterRaffle,
  listRaffles,
  RaffleError
} from "../src/raffles.js";
import { getPointsBalance, grantPoints } from "../src/points.js";
import type { Env } from "../src/types.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

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
};

class RaffleStatement {
  private values: unknown[] = [];

  constructor(private readonly db: RaffleDb, private readonly sql: string) {}

  bind(...values: unknown[]): this {
    this.values = values;
    return this;
  }

  async all<T>(): Promise<D1Result<T>> {
    if (this.sql.includes("FROM raffles")) {
      const results = this.db.raffles
        .filter((row) => row.guild_id === this.values[0])
        .map((row) => ({
          ...row,
          total_entries: [...this.db.entries.entries()]
            .filter(([key]) => key.startsWith(`${row.id}:`))
            .reduce((sum, [, count]) => sum + count, 0)
        }));
      return { success: true, results, meta: {} } as unknown as D1Result<T>;
    }
    if (this.sql.includes("FROM raffle_entries")) {
      const results = [...this.db.entries.entries()]
        .filter(([key]) => key.startsWith(`${this.values[0]}:`))
        .map(([key, entries]) => ({ discord_user_id: key.split(":")[1], entries }));
      return { success: true, results, meta: {} } as unknown as D1Result<T>;
    }
    return { success: true, results: [], meta: {} } as unknown as D1Result<T>;
  }

  async first<T>(): Promise<T | null> {
    if (this.sql.includes("FROM guild_settings")) return null;
    if (this.sql.includes("FROM raffle_entries")) {
      const entries = this.db.entries.get(`${this.values[0]}:${this.values[1]}`);
      return (entries === undefined ? null : { entries }) as T | null;
    }
    const balance = this.db.transactions
      .filter((entry) => entry.guild_id === this.values[0] && entry.discord_user_id === this.values[1])
      .reduce((sum, entry) => sum + entry.amount, 0);
    return { balance } as T;
  }

  async run(): Promise<D1Result> {
    if (this.sql.includes("INSERT INTO raffles")) {
      this.db.raffles.push({
        id: String(this.values[0]),
        guild_id: String(this.values[1]),
        title: String(this.values[2]),
        prize: String(this.values[3]),
        prize_role_id: this.values[4] === null ? null : String(this.values[4]),
        entry_cost: Number(this.values[5]),
        max_entries_per_member: Number(this.values[6]),
        status: "open",
        winner_discord_user_id: null
      });
      return { success: true, meta: { changes: 1 } } as D1Result;
    }
    if (this.sql.includes("INSERT INTO raffle_entries")) {
      const key = `${this.values[0]}:${this.values[2]}`;
      this.db.entries.set(key, (this.db.entries.get(key) ?? 0) + Number(this.values[3]));
      return { success: true, meta: { changes: 1 } } as D1Result;
    }
    if (this.sql.includes("INSERT INTO point_transactions")) {
      this.db.transactions.push({
        guild_id: String(this.values[1]),
        discord_user_id: String(this.values[2]),
        amount: Number(this.values[3]),
        source: String(this.values[4])
      });
      return { success: true, meta: { changes: 1 } } as D1Result;
    }
    if (this.sql.includes("UPDATE raffles SET status = 'drawn'")) {
      const raffle = this.db.raffles.find((row) => row.id === this.values[1] && row.status === "open");
      if (!raffle) return { success: true, meta: { changes: 0 } } as D1Result;
      raffle.status = "drawn";
      raffle.winner_discord_user_id = String(this.values[0]);
      return { success: true, meta: { changes: 1 } } as D1Result;
    }
    if (this.sql.includes("UPDATE raffles SET status = 'cancelled'")) {
      const raffle = this.db.raffles.find((row) => row.id === this.values[0] && row.status === "open");
      if (!raffle) return { success: true, meta: { changes: 0 } } as D1Result;
      raffle.status = "cancelled";
      return { success: true, meta: { changes: 1 } } as D1Result;
    }
    return { success: true, meta: { changes: 1 } } as D1Result;
  }
}

class RaffleDb {
  raffles: RaffleRow[] = [];
  entries = new Map<string, number>();
  transactions: Array<{ guild_id: string; discord_user_id: string; amount: number; source: string }> = [];

  prepare(sql: string): RaffleStatement {
    return new RaffleStatement(this, sql);
  }

  async batch(statements: RaffleStatement[]): Promise<D1Result[]> {
    const results: D1Result[] = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }
}

function createEnv(db = new RaffleDb()): Env {
  return {
    DB: db as unknown as D1Database,
    APP_NAME: "Holder Rewards",
    REWARD_CURRENCY_NAME: "Points",
    DISCORD_BOT_TOKEN: "token"
  };
}

const GUILD = "100000000000000000";

async function openRaffle(env: Env, overrides: Record<string, unknown> = {}) {
  return createRaffle(env, {
    guildId: GUILD,
    title: "Friday giveaway",
    prize: "VIP role",
    entryCost: 25,
    maxEntriesPerMember: 3,
    createdBy: "manager-1",
    ...overrides
  });
}

describe("raffle entries", () => {
  it("charges entries against the balance and enforces the per-member cap", async () => {
    const env = createEnv();
    const raffle = await openRaffle(env);
    await grantPoints(env, { guildId: GUILD, discordUserId: "user-1", amount: 100, grantedBy: "m" });

    await expect(
      enterRaffle(env, { guildId: GUILD, raffleId: raffle.id, discordUserId: "user-1", count: 5 })
    ).rejects.toThrow("3");
    await expect(
      enterRaffle(env, { guildId: GUILD, raffleId: raffle.id, discordUserId: "user-1", count: 2 })
    ).resolves.toMatchObject({ cost: 50, balance: 50 });
    await expect(
      enterRaffle(env, { guildId: GUILD, raffleId: raffle.id, discordUserId: "user-1", count: 2 })
    ).rejects.toThrow("1 more");
    await expect(
      enterRaffle(env, { guildId: GUILD, raffleId: raffle.id, discordUserId: "user-1", count: 1 })
    ).resolves.toMatchObject({ balance: 25 });
    await expect(
      enterRaffle(env, { guildId: GUILD, raffleId: raffle.id, discordUserId: "user-1", count: 1 })
    ).rejects.toThrow("maximum");

    const [listed] = await listRaffles(env, GUILD);
    expect(listed?.totalEntries).toBe(3);
    expect(await getPointsBalance(env, GUILD, "user-1")).toBe(25);
  });

  it("rejects entries without balance", async () => {
    const env = createEnv();
    const raffle = await openRaffle(env);
    await expect(
      enterRaffle(env, { guildId: GUILD, raffleId: raffle.id, discordUserId: "user-1", count: 1 })
    ).rejects.toBeInstanceOf(RaffleError);
  });
});

describe("raffle draws", () => {
  it("requires entries before drawing", async () => {
    const env = createEnv();
    const raffle = await openRaffle(env);
    await expect(drawRaffle(env, { guildId: GUILD, raffleId: raffle.id })).rejects.toThrow("Nobody entered");
  });

  it("picks an entrant, closes the raffle, and grants the prize role", async () => {
    const db = new RaffleDb();
    const env = createEnv(db);
    const raffle = await openRaffle(env, { prizeRoleId: "300000000000000000" });
    await grantPoints(env, { guildId: GUILD, discordUserId: "user-1", amount: 100, grantedBy: "m" });
    await grantPoints(env, { guildId: GUILD, discordUserId: "user-2", amount: 100, grantedBy: "m" });
    await enterRaffle(env, { guildId: GUILD, raffleId: raffle.id, discordUserId: "user-1", count: 1 });
    await enterRaffle(env, { guildId: GUILD, raffleId: raffle.id, discordUserId: "user-2", count: 2 });

    const roleCalls: string[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      roleCalls.push(`${init?.method} ${String(input)}`);
      return new Response(null, { status: 204 });
    });

    const result = await drawRaffle(env, { guildId: GUILD, raffleId: raffle.id });
    expect(["user-1", "user-2"]).toContain(result.winnerDiscordUserId);
    expect(result.roleGranted).toBe(true);
    expect(roleCalls[0]).toContain("PUT");
    expect(roleCalls[0]).toContain(result.winnerDiscordUserId);
    await expect(drawRaffle(env, { guildId: GUILD, raffleId: raffle.id })).rejects.toThrow("already");
  });
});

describe("raffle cancellation", () => {
  it("refunds every entry", async () => {
    const env = createEnv();
    const raffle = await openRaffle(env);
    await grantPoints(env, { guildId: GUILD, discordUserId: "user-1", amount: 100, grantedBy: "m" });
    await enterRaffle(env, { guildId: GUILD, raffleId: raffle.id, discordUserId: "user-1", count: 2 });
    expect(await getPointsBalance(env, GUILD, "user-1")).toBe(50);

    const result = await cancelRaffle(env, { guildId: GUILD, raffleId: raffle.id });
    expect(result).toMatchObject({ refundedMembers: 1, refundedPoints: 50 });
    expect(await getPointsBalance(env, GUILD, "user-1")).toBe(100);
    await expect(
      enterRaffle(env, { guildId: GUILD, raffleId: raffle.id, discordUserId: "user-1", count: 1 })
    ).rejects.toThrow("no longer open");
  });
});
