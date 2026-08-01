import nacl from "tweetnacl";
import { describe, expect, it } from "vitest";
import { handleRequest } from "../src/index.js";
import {
  createDiscordInviteUrl,
  discordCommands,
  handleDiscordInteraction
} from "../src/discord.js";
import type { Env } from "../src/types.js";

class FakeStatement {
  constructor(private readonly sql: string, private readonly publicKey: string) {}

  bind(): this {
    return this;
  }

  async first<T>(): Promise<T | null> {
    if (this.sql.includes("app_state") && this.sql.includes("value")) {
      return { value: this.publicKey } as T;
    }
    if (this.sql.includes("FROM guild_settings") || this.sql.includes("guild_brand_assets") || this.sql.includes("guild_assets")) {
      return null;
    }
    return { ok: 1 } as T;
  }

  async run(): Promise<D1Result> {
    return { success: true, meta: {} } as D1Result;
  }

  async all<T>(): Promise<D1Result<T>> {
    return { success: true, results: [], meta: {} } as unknown as D1Result<T>;
  }
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function createEnv(publicKey = "00".repeat(32)): Env {
  return {
    DB: {
      prepare: (sql: string) => new FakeStatement(sql, publicKey),
      batch: async () => []
    } as unknown as D1Database,
    APP_NAME: "Holder Rewards",
    REWARD_CURRENCY_NAME: "Points",
    DISCORD_BOT_TOKEN: "test-bot-token",
    SETUP_TOKEN: "test-setup-password"
  };
}

describe("Cloudflare Worker", () => {
  it("shows automatic Discord setup instead of a command-registration form", async () => {
    const response = await handleRequest(new Request("http://127.0.0.1:8787/"), createEnv());
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("Discord connects automatically after the app is deployed.");
    expect(html).toContain("Launch check");
    expect(html).toContain("Checking everything");
    expect(html).toContain("Retry launch check");
    expect(html).toContain("Advanced network settings");
    expect(html).not.toContain("Register Discord commands");
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
    expect(scripts.length).toBeGreaterThan(0);
    for (const script of scripts) {
      expect(() => new Function(script[1])).not.toThrow();
    }
  });

  it("returns a healthy status when D1 responds", async () => {
    const response = await handleRequest(new Request("https://example.com/health"), createEnv());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, database: true });
  });

  it("does not reflect legacy guild IDs in verification HTML", async () => {
    const payload = "<script>alert('xss')</script>";
    const response = await handleRequest(
      new Request(`https://example.com/verify?guild_id=${encodeURIComponent(payload)}`),
      createEnv()
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).not.toContain(payload);
    expect(html).toContain("Wallet verification");
    expect(html).toContain("eip6963:requestProvider");
    expect(html).toContain("Share private link");
    expect(html).toContain("Copy private link");
    expect(html).toContain("data:image/svg+xml");
    expect(html).toContain("Scan with your phone");
    expect(html).toContain("wallet-standard:app-ready");
    expect(html).toContain("connectSolana");
  });

