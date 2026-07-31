import { describe, expect, it } from "vitest";
import { createMemberSession, requireMemberSession } from "../src/member.js";
import type { Env } from "../src/types.js";

type StoredSession = {
  tokenHash: string;
  discordUserId: string;
  guildId: string;
  expiresAt: string;
};

class MemberStatement {
  private values: unknown[] = [];

  constructor(private readonly state: { session?: StoredSession }, private readonly sql: string) {}

  bind(...values: unknown[]): this {
    this.values = values;
    return this;
  }

  async run(): Promise<D1Result> {
    if (this.sql.includes("INSERT INTO member_sessions")) {
      this.state.session = {
        tokenHash: String(this.values[1]),
        discordUserId: String(this.values[2]),
        guildId: String(this.values[3]),
        expiresAt: String(this.values[4])
      };
    }
    return { success: true, meta: { changes: 1 } } as D1Result;
  }

  async first<T>(): Promise<T | null> {
    const session = this.state.session;
    if (this.sql.includes("FROM member_sessions") && session && session.tokenHash === this.values[0]) {
      return {
        discord_user_id: session.discordUserId,
        guild_id: session.guildId,
        expires_at: session.expiresAt
      } as T;
    }
    return null;
  }
}

function createEnv(): { env: Env; state: { session?: StoredSession } } {
  const state: { session?: StoredSession } = {};
  const db = {
    prepare: (sql: string) => new MemberStatement(state, sql),
    batch: async (statements: MemberStatement[]) => Promise.all(statements.map((statement) => statement.run()))
  } as unknown as D1Database;
  return {
    state,
    env: {
      DB: db,
      APP_NAME: "Holder Rewards",
      REWARD_CURRENCY_NAME: "Points",
      DISCORD_BOT_TOKEN: "test-token"
    }
  };
}

describe("member reward sessions", () => {
  it("creates an opaque session tied to one Discord member and server", async () => {
    const { env, state } = createEnv();
    const token = await createMemberSession(env, "223456789012345678", "123456789012345678");

    expect(token).toHaveLength(43);
    expect(state.session?.tokenHash).not.toBe(token);
    await expect(requireMemberSession(env, token)).resolves.toMatchObject({
      discord_user_id: "223456789012345678",
      guild_id: "123456789012345678"
    });
  });

  it("rejects an expired member link", async () => {
    const { env, state } = createEnv();
    const token = await createMemberSession(env, "223456789012345678", "123456789012345678");
    state.session!.expiresAt = new Date(Date.now() - 1_000).toISOString();

    await expect(requireMemberSession(env, token)).rejects.toThrow("expired");
  });
});
