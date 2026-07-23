import { describe, expect, it } from "vitest";
import { buildGuildExport, type ExportKind } from "../src/exports.js";
import type { Env } from "../src/types.js";

class Statement {
  constructor(private readonly sql: string) {}

  bind(): this {
    return this;
  }

  async all<T>(): Promise<D1Result<T>> {
    let results: Array<Record<string, unknown>>;
    if (this.sql.includes("FROM guild_memberships") && !this.sql.includes("INNER JOIN")) {
      results = [{
        discord_user_id: "member-1",
        created_at: "2026-07-01",
        last_verified_at: "2026-07-22",
        last_synced_at: "2026-07-22",
        last_sync_error: ""
      }];
    } else if (this.sql.includes("FROM point_transactions")) {
      results = [{
        discord_user_id: "member-1",
        balance: 25,
        transaction_count: 3,
        last_transaction_at: "2026-07-22"
      }];
    } else if (this.sql.includes("FROM wallets")) {
      results = [{
        discord_user_id: "member-1",
        chain: "evm",
        address: "0x1111111111111111111111111111111111111111",
        created_at: "2026-07-22"
      }];
    } else {
      results = [{
        created_at: "2026-07-22",
        actor_discord_user_id: "manager-1",
        subject_discord_user_id: "",
        action: "branding_updated",
        detail: "=unsafe spreadsheet formula"
      }];
    }
    return { success: true, results, meta: {} } as unknown as D1Result<T>;
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

describe("manager CSV exports", () => {
  it.each<ExportKind>(["holders", "balances", "audit"])("builds a bounded %s export", async (kind) => {
    const exported = await buildGuildExport(createEnv(), "guild-1", kind, false);
    expect(exported.filename).toMatch(new RegExp(`holder-rewards-${kind}-\\d{4}-\\d{2}-\\d{2}\\.csv`));
    expect(exported.content.startsWith("\uFEFF")).toBe(true);
    expect(exported.content).toContain(kind === "audit" ? "manager-1" : "member-1");
    if (kind === "audit") expect(exported.content).toContain("'=unsafe spreadsheet formula");
  });

  it("shortens wallet addresses by default and reveals them only after opt-in", async () => {
    const hidden = await buildGuildExport(createEnv(), "guild-1", "wallets", false);
    expect(hidden.content).toContain("0x111111...111111");
    expect(hidden.content).toContain("shortened");

    const visible = await buildGuildExport(createEnv(), "guild-1", "wallets", true);
    expect(visible.content).toContain("0x1111111111111111111111111111111111111111");
    expect(visible.content).toContain("full");
  });
});
