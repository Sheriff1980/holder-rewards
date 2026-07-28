import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkQuest,
  createQuest,
  listPendingSubmissions,
  listQuests,
  QuestError,
  removeQuest,
  reviewQuestSubmission,
  submitQuestCode,
  submitQuestProof
} from "../src/quests.js";
import { getPointsBalance } from "../src/points.js";
import type { Env } from "../src/types.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

type QuestRow = {
  id: string;
  guild_id: string;
  title: string;
  kind: string;
  config: string;
  reward: number;
  enabled: number;
};

class QuestStatement {
  private values: unknown[] = [];

  constructor(private readonly db: QuestDb, private readonly sql: string) {}

  bind(...values: unknown[]): this {
    this.values = values;
    return this;
  }

  async all<T>(): Promise<D1Result<T>> {
    if (this.sql.includes("FROM quests")) {
      return {
        success: true,
        results: this.db.quests.filter(
          (row) => row.guild_id === this.values[0] && row.enabled === 1
        ),
        meta: {}
      } as unknown as D1Result<T>;
    }
    if (this.sql.includes("FROM quest_completions")) {
      return {
        success: true,
        results: [...this.db.completions]
          .filter((key) => key.startsWith(`${this.values[0]}:`) && key.endsWith(`:${this.values[1]}`))
          .map((key) => ({ quest_id: key.split(":")[1] })),
        meta: {}
      } as unknown as D1Result<T>;
    }
    if (this.sql.includes("FROM quest_submissions")) {
      if (this.sql.includes("JOIN quests")) {
        const results = this.db.submissions
          .filter((row) => row.guild_id === this.values[0] && row.status === "pending")
          .map((row) => ({
            id: row.id,
            quest_id: row.quest_id,
            discord_user_id: row.discord_user_id,
            proof: row.proof,
            created_at: "2026-07-28 12:00:00",
            quest_title: this.db.quests.find((quest) => quest.id === row.quest_id)?.title ?? "?",
            reward: this.db.quests.find((quest) => quest.id === row.quest_id)?.reward ?? 0
          }));
        return { success: true, results, meta: {} } as unknown as D1Result<T>;
      }
      const results = this.db.submissions
        .filter(
          (row) =>
            row.guild_id === this.values[0] &&
            row.discord_user_id === this.values[1] &&
            row.status === "pending"
        )
        .map((row) => ({ quest_id: row.quest_id }));
      return { success: true, results, meta: {} } as unknown as D1Result<T>;
    }
    return { success: true, results: [], meta: {} } as unknown as D1Result<T>;
  }

  async first<T>(): Promise<T | null> {
    if (this.sql.includes("FROM wallets")) {
      const wallet = this.db.wallets.find((entry) => entry.discord_user_id === this.values[0]);
      return (wallet ? { address: wallet.address } : null) as T | null;
    }
    if (this.sql.includes("FROM quest_completions")) {
      const found = [...this.db.completions].some((entry) =>
        entry.endsWith(`:${this.values[0]}:${this.values[1]}`)
      );
      return (found ? { quest_id: String(this.values[0]) } : null) as T | null;
    }
    if (this.sql.includes("COUNT(DISTINCT source)")) {
      const days = new Set(
        this.db.transactions
          .filter(
            (entry) =>
              entry.guild_id === this.values[0] &&
              entry.discord_user_id === this.values[1] &&
              entry.source.startsWith("daily_claim:")
          )
          .map((entry) => entry.source)
      ).size;
      return { days } as T;
    }
    const balance = this.db.transactions
      .filter((entry) => entry.guild_id === this.values[0] && entry.discord_user_id === this.values[1])
      .reduce((sum, entry) => sum + entry.amount, 0);
    return { balance } as T;
  }

  async run(): Promise<D1Result> {
    if (this.sql.includes("INSERT INTO quests")) {
      this.db.quests.push({
        id: String(this.values[0]),
        guild_id: String(this.values[1]),
        title: String(this.values[2]),
        kind: String(this.values[3]),
        config: String(this.values[4]),
        reward: Number(this.values[5]),
        enabled: 1
      });
      return { success: true, meta: { changes: 1 } } as D1Result;
    }
    if (this.sql.includes("UPDATE quests SET enabled = 0")) {
      const quest = this.db.quests.find(
        (row) => row.id === this.values[0] && row.guild_id === this.values[1] && row.enabled === 1
      );
      if (!quest) return { success: true, meta: { changes: 0 } } as D1Result;
      quest.enabled = 0;
      return { success: true, meta: { changes: 1 } } as D1Result;
    }
    if (this.sql.includes("INSERT OR IGNORE INTO quest_completions")) {
      const key = `${this.values[1]}:${this.values[0]}:${this.values[2]}`;
      if (this.db.completions.has(key)) {
        return { success: true, meta: { changes: 0 } } as D1Result;
      }
      this.db.completions.add(key);
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
    if (this.sql.includes("INSERT INTO quest_submissions")) {
      const existing = this.db.submissions.find(
        (row) => row.quest_id === this.values[1] && row.discord_user_id === this.values[3]
      );
      if (existing) {
        existing.proof = String(this.values[4]);
        existing.status = "pending";
      } else {
        this.db.submissions.push({
          id: String(this.values[0]),
          quest_id: String(this.values[1]),
          guild_id: String(this.values[2]),
          discord_user_id: String(this.values[3]),
          proof: String(this.values[4]),
          status: "pending"
        });
      }
      return { success: true, meta: { changes: 1 } } as D1Result;
    }
    if (this.sql.includes("UPDATE quest_submissions")) {
      const submission = this.db.submissions.find(
        (row) => row.id === this.values[2] && row.status === "pending"
      );
      if (!submission) return { success: true, meta: { changes: 0 } } as D1Result;
      submission.status = String(this.values[0]);
      return { success: true, meta: { changes: 1 } } as D1Result;
    }
    return { success: true, meta: { changes: 1 } } as D1Result;
  }
}

class QuestDb {
  quests: QuestRow[] = [];
  completions = new Set<string>();
  transactions: Array<{ guild_id: string; discord_user_id: string; amount: number; source: string }> = [];
  wallets: Array<{ discord_user_id: string; address: string }> = [];
  submissions: Array<{
    id: string;
    quest_id: string;
    guild_id: string;
    discord_user_id: string;
    proof: string;
    status: string;
  }> = [];

