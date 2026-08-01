import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DiscordInteraction, Env } from "../src/types.js";

const mocks = vi.hoisted(() => ({
  announceQuest: vi.fn(),
  announceRaffle: vi.fn(),
  announceStoreItem: vi.fn(),
  cancelRaffle: vi.fn(),
  configureQuestChannel: vi.fn(),
  configureRewardsChannel: vi.fn(),
  createAdminSession: vi.fn(),
  createQuest: vi.fn(),
  createRaffle: vi.fn(),
  createStoreItem: vi.fn(),
  drawRaffle: vi.fn(),
  getQuestChannelSettings: vi.fn(),
  getRewardSettings: vi.fn(),
  getRewardsChannelSettings: vi.fn(),
  listPendingSubmissions: vi.fn(),
  listQuests: vi.fn(),
  listRaffles: vi.fn(),
  listStoreItems: vi.fn(),
  recordAuditEvent: vi.fn(),
  removeQuest: vi.fn(),
  removeStoreItem: vi.fn(),
  reviewQuestSubmission: vi.fn(),
  updateRewardSettings: vi.fn()
}));

vi.mock("../src/admin.js", () => ({ createAdminSession: mocks.createAdminSession }));
vi.mock("../src/audit.js", () => ({ recordAuditEvent: mocks.recordAuditEvent }));
vi.mock("../src/announcements.js", () => ({
  announceQuest: mocks.announceQuest,
  announceRaffle: mocks.announceRaffle,
  announceStoreItem: mocks.announceStoreItem,
  configureQuestChannel: mocks.configureQuestChannel,
  configureRewardsChannel: mocks.configureRewardsChannel,
  getQuestChannelSettings: mocks.getQuestChannelSettings,
  getRewardsChannelSettings: mocks.getRewardsChannelSettings
}));
vi.mock("../src/quests.js", () => ({
  QuestError: class QuestError extends Error {},
  createQuest: mocks.createQuest,
  listPendingSubmissions: mocks.listPendingSubmissions,
  listQuests: mocks.listQuests,
  removeQuest: mocks.removeQuest,
  reviewQuestSubmission: mocks.reviewQuestSubmission
}));
vi.mock("../src/points.js", () => ({
  RewardSettingsError: class RewardSettingsError extends Error {},
  getRewardSettings: mocks.getRewardSettings,
  updateRewardSettings: mocks.updateRewardSettings
}));
vi.mock("../src/raffles.js", () => ({
  RaffleError: class RaffleError extends Error {},
  cancelRaffle: mocks.cancelRaffle,
  createRaffle: mocks.createRaffle,
  drawRaffle: mocks.drawRaffle,
  listRaffles: mocks.listRaffles
}));
vi.mock("../src/store.js", () => ({
  StoreError: class StoreError extends Error {},
  createStoreItem: mocks.createStoreItem,
  listStoreItems: mocks.listStoreItems,
  removeStoreItem: mocks.removeStoreItem
}));

import { handleManagerInteraction, managerDashboardResponse } from "../src/manager-discord.js";

const env = {
  DB: {} as D1Database,
  APP_NAME: "Holder Rewards",
  REWARD_CURRENCY_NAME: "Fragments",
  DISCORD_BOT_TOKEN: "token"
} satisfies Env;

function component(id: string, type = 3): DiscordInteraction {
  return {
    id: "123456789012345678",
    type,
    guild_id: "223456789012345678",
    member: { permissions: String(1n << 5n), user: { id: "323456789012345678" } },
    data: { custom_id: id }
  };
}

function modalInteraction(id: string, values: Record<string, string>): DiscordInteraction {
  return {
    ...component(id, 5),
    data: {
      custom_id: id,
      components: Object.entries(values).map(([custom_id, value]) => ({
        type: 1,
        components: [{ type: 4, custom_id, value }]
      }))
    }
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createAdminSession.mockResolvedValue("private-token");
  mocks.getRewardSettings.mockResolvedValue({ currencyName: "Fragments", dailyClaimAmount: 10, holderDailyAmount: 2, tipDailyLimit: 100 });
  mocks.getQuestChannelSettings.mockResolvedValue({ channelId: null, panelMessageId: null });
  mocks.getRewardsChannelSettings.mockResolvedValue({ channelId: null, storePanelMessageId: null, rafflePanelMessageId: null });
  mocks.listPendingSubmissions.mockResolvedValue([]);
  mocks.listQuests.mockResolvedValue([]);
  mocks.listRaffles.mockResolvedValue([]);
  mocks.listStoreItems.mockResolvedValue([]);
  mocks.recordAuditEvent.mockResolvedValue(undefined);
});

