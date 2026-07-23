import nacl from "tweetnacl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DiscordInteraction, Env } from "../src/types.js";

const mocks = vi.hoisted(() => ({
  addRoleRule: vi.fn(),
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
  listManageableDiscordRoles: vi.fn(),
  listRoleRules: vi.fn(),
  recordAuditEvent: vi.fn(),
  removeRoleRule: vi.fn(),
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
});

describe("Discord interaction safety", () => {
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
