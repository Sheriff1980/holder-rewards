import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRewardsChannel } from "../src/announcements.js";
import type { Env } from "../src/types.js";

vi.mock("../src/assets.js", () => ({
  currencyIconUrl: vi.fn(),
  hasCurrencyIcon: vi.fn().mockResolvedValue(false)
}));
vi.mock("../src/branding.js", () => ({
  accentColorNumber: vi.fn().mockReturnValue(0x2f80ed),
  getGuildBranding: vi.fn().mockResolvedValue({ name: "Black Grid", accentColor: "#2F80ED" })
}));
vi.mock("../src/points.js", () => ({
  getRewardSettings: vi.fn().mockResolvedValue({ currencyName: "Shards" })
}));

type Settings = {
  channelId: string | null;
  storeMessageId: string | null;
  raffleMessageId: string | null;
};

class AnnouncementStatement {
  private values: unknown[] = [];

  constructor(private readonly settings: Settings, private readonly sql: string) {}

  bind(...values: unknown[]): this {
    this.values = values;
    return this;
  }

  async first<T>(): Promise<T | null> {
    if (!this.sql.includes("FROM guild_settings")) return null;
    return {
      rewards_channel_id: this.settings.channelId,
      store_panel_message_id: this.settings.storeMessageId,
      raffle_panel_message_id: this.settings.raffleMessageId
    } as T;
  }

  async run(): Promise<D1Result> {
    if (this.sql.includes("UPDATE guild_settings SET rewards_channel_id")) {
      this.settings.channelId = String(this.values[0]);
      this.settings.storeMessageId = String(this.values[1]);
      this.settings.raffleMessageId = String(this.values[2]);
    }
    return { success: true, meta: { changes: 1 } } as D1Result;
  }
}

function createEnv(settings: Settings): Env {
  const db = {
    prepare: (sql: string) => new AnnouncementStatement(settings, sql),
    batch: async (statements: AnnouncementStatement[]) => Promise.all(statements.map((statement) => statement.run()))
  } as unknown as D1Database;
  return {
    DB: db,
    APP_NAME: "Holder Rewards",
    REWARD_CURRENCY_NAME: "Points",
    DISCORD_BOT_TOKEN: "test-token"
  };
}

beforeEach(() => {
  let message = 0;
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ id: `message-${++message}` })));
});

afterEach(() => vi.unstubAllGlobals());

describe("store and raffle announcements", () => {
  it("publishes permanent panels and updates them when the channel is saved again", async () => {
    const settings: Settings = { channelId: null, storeMessageId: null, raffleMessageId: null };
    const env = createEnv(settings);

    await expect(
      configureRewardsChannel(env, "123456789012345678", "323456789012345678", "https://rewards.example")
    ).resolves.toMatchObject({ channelId: "323456789012345678" });
    expect(settings).toEqual({
      channelId: "323456789012345678",
      storeMessageId: "message-1",
      raffleMessageId: "message-2"
    });

    await configureRewardsChannel(env, "123456789012345678", "323456789012345678", "https://rewards.example");
    const calls = vi.mocked(fetch).mock.calls;
    expect(calls).toHaveLength(4);
    expect(calls.slice(0, 2).every(([, init]) => init?.method === "POST")).toBe(true);
    expect(calls.slice(2).every(([, init]) => init?.method === "PATCH")).toBe(true);
  });
});
