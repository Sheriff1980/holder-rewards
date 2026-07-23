import { describe, expect, it } from "vitest";
import type { ChainHealth } from "../src/health.js";
import { checkLaunchReadiness } from "../src/readiness.js";
import type { Env } from "../src/types.js";

function createEnv(databaseReady = true): Env {
  return {
    DB: {
      prepare: () => ({
        first: async () => (databaseReady ? { ok: 1 } : null)
      })
    } as unknown as D1Database,
    APP_NAME: "Holder Rewards",
    REWARD_CURRENCY_NAME: "Points",
    DISCORD_BOT_TOKEN: "test-token"
  };
}

const healthyProviders: ChainHealth[] = [
  {
    id: "apechain",
    name: "ApeChain",
    family: "evm",
    status: "healthy",
    message: "EVM RPC is healthy and on the correct network.",
    latencyMs: 42
  },
  {
    id: "solana",
    name: "Solana",
    family: "solana",
    status: "healthy",
    message: "Solana RPC is healthy.",
    latencyMs: 55
  }
];

describe("launch readiness", () => {
  it("reports ready when app data, Discord, and providers are ready", async () => {
    const result = await checkLaunchReadiness(createEnv(), "https://holder.example", {
      discord: async () => ({
        ready: true,
        local: false,
        inviteUrl: "https://discord.com/oauth2/authorize",
        message: "Discord is connected and up to date."
      }),
      providers: async () => healthyProviders
    });

    expect(result.ready).toBe(true);
    expect(result.inviteUrl).toContain("discord.com");
    expect(result.checks).toEqual([
      expect.objectContaining({ id: "database", status: "ready" }),
      expect.objectContaining({ id: "discord", status: "ready" }),
      expect.objectContaining({ id: "network-apechain", status: "ready" }),
      expect.objectContaining({ id: "network-solana", status: "ready" })
    ]);
  });

  it("treats a local Discord preview as waiting rather than broken", async () => {
    const result = await checkLaunchReadiness(createEnv(), "http://127.0.0.1:8787", {
      discord: async () => ({
        ready: false,
        local: true,
        inviteUrl: "",
        message: "This is a local preview."
      }),
      providers: async () => healthyProviders
    });

    expect(result.ready).toBe(false);
    expect(result.checks).toContainEqual(
      expect.objectContaining({ id: "discord", status: "waiting" })
    );
    expect(result.checks.some((check) => check.status === "problem")).toBe(false);
  });

  it("identifies database and provider problems without exposing an RPC URL", async () => {
    const result = await checkLaunchReadiness(createEnv(false), "https://holder.example", {
      discord: async () => ({
        ready: true,
        local: false,
        inviteUrl: "https://discord.com/oauth2/authorize",
        message: "Discord is connected."
      }),
      providers: async () => [
        {
          ...healthyProviders[0],
          status: "unhealthy",
          message: "Provider could not be reached."
        }
      ]
    });

    expect(result.ready).toBe(false);
    expect(result.checks).toContainEqual(
      expect.objectContaining({ id: "database", status: "problem" })
    );
    expect(result.checks).toContainEqual(
      expect.objectContaining({
        id: "network-apechain",
        status: "problem",
        message: "Provider could not be reached."
      })
    );
    expect(JSON.stringify(result.checks)).not.toContain("http");
  });
});