  prepare(sql: string): QuestStatement {
    return new QuestStatement(this, sql);
  }

  async batch(statements: QuestStatement[]): Promise<D1Result[]> {
    return Promise.all(statements.map((statement) => statement.run()));
  }
}

function createEnv(db = new QuestDb()): Env {
  return {
    DB: db as unknown as D1Database,
    APP_NAME: "Holder Rewards",
    REWARD_CURRENCY_NAME: "Points",
    DISCORD_BOT_TOKEN: "token"
  };
}

const GUILD = "100000000000000000";

describe("quest creation", () => {
  it("validates titles, rewards, and per-kind configuration", async () => {
    const env = createEnv();
    await expect(
      createQuest(env, { guildId: GUILD, title: "x", kind: "link_wallet", reward: 50 })
    ).rejects.toBeInstanceOf(QuestError);
    await expect(
      createQuest(env, { guildId: GUILD, title: "Good quest", kind: "link_wallet", reward: 0 })
    ).rejects.toBeInstanceOf(QuestError);
    await expect(
      createQuest(env, { guildId: GUILD, title: "Good quest", kind: "daily_claims", reward: 50, days: 1 })
    ).rejects.toBeInstanceOf(QuestError);
    await expect(
      createQuest(env, { guildId: GUILD, title: "Good quest", kind: "code", reward: 50, code: "abc" })
    ).rejects.toBeInstanceOf(QuestError);

    const quest = await createQuest(env, {
      guildId: GUILD,
      title: "Good quest",
      kind: "link_wallet",
      reward: 50
    });
    expect(await listQuests(env, GUILD)).toHaveLength(1);
    expect(quest.kind).toBe("link_wallet");
  });
});

describe("quest completion", () => {
  it("completes a wallet-link quest once and pays the reward", async () => {
    const env = createEnv();
    const quest = await createQuest(env, {
      guildId: GUILD,
      title: "Link up",
      kind: "link_wallet",
      reward: 75
    });

    const missing = await checkQuest(env, GUILD, quest.id, "user-1");
    expect(missing.result).toBe("not_met");

    const db = new QuestDb();
    db.wallets.push({ discord_user_id: "user-1", address: "0xabc" });
    const envWithWallet = createEnv(db);
    const questRow = await createQuest(envWithWallet, {
      guildId: GUILD,
      title: "Link up",
      kind: "link_wallet",
      reward: 75
    });
    const first = await checkQuest(envWithWallet, GUILD, questRow.id, "user-1");
    expect(first.result).toBe("completed");
    expect(first.balance).toBe(75);
    const second = await checkQuest(envWithWallet, GUILD, questRow.id, "user-1");
    expect(second.result).toBe("already_completed");
    expect(await getPointsBalance(envWithWallet, GUILD, "user-1")).toBe(75);
  });

  it("completes daily-claim quests after enough distinct claim days", async () => {
    const db = new QuestDb();
    db.transactions.push(
      { guild_id: GUILD, discord_user_id: "user-1", amount: 10, source: "daily_claim:2026-07-27" },
      { guild_id: GUILD, discord_user_id: "user-1", amount: 10, source: "daily_claim:2026-07-28" }
    );
    const env = createEnv(db);
    const quest = await createQuest(env, {
      guildId: GUILD,
      title: "Regular",
      kind: "daily_claims",
      reward: 100,
      days: 3
    });
    expect((await checkQuest(env, GUILD, quest.id, "user-1")).result).toBe("not_met");
    db.transactions.push({
      guild_id: GUILD,
      discord_user_id: "user-1",
      amount: 10,
      source: "daily_claim:2026-07-29"
    });
    expect((await checkQuest(env, GUILD, quest.id, "user-1")).result).toBe("completed");
  });

  it("completes hold-role quests from live Discord member roles", async () => {
    const db = new QuestDb();
    const env = createEnv(db);
    const quest = await createQuest(env, {
      guildId: GUILD,
      title: "Holder",
      kind: "hold_role",
      reward: 25,
      roleId: "300000000000000000"
    });
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify({ roles: ["300000000000000000"] }), { status: 200 })
    );
    expect((await checkQuest(env, GUILD, quest.id, "user-1")).result).toBe("completed");
  });
});

