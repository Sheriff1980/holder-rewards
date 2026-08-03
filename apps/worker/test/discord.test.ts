import nacl from "tweetnacl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DiscordInteraction, Env } from "../src/types.js";

const mocks = vi.hoisted(() => ({
  addRoleRule: vi.fn(),
  auditPointsLedger: vi.fn(),
  claimDailyPoints: vi.fn(),
  createAdminSession: vi.fn(),
  createVerificationSession: vi.fn(),
  getGuildBranding: vi.fn(),
  getPointsBalance: vi.fn(),
  getPointsLeaderboard: vi.fn(),
  getRewardSettings: vi.fn(),
  grantPoints: vi.fn(),
  hasBrandLogo: vi.fn(),
  hasCurrencyIcon: vi.fn(),
  listQuests: vi.fn(),
  listQuestsWithStatus: vi.fn(),
  listRaffleEntriesForMember: vi.fn(),
  listRaffles: vi.fn(),
  listManageableDiscordRoles: vi.fn(),
  listRoleRules: vi.fn(),
  listStoreItems: vi.fn(),
  listStorePurchaseCountsForMember: vi.fn(),
  purchaseStoreItem: vi.fn(),
  recordAuditEvent: vi.fn(),
  removeRoleRule: vi.fn(),
  enterRaffle: vi.fn(),
  submitQuestCode: vi.fn(),
  submitQuestProof: vi.fn(),
  checkQuest: vi.fn(),
  syncMemberRoles: vi.fn(),
  updateRoleMatchMode: vi.fn()
}));

vi.mock("../src/admin.js", () => ({
  createAdminSession: mocks.createAdminSession,
  listManageableDiscordRoles: mocks.listManageableDiscordRoles
}));
vi.mock("../src/audit.js", () => ({
  recordAuditEvent: mocks.recordAuditEvent
}));
vi.mock("../src/verification.js", () => ({
  createVerificationSession: mocks.createVerificationSession
}));
vi.mock("../src/rules.js", () => ({
  addRoleRule: mocks.addRoleRule,
  listRoleRules: mocks.listRoleRules,
  removeRoleRule: mocks.removeRoleRule,
  syncMemberRoles: mocks.syncMemberRoles,
  updateRoleMatchMode: mocks.updateRoleMatchMode
}));
vi.mock("../src/points.js", () => ({
  auditPointsLedger: mocks.auditPointsLedger,
  claimDailyPoints: mocks.claimDailyPoints,
  getPointsBalance: mocks.getPointsBalance,
  getPointsLeaderboard: mocks.getPointsLeaderboard,
  getRewardSettings: mocks.getRewardSettings,
  grantPoints: mocks.grantPoints
}));
vi.mock("../src/assets.js", () => ({
  brandLogoUrl: vi.fn(),
  currencyIconUrl: vi.fn(),
  hasBrandLogo: mocks.hasBrandLogo,
  hasCurrencyIcon: mocks.hasCurrencyIcon
}));
vi.mock("../src/branding.js", () => ({
  accentColorNumber: vi.fn(),
  getGuildBranding: mocks.getGuildBranding
}));
vi.mock("../src/quests.js", () => ({
  QuestError: class QuestError extends Error {},
  checkQuest: mocks.checkQuest,
  listQuests: mocks.listQuests,
  listQuestsWithStatus: mocks.listQuestsWithStatus,
  submitQuestCode: mocks.submitQuestCode,
  submitQuestProof: mocks.submitQuestProof
}));
vi.mock("../src/raffles.js", () => ({
  RaffleError: class RaffleError extends Error {},
  enterRaffle: mocks.enterRaffle,
  listRaffleEntriesForMember: mocks.listRaffleEntriesForMember,
  listRaffles: mocks.listRaffles
}));
vi.mock("../src/store.js", () => ({
  StoreError: class StoreError extends Error {},
  listStoreItems: mocks.listStoreItems,
  listStorePurchaseCountsForMember: mocks.listStorePurchaseCountsForMember,
  purchaseStoreItem: mocks.purchaseStoreItem
}));

