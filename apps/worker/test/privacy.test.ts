import { describe, expect, it } from "vitest";
import { getWalletPrivacySettings, updateWalletPrivacySettings } from "../src/privacy.js";
import type { Env } from "../src/types.js";

class Statement {
  private values: unknown[] = [];

  constructor(private readonly db: MemoryD1, private readonly sql: string) {}

  bind(...values: unknown[]): this {
    this.values = values;
    return this;
  }

  async first<T>(): Promise<T | null> {
    if (!this.db.settings.has(String(this.values[0]))) return null;
    return { manager_full_wallet_visibility: this.db.settings.get(String(this.values[0])) } as T;
  }

  async run(): Promise<D1Result> {
    if (this.sql.includes("INSERT INTO guild_settings")) {
      this.db.settings.set(String(this.values[0]), Number(this.values[1]));
    }
    return { success: true, meta: { changes: 1 } } as D1Result;
  }
}

class MemoryD1 {
  settings = new Map<string, number>();

  prepare(sql: string): Statement {
    return new Statement(this, sql);
  }

  async batch(statements: Statement[]): Promise<D1Result[]> {
    return Promise.all(statements.map((statement) => statement.run()));
  }
}

function createEnv(): Env {
  return {
    DB: new MemoryD1() as unknown as D1Database,
    APP_NAME: "Holder Rewards",
    REWARD_CURRENCY_NAME: "Points",
    DISCORD_BOT_TOKEN: "token"
  };
}

describe("manager wallet privacy", () => {
  it("defaults to shortened addresses and saves an explicit opt-in", async () => {
    const env = createEnv();
    await expect(getWalletPrivacySettings(env, "guild-1")).resolves.toEqual({
      managersCanViewFullAddresses: false
    });
    await expect(updateWalletPrivacySettings(env, "guild-1", true)).resolves.toEqual({
      managersCanViewFullAddresses: true
    });
    await expect(getWalletPrivacySettings(env, "guild-1")).resolves.toEqual({
      managersCanViewFullAddresses: true
    });
  });

  it("rejects ambiguous values", async () => {
    await expect(updateWalletPrivacySettings(createEnv(), "guild-1", "yes")).rejects.toThrow(
      "Choose whether"
    );
  });
});