describe("secret code quests", () => {
  it("matches codes case-insensitively and only pays once", async () => {
    const env = createEnv();
    await createQuest(env, {
      guildId: GUILD,
      title: "Secret",
      kind: "code",
      reward: 40,
      code: "Moon Base Alpha"
    });

    expect((await submitQuestCode(env, GUILD, "user-1", "wrong code")).result).toBe("no_match");
    const first = await submitQuestCode(env, GUILD, "user-1", "moon base alpha");
    expect(first.result).toBe("completed");
    expect(first.balance).toBe(40);
    expect((await submitQuestCode(env, GUILD, "user-1", "MOON BASE ALPHA")).result).toBe("already_completed");
    expect((await submitQuestCode(env, GUILD, "user-2", "Moon Base Alpha")).result).toBe("completed");
  });
});

describe("quest removal", () => {
  it("hides removed quests from listings", async () => {
    const env = createEnv();
    const quest = await createQuest(env, {
      guildId: GUILD,
      title: "Gone",
      kind: "link_wallet",
      reward: 10
    });
    expect(await removeQuest(env, GUILD, quest.id)).toBe(true);
    expect(await removeQuest(env, GUILD, quest.id)).toBe(false);
    expect(await listQuests(env, GUILD)).toHaveLength(0);
  });
});

describe("custom proof quests", () => {
  async function customQuest(env: Env) {
    return createQuest(env, {
      guildId: GUILD,
      title: "Spread the word",
      kind: "custom",
      reward: 150,
      instructions: "Retweet and comment on this post: https://example.com/post"
    });
  }

  it("requires instructions and valid proof text", async () => {
    const env = createEnv();
    await expect(
      createQuest(env, { guildId: GUILD, title: "Custom", kind: "custom", reward: 50 })
    ).rejects.toBeInstanceOf(QuestError);
    const quest = await customQuest(env);
    await expect(submitQuestProof(env, GUILD, quest.id, "user-1", "x")).rejects.toBeInstanceOf(QuestError);
    await expect(
      submitQuestProof(env, GUILD, quest.id, "user-1", "https://x.com/post/123")
    ).resolves.toMatchObject({ quest: { id: quest.id } });
  });

  it("pays the reward when a manager approves, exactly once", async () => {
    const env = createEnv();
    const quest = await customQuest(env);
    await submitQuestProof(env, GUILD, quest.id, "user-1", "https://x.com/post/123");

    const pending = await listPendingSubmissions(env, GUILD);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ questTitle: "Spread the word", discordUserId: "user-1" });

    const review = await reviewQuestSubmission(env, {
      guildId: GUILD,
      submissionId: pending[0]!.id,
      reviewerId: "manager-1",
      approve: true
    });
    expect(review.result).toBe("approved");
    expect(await getPointsBalance(env, GUILD, "user-1")).toBe(150);
    expect(await listPendingSubmissions(env, GUILD)).toHaveLength(0);

    await expect(
      reviewQuestSubmission(env, { guildId: GUILD, submissionId: pending[0]!.id, reviewerId: "manager-1", approve: true })
    ).rejects.toThrow("already reviewed");
    await expect(submitQuestProof(env, GUILD, quest.id, "user-1", "again")).rejects.toThrow("already completed");
    expect(await getPointsBalance(env, GUILD, "user-1")).toBe(150);
  });

  it("pays nothing on rejection and lets the member submit again", async () => {
    const env = createEnv();
    const quest = await customQuest(env);
    await submitQuestProof(env, GUILD, quest.id, "user-1", "first try");
    const [first] = await listPendingSubmissions(env, GUILD);

    const review = await reviewQuestSubmission(env, {
      guildId: GUILD,
      submissionId: first!.id,
      reviewerId: "manager-1",
      approve: false
    });
    expect(review.result).toBe("rejected");
    expect(await getPointsBalance(env, GUILD, "user-1")).toBe(0);

    await submitQuestProof(env, GUILD, quest.id, "user-1", "better proof: https://x.com/post/456");
    const [second] = await listPendingSubmissions(env, GUILD);
    expect(second!.proof).toBe("better proof: https://x.com/post/456");
    await reviewQuestSubmission(env, {
      guildId: GUILD,
      submissionId: second!.id,
      reviewerId: "manager-1",
      approve: true
    });
    expect(await getPointsBalance(env, GUILD, "user-1")).toBe(150);
  });

  it("rejects proof for unknown quests", async () => {
    const env = createEnv();
    await expect(
      submitQuestProof(env, GUILD, "missing-quest", "user-1", "https://x.com/post/123")
    ).rejects.toThrow("no longer available");
  });
});