import {
  handleDiscordInteraction,
  verifyDiscordRequest
} from "../src/discord.js";

class InteractionStatement {
  private values: unknown[] = [];

  constructor(
    private readonly interactionIds: Set<string>,
    private readonly sql: string
  ) {}

  bind(...values: unknown[]): this {
    this.values = values;
    return this;
  }

  async run(): Promise<D1Result> {
    if (this.sql.includes("INSERT OR IGNORE INTO discord_interactions")) {
      const interactionId = String(this.values[0]);
      const inserted = !this.interactionIds.has(interactionId);
      this.interactionIds.add(interactionId);
      return {
        success: true,
        meta: { changes: inserted ? 1 : 0 }
      } as D1Result;
    }
    return { success: true, meta: { changes: 0 } } as D1Result;
  }
}

function createEnv(interactionIds = new Set<string>()): Env {
  return {
    DB: {
      prepare: (sql: string) => new InteractionStatement(interactionIds, sql)
    } as unknown as D1Database,
    APP_NAME: "Holder Rewards",
    REWARD_CURRENCY_NAME: "Points",
    DISCORD_BOT_TOKEN: "bot-token"
  };
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function pointsGrantInteraction(id: string): DiscordInteraction {
  return {
    id,
    type: 2,
    guild_id: "123456789012345678",
    member: {
      permissions: String(1n << 5n),
      user: { id: "223456789012345678" }
    },
    data: {
      name: "points",
      options: [
        {
          name: "grant",
          type: 1,
          options: [
            { name: "member", type: 6, value: "323456789012345678" },
            { name: "amount", type: 4, value: 25 }
          ]
        }
      ]
    }
  };
}

function pointsClaimInteraction(id: string): DiscordInteraction {
  return {
    id,
    type: 2,
    guild_id: "123456789012345678",
    member: {
      permissions: "0",
      user: { id: "223456789012345678" }
    },
    data: {
      name: "points",
      options: [{ name: "claim", type: 1 }]
    }
  };
}

function verifyRefreshInteraction(id: string): DiscordInteraction {
  return {
    id,
    type: 2,
    guild_id: "123456789012345678",
    member: {
      permissions: "0",
      user: { id: "223456789012345678" }
    },
    data: {
      name: "verify",
      options: [{ name: "refresh", type: 1 }]
    }
  };
}

function pointsAuditInteraction(id: string): DiscordInteraction {
  return {
    id,
    type: 2,
    guild_id: "123456789012345678",
    member: {
      permissions: String(1n << 5n),
      user: { id: "223456789012345678" }
    },
    data: {
      name: "points",
      options: [{ name: "audit", type: 1 }]
    }
  };
}

function addRuleInteraction(id: string, roleId = "423456789012345678"): DiscordInteraction {
  return {
    id,
    type: 2,
    guild_id: "123456789012345678",
    member: {
      permissions: String(1n << 5n),
      user: { id: "223456789012345678" }
    },
    data: {
      name: "rules",
      options: [
        {
          name: "add-nft",
          type: 1,
          options: [
            { name: "chain", type: 3, value: "ethereum" },
            { name: "contract", type: 3, value: "0x1111111111111111111111111111111111111111" },
            { name: "minimum", type: 4, value: 1 },
            { name: "role", type: 8, value: roleId }
          ]
        }
      ]
    }
  };
}

async function responseContent(response: Response): Promise<string> {
  const body = (await response.json()) as { data?: { content?: string } };
  return body.data?.content ?? "";
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.hasCurrencyIcon.mockResolvedValue(false);
  mocks.listManageableDiscordRoles.mockResolvedValue([
    { id: "423456789012345678", name: "Holder", color: 0, position: 2 }
  ]);
  mocks.grantPoints.mockResolvedValue({
    amount: 25,
    balance: 25,
    currencyName: "Points"
  });
  mocks.addRoleRule.mockResolvedValue({
    id: "rule-1",
    roleId: "423456789012345678",
    chainId: "ethereum"
  });
  mocks.recordAuditEvent.mockResolvedValue(undefined);
  mocks.claimDailyPoints.mockResolvedValue({
    claimed: true,
    amount: 10,
    balance: 10,
    currencyName: "Points"
  });
  mocks.auditPointsLedger.mockResolvedValue({
    transactionCount: 4,
    memberCount: 2,
    netPoints: 55
  });
  mocks.getRewardSettings.mockResolvedValue({
    currencyName: "Points",
    dailyClaimAmount: 10,
    holderDailyAmount: 5
  });
  mocks.getPointsBalance.mockResolvedValue(100);
  mocks.listQuests.mockResolvedValue([]);
  mocks.listQuestsWithStatus.mockResolvedValue([]);
  mocks.listRaffles.mockResolvedValue([]);
  mocks.listRaffleEntriesForMember.mockResolvedValue(new Map());
  mocks.listStoreItems.mockResolvedValue([]);
  mocks.listStorePurchaseCountsForMember.mockResolvedValue(new Map());
});