  it("serves the private browser rule manager without embedding URL data", async () => {
    const payload = "<script>alert('xss')</script>";
    const response = await handleRequest(
      new Request(`https://example.com/manage?guild=${encodeURIComponent(payload)}`),
      createEnv()
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("Community rewards");
    expect(html).toContain("Store and raffle channel");
    expect(html).toContain("Save and publish panels");
    expect(html).toContain("Quest channel");
    expect(html).toContain("Save and publish panel");
    expect(html).toContain("Verified members");
    expect(html).toContain("Recent activity");
    expect(html).toContain("Sync problems");
    expect(html).toContain("Checking networks");
    expect(html).toContain("Retry network check");
    expect(html).toContain("Network status");
    expect(html).toContain("Community branding");
    expect(html).toContain("Privacy and exports");
    expect(html).toContain("Allow managers to export full wallet addresses");
    expect(html).toContain('data-export="holders"');
    expect(html).toContain('data-export="balances"');
    expect(html).toContain('data-export="wallets"');
    expect(html).toContain('data-export="audit"');
    expect(html).toContain("Community logo");
    expect(html).toContain("Accent color");
    expect(html).toContain("Currency name");
    expect(html).toContain("Daily reward");
    expect(html).toContain("Currency image");
    expect(html).toContain("Upload image");
    expect(html).toContain("Add a holder role");
    expect(html).toContain("Active holder roles");
    expect(html).toContain("Solana token or NFT mint");
    expect(html).toContain('typeInput.value = "spl-token"');
    expect(html).toContain('typeInput.value = "erc721"');
    expect(html).toContain('chainInput.addEventListener("change", syncRequirementForNetwork)');
    expect(html).toContain("Any requirement");
    expect(html).toContain("All requirements");
    expect(html).toContain("Advanced network settings");
    expect(html).toContain("Add an EVM-compatible network");
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
    expect(scripts.length).toBeGreaterThan(0);
    for (const script of scripts) {
      expect(() => new Function(script[1])).not.toThrow();
    }
    expect(html).not.toContain(payload);
  });

  it("serves the private member rewards page without embedding URL data", async () => {
    const payload = "<script>alert('xss')</script>";
    const response = await handleRequest(
      new Request(`https://example.com/rewards?token=${encodeURIComponent(payload)}&view=store`),
      createEnv()
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).not.toContain(payload);
    expect(html).toContain("Community rewards");
    expect(html).toContain("Quests");
    expect(html).toContain("Store");
    expect(html).toContain("Raffles");
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
    expect(scripts.length).toBeGreaterThan(0);
    for (const script of scripts) expect(() => new Function(script[1])).not.toThrow();
  });

  it("rejects manager API requests without a private Discord session", async () => {
    const response = await handleRequest(
      new Request("https://example.com/api/admin/session"),
      createEnv()
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: "This manager link is invalid or incomplete."
    });
  });

  it("accepts a correctly signed Discord PING", async () => {
    const keyPair = nacl.sign.keyPair();
    const body = JSON.stringify({ id: "123456789012345678", type: 1 });
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = nacl.sign.detached(
      new TextEncoder().encode(timestamp + body),
      keyPair.secretKey
    );
    const request = new Request("https://example.com/interactions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Signature-Ed25519": bytesToHex(signature),
        "X-Signature-Timestamp": timestamp
      },
      body
    });

