import { describe, expect, it } from "vitest";
import { recordAuditEvent, shortWalletAddress } from "../src/audit.js";
import type { Env } from "../src/types.js";

describe("audit events", () => {
  it("stores bounded event data without requiring an actor", async () => {
    let values: unknown[] = [];
    const env = {
      DB: {
        prepare: () => ({
          bind: (...input: unknown[]) => {
            values = input;
            return { run: async () => ({ success: true, meta: { changes: 1 } }) };
          }
        })
      } as unknown as D1Database,
      APP_NAME: "Holder Rewards",
      REWARD_CURRENCY_NAME: "Points",
      DISCORD_BOT_TOKEN: "token"
    } satisfies Env;

    await recordAuditEvent(env, {
      guildId: "guild-1",
      subjectDiscordUserId: "member-1",
      action: "wallet_linked",
      detail: "x".repeat(400)
    });

    expect(values.slice(1, 5)).toEqual(["guild-1", null, "member-1", "wallet_linked"]);
    expect(String(values[5])).toHaveLength(300);
  });

  it("shortens ordinary EVM addresses for manager-visible details", () => {
    expect(shortWalletAddress("0x1111111111111111111111111111111111111111")).toBe(
      "0x111111...111111"
    );
  });
});