describe("Discord interaction safety", () => {
  it("blocks manager dashboard buttons for members without Manage Server", async () => {
    const response = await handleDiscordInteraction({
      id: "103456789012345678",
      type: 3,
      guild_id: "123456789012345678",
      member: { permissions: "0", user: { id: "223456789012345678" } },
      data: { custom_id: "manager:home" }
    }, new URL("https://holder.example/interactions"), createEnv());

    expect(await responseContent(response)).toContain("Manage Server permission");
    expect(mocks.createAdminSession).not.toHaveBeenCalled();
  });

  it("opens store items privately inside Discord without a website link", async () => {
    mocks.listStoreItems.mockResolvedValue([{
      id: "item-1",
      guildId: "123456789012345678",
      title: "Neon Role",
      description: "Limited community role",
      price: 25,
      roleId: null,
      stock: 3,
      purchaseLimitPerMember: 1
    }]);

    const response = await handleDiscordInteraction({
      id: "113456789012345678",
      type: 3,
      guild_id: "123456789012345678",
      member: { permissions: "0", user: { id: "223456789012345678" } },
      data: { custom_id: "rewards:open:store" }
    }, new URL("https://holder.example/interactions"), createEnv());
    const body = await response.json() as { data: { flags: number; content: string; components: Array<{ components: Array<Record<string, unknown>> }> } };

    expect(body.data.flags).toBe(64);
    expect(body.data.content).toContain("Neon Role");
    expect(body.data.content).not.toContain("https://");
    expect(body.data.components[0]?.components[0]).toEqual(expect.objectContaining({
      label: "Buy: Neon Role",
      custom_id: "store:buy:item-1"
    }));
  });

  it("opens private quest actions including a Discord code form", async () => {
    mocks.listQuestsWithStatus.mockResolvedValue([{
      id: "quest-1",
      guildId: "123456789012345678",
      title: "Find the code",
      kind: "code",
      config: {},
      reward: 10,
      completed: false,
      pendingSubmission: false
    }]);

    const response = await handleDiscordInteraction({
      id: "123456789012345679",
      type: 3,
      guild_id: "123456789012345678",
      member: { permissions: "0", user: { id: "223456789012345678" } },
      data: { custom_id: "rewards:open:quests" }
    }, new URL("https://holder.example/interactions"), createEnv());
    const body = await response.json() as { data: { flags: number; components: Array<{ components: Array<Record<string, unknown>> }> } };

    expect(body.data.flags).toBe(64);
    expect(body.data.components[0]?.components[0]).toEqual(expect.objectContaining({
      label: "Enter code: Find the code",
      custom_id: "quest:code:quest-1"
    }));
  });

  it("buys store items directly from a private Discord button", async () => {
    mocks.purchaseStoreItem.mockResolvedValue({
      item: { id: "item-1", title: "Neon Role", price: 25, roleId: null },
      balance: 75,
      roleGranted: false,
      currencyName: "Points"
    });

    const response = await handleDiscordInteraction({
      id: "133456789012345678",
      type: 3,
      guild_id: "123456789012345678",
      member: { permissions: "0", user: { id: "223456789012345678" } },
      data: { custom_id: "store:buy:item-1" }
    }, new URL("https://holder.example/interactions"), createEnv());

    expect(await responseContent(response)).toContain("You bought **Neon Role**");
    expect(mocks.purchaseStoreItem).toHaveBeenCalledWith(expect.anything(), {
      guildId: "123456789012345678",
      itemId: "item-1",
      discordUserId: "223456789012345678"
    });
  });

  it("buys one raffle entry directly from a private Discord button", async () => {
    mocks.enterRaffle.mockResolvedValue({
      raffle: { id: "raffle-1", title: "Grid Pass" },
      count: 1,
      cost: 5,
      balance: 95,
      currencyName: "Points"
    });

    const response = await handleDiscordInteraction({
      id: "143456789012345678",
      type: 3,
      guild_id: "123456789012345678",
      member: { permissions: "0", user: { id: "223456789012345678" } },
      data: { custom_id: "raffle:enter:raffle-1" }
    }, new URL("https://holder.example/interactions"), createEnv());

    expect(await responseContent(response)).toContain("bought 1 entry in **Grid Pass**");
    expect(mocks.enterRaffle).toHaveBeenCalledWith(expect.anything(), {
      guildId: "123456789012345678",
      raffleId: "raffle-1",
      discordUserId: "223456789012345678",
      count: 1
    });
  });

  it("accepts a fresh signature and rejects an otherwise valid stale signature", () => {
    const keyPair = nacl.sign.keyPair();
    const rawBody = JSON.stringify({ id: "123456789012345678", type: 1 });
    const freshTimestamp = Math.floor(Date.now() / 1000).toString();
    const staleTimestamp = Math.floor((Date.now() - 6 * 60 * 1000) / 1000).toString();
    const freshSignature = nacl.sign.detached(
      new TextEncoder().encode(freshTimestamp + rawBody),
      keyPair.secretKey
    );
    const staleSignature = nacl.sign.detached(
      new TextEncoder().encode(staleTimestamp + rawBody),
      keyPair.secretKey
    );

    expect(
      verifyDiscordRequest(
        rawBody,
        bytesToHex(freshSignature),
        freshTimestamp,
        bytesToHex(keyPair.publicKey)
      )
    ).toBe(true);
    expect(
      verifyDiscordRequest(
        rawBody,
        bytesToHex(staleSignature),
        staleTimestamp,
        bytesToHex(keyPair.publicKey)
      )
    ).toBe(false);
  });

  it("executes a duplicate points grant only once", async () => {
    const env = createEnv();
    const interaction = pointsGrantInteraction("523456789012345678");

    const first = await handleDiscordInteraction(
      interaction,
      new URL("https://holder.example/interactions"),
      env
    );
    const duplicate = await handleDiscordInteraction(
      interaction,
      new URL("https://holder.example/interactions"),
      env
    );

    expect(await responseContent(first)).toContain("received 25 Points");
    expect(await responseContent(duplicate)).toContain("no action was repeated");
    expect(mocks.grantPoints).toHaveBeenCalledTimes(1);
  });

  it("allows a daily claim only after holder qualification is confirmed", async () => {
    mocks.syncMemberRoles.mockResolvedValue({
      added: [],
      removed: [],
      unchanged: ["423456789012345678"],
      qualified: ["423456789012345678"],
      errors: []
    });

    const response = await handleDiscordInteraction(
      pointsClaimInteraction("543456789012345678"),
      new URL("https://holder.example/interactions"),
      createEnv()
    );

    expect(await responseContent(response)).toContain("collected 10 Points");
    expect(mocks.claimDailyPoints).toHaveBeenCalledTimes(1);
  });

  it("names the roles affected by a member refresh", async () => {
    mocks.syncMemberRoles.mockResolvedValue({
      added: ["423456789012345678"],
      removed: ["523456789012345678"],
      unchanged: ["623456789012345678"],
      qualified: ["423456789012345678", "623456789012345678"],
      errors: [{ roleId: "723456789012345678", message: "RPC timeout" }]
    });

    const response = await handleDiscordInteraction(
      verifyRefreshInteraction("823456789012345678"),
      new URL("https://example.com/interactions"),
      createEnv()
    );
    const content = await responseContent(response);

    expect(content).toContain("**You qualify for:** <@&423456789012345678>, <@&623456789012345678>");
    expect(content).toContain("**Added now:** <@&423456789012345678>");
    expect(content).toContain("**Removed now:** <@&523456789012345678>");
    expect(content).toContain("**Could not check or update:** <@&723456789012345678>");
    expect(content).not.toContain("unchanged");
  });

  it("does not consume a daily claim for an unqualified member", async () => {
    mocks.syncMemberRoles.mockResolvedValue({
      added: [],
      removed: [],
      unchanged: [],
      qualified: [],
      errors: []
    });

    const response = await handleDiscordInteraction(
      pointsClaimInteraction("553456789012345678"),
      new URL("https://holder.example/interactions"),
      createEnv()
    );

    expect(await responseContent(response)).toContain("Link a qualifying wallet");
    expect(mocks.claimDailyPoints).not.toHaveBeenCalled();
  });

  it("allows a daily claim when a previously verified holder role is retained during an RPC failure", async () => {
    mocks.syncMemberRoles.mockResolvedValue({
      added: [],
      removed: [],
      unchanged: ["423456789012345678"],
      qualified: [],
      errors: [{ roleId: "423456789012345678", message: "RPC timeout" }]
    });

    const response = await handleDiscordInteraction(
      pointsClaimInteraction("563456789012345678"),
      new URL("https://holder.example/interactions"),
      createEnv()
    );

    expect(await responseContent(response)).toContain("collected 10 Points");
    expect(mocks.claimDailyPoints).toHaveBeenCalledTimes(1);
  });

  it("does not consume a daily claim when ownership fails and no holder role is retained", async () => {
    mocks.syncMemberRoles.mockResolvedValue({
      added: [],
      removed: [],
      unchanged: [],
      qualified: [],
      errors: [{ roleId: "423456789012345678", message: "RPC timeout" }]
    });

    const response = await handleDiscordInteraction(
      pointsClaimInteraction("573456789012345678"),
      new URL("https://holder.example/interactions"),
      createEnv()
    );

    expect(await responseContent(response)).toContain("could not be confirmed");
    expect(mocks.claimDailyPoints).not.toHaveBeenCalled();
  });

  it("lets a server manager recalculate the rewards ledger", async () => {
    const response = await handleDiscordInteraction(
      pointsAuditInteraction("573456789012345678"),
      new URL("https://holder.example/interactions"),
      createEnv()
    );

    expect(await responseContent(response)).toContain("4 transactions, 2 members, 55 net points");
    expect(mocks.auditPointsLedger).toHaveBeenCalledWith(
      expect.anything(),
      "123456789012345678"
    );
  });

  it("executes duplicate slash-command rule creation only once", async () => {
    const env = createEnv();
    const interaction = addRuleInteraction("623456789012345678");

    const first = await handleDiscordInteraction(
      interaction,
      new URL("https://holder.example/interactions"),
      env
    );
    const duplicate = await handleDiscordInteraction(
      interaction,
      new URL("https://holder.example/interactions"),
      env
    );

    expect(await responseContent(first)).toContain("Rule rule-1 was added");
    expect(await responseContent(duplicate)).toContain("no action was repeated");
    expect(mocks.listManageableDiscordRoles).toHaveBeenCalledTimes(1);
    expect(mocks.addRoleRule).toHaveBeenCalledTimes(1);
  });

  it("rejects slash-command rules for roles the bot cannot manage", async () => {
    mocks.listManageableDiscordRoles.mockResolvedValue([]);

    const response = await handleDiscordInteraction(
      addRuleInteraction("723456789012345678"),
      new URL("https://holder.example/interactions"),
      createEnv()
    );

    expect(await responseContent(response)).toContain(
      "Move the bot's role above it in Server Settings"
    );
    expect(mocks.addRoleRule).not.toHaveBeenCalled();
  });
});