    const response = await handleRequest(request, createEnv(bytesToHex(keyPair.publicKey)));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ type: 1 });
  });

  it("rejects interactions with an invalid signature", async () => {
    const keyPair = nacl.sign.keyPair();
    const response = await handleRequest(
      new Request("https://example.com/interactions", {
        method: "POST",
        headers: {
          "X-Signature-Ed25519": "00".repeat(64),
          "X-Signature-Timestamp": Math.floor(Date.now() / 1000).toString()
        },
        body: JSON.stringify({ id: "123456789012345678", type: 1 })
      }),
      createEnv(bytesToHex(keyPair.publicKey))
    );

    expect(response.status).toBe(401);
  });

  it("protects command registration with the setup password", async () => {
    const response = await handleRequest(
      new Request("https://example.com/api/setup/register", {
        method: "POST",
        headers: { Authorization: "Bearer incorrect" }
      }),
      createEnv()
    );

    expect(response.status).toBe(403);
  });

  it("includes ApeChain in the public chain registry", async () => {
    const response = await handleRequest(new Request("https://example.com/api/chains"), createEnv());
    const data = (await response.json()) as {
      chains: Array<{ id: string; family: string; chainReference: string }>;
    };

    expect(response.status).toBe(200);
    expect(data.chains).toContainEqual(
      expect.objectContaining({
        id: "apechain",
        family: "evm",
        chainReference: "33139",
        defaultRpcUrl: "https://apechain.calderachain.xyz/http"
      })
    );
  });

  it("requests only the documented Discord scopes and bot permissions", () => {
    const invite = new URL(createDiscordInviteUrl("123456789012345678"));
    expect(invite.searchParams.get("scope")).toBe("bot applications.commands");
    expect(invite.searchParams.get("permissions")).toBe("268438528");
  });

  it("accepts a valid future EVM chain through the protected registry API", async () => {
    const response = await handleRequest(
      new Request("https://example.com/api/setup/chains", {
        method: "POST",
        headers: {
          Authorization: "Bearer test-setup-password",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          id: "future-chain",
          family: "evm",
          name: "Future Chain",
          chainReference: "987654",
          nativeCurrencySymbol: "FTR",
          rpcUrl: "https://rpc.future.example",
          explorerUrl: "https://explorer.future.example"
        })
      }),
      createEnv()
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      chain: { id: "future-chain", family: "evm", chainReference: "987654" }
    });
  });

  it("posts an interactive verification button instead of a public wallet URL", async () => {
    const response = await handleDiscordInteraction(
      {
        id: "123456789012345679",
        type: 2,
        guild_id: "guild-1",
        member: { permissions: String(1n << 5n), user: { id: "manager-1" } },
        data: { name: "verify", options: [{ name: "panel", type: 1 }] }
      },
      new URL("https://example.com/interactions"),
      createEnv()
    );
    const body = (await response.json()) as {
      data: { components: Array<{ components: Array<Record<string, unknown>> }> };
    };
    const button = body.data.components[0]?.components[0];

    expect(button).toMatchObject({ style: 1, custom_id: "verify:start" });
    expect(button).not.toHaveProperty("url");
  });

  it("posts a permanent rewards panel with member action buttons", async () => {
    const response = await handleDiscordInteraction(
      {
        id: "123456789012345689",
        type: 2,
        guild_id: "123456789012345678",
        member: { permissions: String(1n << 5n), user: { id: "223456789012345678" } },
        data: { name: "points", options: [{ name: "panel", type: 1 }] }
      },
      new URL("https://example.com/interactions"),
      createEnv()
    );
    const body = (await response.json()) as {
      data: { components: Array<{ components: Array<{ label: string; custom_id: string }> }> };
    };

    expect(body.data.components[0]?.components).toEqual([
      expect.objectContaining({ label: "Claim Daily", custom_id: "rewards:claim" }),
      expect.objectContaining({ label: "My Balance", custom_id: "rewards:balance" }),
      expect.objectContaining({ label: "Quests", custom_id: "rewards:open:quests" }),
      expect.objectContaining({ label: "Store", custom_id: "rewards:open:store" }),
      expect.objectContaining({ label: "Raffles", custom_id: "rewards:open:raffles" })
    ]);
  });

  it("registers manager commands for NFT and token role rules", () => {
    expect(discordCommands.map((command) => command.name)).toEqual(["verify", "points", "tip", "quests", "raffle", "store", "rules"]);
    for (const command of discordCommands) {
      expect(command.integration_types).toEqual([0]);
      expect(command.contexts).toEqual([0]);
    }
    const points = discordCommands.find((command) => command.name === "points");
    expect(points?.options.map((option) => option.name)).toEqual([
      "panel",
      "claim",
      "balance",
      "leaderboard",
      "audit",
      "grant"
    ]);
    const rules = discordCommands.find((command) => command.name === "rules");
    expect(rules?.options.map((option) => option.name)).toEqual([
      "manage",
      "add-nft",
      "add-token",
      "add-trait",
      "add-nft-id",
      "add-erc1155",
      "add-solana",
      "mode",
      "list",
      "remove"
    ]);
  });

  it("gives server managers a private browser rule-manager link", async () => {
    const response = await handleDiscordInteraction(
      {
        id: "123456789012345680",
        type: 2,
        guild_id: "123456789012345678",
        member: {
          permissions: String(1n << 5n),
          user: { id: "223456789012345678" }
        },
        data: { name: "rules", options: [{ name: "manage", type: 1 }] }
      },
      new URL("https://example.com/interactions"),
      createEnv()
    );
    const body = (await response.json()) as {
      data: { flags: number; components: Array<{ components: Array<{ url: string }> }> };
    };

    expect(body.data.flags).toBe(64);
    expect(body.data.components[0]?.components[0]?.url).toMatch(
      /^https:\/\/example\.com\/manage\?token=/
    );
  });
});
