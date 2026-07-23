import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAdminSession,
  listManageableDiscordRoles,
  requireAdminSession
} from "../src/admin.js";
import type { Env } from "../src/types.js";

class Statement {
  values: unknown[] = [];

  constructor(
    private readonly sql: string,
    private readonly sessions: Map<string, { discord_user_id: string; guild_id: string; expires_at: string }>
  ) {}

  bind(...values: unknown[]): this {
    this.values = values;
    return this;
  }

  async first<T>(): Promise<T | null> {
    if (!this.sql.includes("FROM admin_sessions")) return null;
    return (this.sessions.get(String(this.values[0])) ?? null) as T | null;
  }

  async run(): Promise<D1Result> {
    if (this.sql.includes("INSERT INTO admin_sessions")) {
      this.sessions.set(String(this.values[1]), {
        discord_user_id: String(this.values[2]),
        guild_id: String(this.values[3]),
        expires_at: String(this.values[4])
      });
    }
    return { success: true, meta: { changes: 1 } } as D1Result;
  }
}

function createEnv(): Env {
  const sessions = new Map<string, { discord_user_id: string; guild_id: string; expires_at: string }>();
  return {
    DB: {
      prepare: (sql: string) => new Statement(sql, sessions),
      batch: async (statements: Statement[]) => Promise.all(statements.map((statement) => statement.run()))
    } as unknown as D1Database,
    APP_NAME: "Holder Rewards",
    REWARD_CURRENCY_NAME: "Points",
    DISCORD_BOT_TOKEN: "bot-token"
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("manager sessions", () => {
  it("creates a hashed session and resolves it from the private token", async () => {
    const env = createEnv();
    const token = await createAdminSession(env, "223456789012345678", "123456789012345678");
    expect(token.length).toBeGreaterThanOrEqual(32);
    await expect(requireAdminSession(env, token)).resolves.toMatchObject({
      discord_user_id: "223456789012345678",
      guild_id: "123456789012345678"
    });
  });

  it("only returns roles below the bot's highest role", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/roles")) {
        return Response.json([
          { id: "123456789012345678", name: "@everyone", color: 0, position: 0, managed: false },
          { id: "2", name: "Holder", color: 12, position: 2, managed: false },
          { id: "3", name: "Bot", color: 0, position: 3, managed: true },
          { id: "4", name: "Admin", color: 0, position: 4, managed: false }
        ]);
      }
      if (url.endsWith("/users/@me")) return Response.json({ id: "99" });
      if (url.endsWith("/members/99")) return Response.json({ roles: ["3"] });
      throw new Error(`Unexpected request: ${url}`);
    });

    await expect(listManageableDiscordRoles(createEnv(), "123456789012345678")).resolves.toEqual([
      { id: "2", name: "Holder", color: 12, position: 2 }
    ]);
  });
});
