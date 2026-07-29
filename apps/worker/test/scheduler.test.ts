import { describe, expect, it } from "vitest";
import {
  processRoleSyncQueue,
  retryFailedRoleSyncs,
  runScheduledRoleSync
} from "../src/scheduler.js";
import type { RoleSyncSummary } from "../src/rules.js";
import type { Env, RoleSyncQueueMessage } from "../src/types.js";

type Member = {
  guild_id: string;
  discord_user_id: string;
  cursor_value: string;
  last_sync_error: string | null;
};

class SchedulerStatement {
  private values: unknown[] = [];

  constructor(private readonly db: SchedulerDb, private readonly sql: string) {}

  bind(...values: unknown[]): this {
    this.values = values;
    return this;
  }

  async first<T>(): Promise<T | null> {
    if (this.sql.includes("FROM app_state")) {
      return (this.db.cursor === null ? null : { value: this.db.cursor }) as T | null;
    }
    return null;
  }

  async all<T>(): Promise<D1Result<T>> {
    if (this.sql.includes("last_sync_error IS NOT NULL")) {
      const guildId = String(this.values[0]);
      const limit = Number(this.values[1] ?? 10);
      return {
        success: true,
        results: this.db.members
          .filter((member) => member.guild_id === guildId && member.last_sync_error !== null)
          .slice(0, limit),
        meta: {}
      } as unknown as D1Result<T>;
    }
    const cursor = String(this.values[0] ?? "");
    const limit = Number(this.values[1] ?? 25);
    return {
      success: true,
      results: this.db.members.filter((member) => member.cursor_value > cursor).slice(0, limit),
      meta: {}
    } as unknown as D1Result<T>;
  }

  async run(): Promise<D1Result> {
    if (this.sql.includes("UPDATE guild_memberships")) {
      const member = this.db.members.find(
        (candidate) =>
          candidate.guild_id === this.values[2] && candidate.discord_user_id === this.values[3]
      );
      if (member) member.last_sync_error = this.values[1] === null ? null : String(this.values[1]);
    }
    if (this.sql.includes("INSERT INTO app_state")) {
      if (this.sql.includes("'last_queue_run'")) {
        this.db.lastQueueRun = String(this.values[0]);
      } else if (this.values[0] === "scheduled_role_sync_cursor") {
        this.db.cursor = String(this.values[1]);
      }
    }
    return { success: true, meta: { changes: 1 } } as D1Result;
  }
}

class SchedulerDb {
  cursor: string | null = null;
  lastQueueRun: string | null = null;
  members: Member[] = ["1", "2", "3"].map((user) => ({
    guild_id: "100000000000000",
    discord_user_id: `20000000000000${user}`,
    cursor_value: `100000000000000:20000000000000${user}`,
    last_sync_error: null
  }));

  prepare(sql: string): SchedulerStatement {
    return new SchedulerStatement(this, sql);
  }
}

function createEnv(db: SchedulerDb): Env {
  return {
    DB: db as unknown as D1Database,
    APP_NAME: "Holder Rewards",
    REWARD_CURRENCY_NAME: "Points",
    DISCORD_BOT_TOKEN: "token",
    SETUP_TOKEN: "setup"
  };
}

const emptySummary = (): RoleSyncSummary => ({
  added: [],
  removed: [],
  unchanged: [],
  qualified: [],
  errors: []
});

describe("scheduled role synchronization", () => {
  it("processes a useful batch and records per-member failures", async () => {
    const db = new SchedulerDb();
    const calls: string[] = [];
    const syncMember = async (_env: Env, _guildId: string, userId: string) => {
      calls.push(userId);
      if (userId.endsWith("2")) {
        return { ...emptySummary(), errors: [{ roleId: "role-1", message: "RPC timeout" }] };
      }
      if (userId.endsWith("3")) throw new Error("Discord unavailable");
      return emptySummary();
    };

    const report = await runScheduledRoleSync(createEnv(db), syncMember, () => 1_000);

    expect([report.processed, report.failed]).toEqual([3, 2]);
    expect(calls.map((userId) => userId.slice(-1))).toEqual(["1", "2", "3"]);
    expect(db.cursor).toBe("");
    expect(db.members[0]?.last_sync_error).toBeNull();
    expect(db.members[1]?.last_sync_error).toContain("RPC timeout");
    expect(db.members[2]?.last_sync_error).toBe("Discord unavailable");
  });

  it("lets a manager retry only failed members and clears recovered errors", async () => {
    const db = new SchedulerDb();
    db.members[0]!.last_sync_error = "RPC timeout";
    db.members[2]!.last_sync_error = "Discord unavailable";
    const calls: string[] = [];

    const report = await retryFailedRoleSyncs(
      createEnv(db),
      "100000000000000",
      async (_env, _guildId, userId) => {
        calls.push(userId);
        return emptySummary();
      }
    );

    expect(report).toEqual({ processed: 2, failed: 0, nextCursor: "" });
    expect(calls.map((userId) => userId.slice(-1))).toEqual(["1", "3"]);
    expect(db.members.every((member) => member.last_sync_error === null)).toBe(true);
  });

  it("dispatches the batch to a queue instead of syncing inline when bound", async () => {
    const db = new SchedulerDb();
    const sent: Array<Array<{ body: RoleSyncQueueMessage }>> = [];
    const env: Env = {
      ...createEnv(db),
      ROLE_SYNC_QUEUE: {
        sendBatch: async (messages: Array<{ body: RoleSyncQueueMessage }>) => {
          sent.push(messages);
        }
      } as unknown as Queue<RoleSyncQueueMessage>
    };
    let inlineCalls = 0;

    const report = await runScheduledRoleSync(
      env,
      async () => {
        inlineCalls += 1;
        return emptySummary();
      },
      () => 1_000
    );

    expect(report).toEqual({ processed: 3, failed: 0, nextCursor: "" });
    expect(inlineCalls).toBe(0);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toHaveLength(3);
    expect(sent[0]?.[0]?.body).toEqual({
      guildId: "100000000000000",
      discordUserId: "200000000000001"
    });
  });

  it("processes queue messages and retries unexpected failures", async () => {
    const db = new SchedulerDb();
    const retried: string[] = [];
    const message = (userId: string) => ({
      body: { guildId: "100000000000000", discordUserId: userId },
      retry: () => {
        retried.push(userId);
      }
    });
    const batch = {
      queue: "holder-role-sync",
      messages: [message("200000000000001"), message("200000000000002")]
    };

    await processRoleSyncQueue(
      createEnv(db),
      batch as unknown as MessageBatch<RoleSyncQueueMessage>,
      async (_env, _guildId, userId) => {
        if (userId.endsWith("2")) throw new Error("Discord unavailable");
        return emptySummary();
      }
    );

    expect(retried.map((userId) => userId.slice(-1))).toEqual(["2"]);
    expect(db.lastQueueRun).not.toBeNull();
  });
});
