import { describe, expect, it } from "vitest";
import { BrandingError, getGuildBranding, updateGuildBranding } from "../src/branding.js";
import type { Env } from "../src/types.js";

class Statement {
  private values: unknown[] = [];

  constructor(
    private readonly settings: Map<string, { app_name: string; accent_color: string }>,
    private readonly sql: string
  ) {}

  bind(...values: unknown[]): this {
    this.values = values;
    return this;
  }

  async first<T>(): Promise<T | null> {
    return (this.settings.get(String(this.values[0])) ?? null) as T | null;
  }

  async run(): Promise<D1Result> {
    if (this.sql.includes("INSERT INTO guild_settings")) {
      this.settings.set(String(this.values[0]), {
        app_name: String(this.values[1]),
        accent_color: String(this.values[2])
      });
    }
    return { success: true, meta: { changes: 1 } } as D1Result;
  }
}

function createEnv(): Env {
  const settings = new Map<string, { app_name: string; accent_color: string }>();
  return {
    DB: {
      prepare: (sql: string) => new Statement(settings, sql),
      batch: async (statements: Statement[]) => Promise.all(statements.map((statement) => statement.run()))
    } as unknown as D1Database,
    APP_NAME: "Holder Rewards",
    REWARD_CURRENCY_NAME: "Points",
    DISCORD_BOT_TOKEN: "token"
  };
}

describe("community branding", () => {
  it("uses deployment defaults until a server saves its own branding", async () => {
    const env = createEnv();
    await expect(getGuildBranding(env, "guild-1")).resolves.toEqual({
      name: "Holder Rewards",
      accentColor: "#2F80ED"
    });
    await expect(
      updateGuildBranding(env, "guild-1", { name: "Ape Club", accentColor: "#12abef" })
    ).resolves.toEqual({ name: "Ape Club", accentColor: "#12ABEF" });
    await expect(getGuildBranding(env, "guild-1")).resolves.toEqual({
      name: "Ape Club",
      accentColor: "#12ABEF"
    });
    await expect(getGuildBranding(env, "guild-2")).resolves.toEqual({
      name: "Holder Rewards",
      accentColor: "#2F80ED"
    });
  });

  it("rejects malformed branding values", async () => {
    const env = createEnv();
    await expect(
      updateGuildBranding(env, "guild-1", { name: "", accentColor: "blue" })
    ).rejects.toBeInstanceOf(BrandingError);
  });
});
