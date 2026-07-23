import { describe, expect, it } from "vitest";
import { getGuildOperations } from "../src/operations.js";
import type { Env } from "../src/types.js";

class Statement {
  constructor(private readonly sql: string) {}

  bind(): this {
    return this;
  }

  async first<T>(): Promise<T | null> {
    if (this.sql.includes("last_scheduled_run")) {
      return { value: "2026-07-22T12:00:00.000Z" } as T;
    }
    if (this.sql.includes("last_sync_error")) return { count: 1 } as T;
    if (this.sql.includes("guild_memberships") && this.sql.includes("COUNT(DISTINCT")) {
      return { count: 3 } as T;
    }
    if (this.sql.includes("guild_memberships")) return { count: 2 } as T;
    if (this.sql.includes("role_rules")) return { count: 4 } as T;
    if (this.sql.includes("point_transactions")) return { count: 5 } as T;
    return null;
  }

  async all<T>(): Promise<D1Result<T>> {
    if (this.sql.includes("role_sync_events")) {
      return {
        success: true,
        results: [
          {
            created_at: "2026-07-22T12:02:00.000Z",
            discord_user_id: "123456789012345678",
            role_id: "223456789012345678",
            action: "add",
            reason: "Qualified"
          }
        ],
        meta: {}
      } as unknown as D1Result<T>;
    }
    if (this.sql.includes("audit_events")) {
      return {
        success: true,
        results: [
          {
            created_at: "2026-07-22T12:04:00.000Z",
            actor_discord_user_id: "423456789012345678",
            subject_discord_user_id: null,
            action: "branding_updated",
            detail: "Community name and accent color"
          }
        ],
        meta: {}
      } as unknown as D1Result<T>;
    }
    return {
      success: true,
      results: [
        {
          created_at: "2026-07-22T12:03:00.000Z",
          discord_user_id: "323456789012345678",
          amount: 10,
          source: "daily_claim:2026-07-22"
        }
      ],
      meta: {}
    } as unknown as D1Result<T>;
  }
}

function createEnv(): Env {
  return {
    DB: { prepare: (sql: string) => new Statement(sql) } as unknown as D1Database,
    APP_NAME: "Holder Rewards",
    REWARD_CURRENCY_NAME: "Points",
    DISCORD_BOT_TOKEN: "token"
  };
}

describe("manager operations overview", () => {
  it("summarizes guild metrics and combines recent activity by time", async () => {
    await expect(getGuildOperations(createEnv(), "123456789012345678")).resolves.toEqual({
      verifiedMembers: 2,
      linkedWallets: 3,
      activeRules: 4,
      syncProblems: 1,
      pointTransactions: 5,
      lastScheduledRun: "2026-07-22T12:00:00.000Z",
      activity: [
        {
          kind: "audit",
          createdAt: "2026-07-22T12:04:00.000Z",
          discordUserId: "423456789012345678",
          action: "Updated community branding",
          detail: "Community name and accent color"
        },
        {
          kind: "points",
          createdAt: "2026-07-22T12:03:00.000Z",
          discordUserId: "323456789012345678",
          action: "+10 points",
          detail: "Daily claim"
        },
        {
          kind: "role",
          createdAt: "2026-07-22T12:02:00.000Z",
          discordUserId: "123456789012345678",
          action: "Added holder role",
          detail: "Qualified"
        }
      ]
    });
  });
});