describe("Discord manager dashboard", () => {
  it("opens a private dashboard with Discord controls and an optional advanced link", async () => {
    const response = await managerDashboardResponse(
      env,
      "223456789012345678",
      "323456789012345678",
      new URL("https://rewards.example/interactions")
    );
    const body = await response.json() as { data: { flags: number; components: Array<{ components: Array<Record<string, unknown>> }> } };

    expect(body.data.flags).toBe(64);
    expect(body.data.components[0]?.components).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "Reward settings", custom_id: "manager:rewards" }),
      expect.objectContaining({ label: "Quests", custom_id: "manager:quests" }),
      expect.objectContaining({ label: "Store", custom_id: "manager:store" }),
      expect.objectContaining({ label: "Raffles", custom_id: "manager:raffles" })
    ]));
    expect(body.data.components[1]?.components).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "Review quest proofs", custom_id: "manager:proofs" }),
      expect.objectContaining({ label: "Advanced manager", url: "https://rewards.example/manage?token=private-token" })
    ]));
  });

  it("saves reward settings from a Discord modal", async () => {
    mocks.updateRewardSettings.mockResolvedValue({ currencyName: "Fragments", dailyClaimAmount: 20, holderDailyAmount: 5, tipDailyLimit: 200 });
    const response = await handleManagerInteraction(
      modalInteraction("manager:rewards:save", { currency: "Fragments", daily: "20", holder: "5", tips: "200" }),
      new URL("https://rewards.example/interactions"),
      env,
      "223456789012345678",
      "323456789012345678"
    );
    const body = await response!.json() as { data: { content: string } };

    expect(body.data.content).toContain("Reward settings saved");
    expect(mocks.updateRewardSettings).toHaveBeenCalledWith(expect.anything(), "223456789012345678", {
      currencyName: "Fragments",
      dailyClaimAmount: "20",
      holderDailyAmount: "5",
      tipDailyLimit: "200"
    });
  });

  it("creates and publicly announces a custom quest from Discord", async () => {
    mocks.createQuest.mockResolvedValue({
      id: "quest-1",
      guildId: "223456789012345678",
      title: "Retweet",
      kind: "custom",
      config: { instructions: "Paste the retweet link" },
      reward: 25
    });
    mocks.announceQuest.mockResolvedValue(true);
    const response = await handleManagerInteraction(
      modalInteraction("manager:quest:create:custom", { title: "Retweet", reward: "25", instructions: "Paste the retweet link" }),
      new URL("https://rewards.example/interactions"),
      env,
      "223456789012345678",
      "323456789012345678"
    );
    const body = await response!.json() as { data: { content: string } };

    expect(body.data.content).toContain("Quest **Retweet** created");
    expect(body.data.content).toContain("public quest announcement was posted");
    expect(mocks.announceQuest).toHaveBeenCalledOnce();
  });

  it("shows pending proof inside Discord with approve and reject controls", async () => {
    mocks.listPendingSubmissions.mockResolvedValue([{
      id: "submission-1",
      guildId: "223456789012345678",
      questId: "quest-1",
      questTitle: "Retweet",
      discordUserId: "423456789012345678",
      proof: "https://social.example/post/1",
      status: "pending",
      submittedAt: "2026-08-01T00:00:00Z"
    }]);
    const response = await handleManagerInteraction(
      component("manager:proofs"),
      new URL("https://rewards.example/interactions"),
      env,
      "223456789012345678",
      "323456789012345678"
    );
    const body = await response!.json() as { data: { content: string; components: Array<{ components: Array<Record<string, unknown>> }> } };

    expect(body.data.content).toContain("https://social.example/post/1");
    expect(body.data.components[0]?.components).toEqual(expect.arrayContaining([
      expect.objectContaining({ custom_id: "manager:proof:approve:submission-1" }),
      expect.objectContaining({ custom_id: "manager:proof:reject:submission-1" })
    ]));
  });
});
