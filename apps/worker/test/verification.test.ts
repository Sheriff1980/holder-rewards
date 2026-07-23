import { privateKeyToAccount } from "viem/accounts";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  completeWalletChallenge,
  createVerificationSession,
  createWalletChallenge,
  listLinkedWallets,
  unlinkWallet,
  VerificationError
} from "../src/verification.js";
import type { Env } from "../src/types.js";

type Session = {
  id: string;
  token_hash: string;
  discord_user_id: string;
  guild_id: string;
  expires_at: string;
  challenge_count: number;
  completion_count: number;
};

type Challenge = {
  id: string;
  session_id: string;
  chain_id: string;
  chain_reference: string;
  address: string;
  message: string;
  expires_at: string;
  used_at: string | null;
};

type Wallet = {
  id: string;
  discord_user_id: string;
  chain: "evm" | "solana";
  address: string;
  created_at: string;
};

class MemoryStatement {
  private values: unknown[] = [];

  constructor(private readonly db: MemoryD1, readonly sql: string) {}

  bind(...values: unknown[]): this {
    this.values = values;
    return this;
  }

  async all<T>(): Promise<D1Result<T>> {
    if (this.sql.includes("FROM wallets")) {
      const results = [...this.db.wallets.values()].filter(
        (wallet) => wallet.discord_user_id === this.values[0]
      );
      return { success: true, results, meta: {} } as unknown as D1Result<T>;
    }
    return { success: true, results: [], meta: {} } as unknown as D1Result<T>;
  }

  async first<T>(): Promise<T | null> {
    if (this.sql.includes("FROM verification_sessions")) {
      return (this.db.sessions.find((row) => row.token_hash === this.values[0]) ?? null) as T | null;
    }
    if (this.sql.includes("FROM wallet_challenges")) {
      return (
        this.db.challenges.find(
          (row) => row.id === this.values[0] && row.session_id === this.values[1]
        ) ?? null
      ) as T | null;
    }
    if (this.sql.includes("FROM wallets")) {
      if (this.sql.includes("WHERE id = ?")) {
        const wallet = [...this.db.wallets.values()].find(
          (candidate) => candidate.id === this.values[0] && candidate.discord_user_id === this.values[1]
        );
        return (wallet ? { chain: wallet.chain, address: wallet.address } : null) as T | null;
      }
      const wallet = this.db.wallets.get(String(this.values[1]));
      return (wallet ? { discord_user_id: wallet.discord_user_id } : null) as T | null;
    }
    return null;
  }

  async run(): Promise<D1Result> {
    let changes = 1;
    if (this.sql.includes("INSERT INTO verification_sessions")) {
      this.db.sessions.push({
        id: String(this.values[0]),
        token_hash: String(this.values[1]),
        discord_user_id: String(this.values[2]),
        guild_id: String(this.values[3]),
        expires_at: String(this.values[4]),
        challenge_count: 0,
        completion_count: 0
      });
    } else if (this.sql.includes("SET challenge_count")) {
      const session = this.db.sessions.find(
        (row) => row.id === this.values[0] && row.challenge_count < Number(this.values[1])
      );
      if (session) session.challenge_count += 1;
      else changes = 0;
    } else if (this.sql.includes("SET completion_count")) {
      const session = this.db.sessions.find(
        (row) => row.id === this.values[0] && row.completion_count < Number(this.values[1])
      );
      if (session) session.completion_count += 1;
      else changes = 0;
    } else if (this.sql.includes("INSERT INTO wallet_challenges")) {
      this.db.challenges.push({
        id: String(this.values[0]),
        session_id: String(this.values[1]),
        chain_id: String(this.values[2]),
        chain_reference: String(this.values[3]),
        address: String(this.values[4]),
        message: String(this.values[6]),
        expires_at: String(this.values[7]),
        used_at: null
      });
    } else if (this.sql.includes("UPDATE wallet_challenges")) {
      const challenge = this.db.challenges.find(
        (row) => row.id === this.values[0] && row.used_at === null
      );
      if (challenge) challenge.used_at = new Date().toISOString();
      else changes = 0;
    } else if (this.sql.includes("INSERT INTO wallets")) {
      const address = String(this.values[3]);
      if (this.db.wallets.has(address)) throw new Error("unique constraint");
      this.db.wallets.set(address, {
        id: String(this.values[0]),
        discord_user_id: String(this.values[1]),
        chain: String(this.values[2]) as "evm" | "solana",
        address,
        created_at: new Date().toISOString()
      });
    } else if (this.sql.includes("DELETE FROM wallets")) {
      const wallet = [...this.db.wallets.values()].find(
        (candidate) => candidate.id === this.values[0] && candidate.discord_user_id === this.values[1]
      );
      if (wallet) this.db.wallets.delete(wallet.address);
      else changes = 0;
    }
    return { success: true, meta: { changes } } as D1Result;
  }
}

class MemoryD1 {
  sessions: Session[] = [];
  challenges: Challenge[] = [];
  wallets = new Map<string, Wallet>();

  prepare(sql: string): MemoryStatement {
    return new MemoryStatement(this, sql);
  }

  async batch(statements: MemoryStatement[]): Promise<D1Result[]> {
    return Promise.all(statements.map((statement) => statement.run()));
  }
}

function createEnv(): Env {
  return {
    DB: new MemoryD1() as unknown as D1Database,
    APP_NAME: "Holder Rewards",
    REWARD_CURRENCY_NAME: "Points",
    DISCORD_BOT_TOKEN: "token",
    SETUP_TOKEN: "setup"
  };
}

function mockContractSignature(magicValue: "0x1626ba7e" | "0xffffffff"): void {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as { id: number; method: string };
    let result: string;
    if (request.method === "eth_chainId") result = "0x1";
    else if (request.method === "eth_getCode") result = "0x6000";
    else if (request.method === "eth_call") result = magicValue + "0".repeat(56);
    else throw new Error(`Unexpected RPC method: ${request.method}`);
    return Response.json({ jsonrpc: "2.0", id: request.id, result });
  });
}

function mockEoaBytecodeLookup(): void {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as { id: number; method: string };
    const result = request.method === "eth_chainId" ? "0x1" : request.method === "eth_getCode" ? "0x" : null;
    if (result === null) throw new Error(`Unexpected RPC method: ${request.method}`);
    return Response.json({ jsonrpc: "2.0", id: request.id, result });
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("EVM wallet verification", () => {
  it("links a signed wallet and rejects challenge replay", async () => {
    const env = createEnv();
    const account = privateKeyToAccount(`0x${"11".repeat(32)}`);
    const sessionToken = await createVerificationSession(env, "discord-1", "guild-1");
    const challenge = await createWalletChallenge(env, "https://verify.example", {
      sessionToken,
      address: account.address,
      chainId: "apechain"
    });
    const signature = await account.signMessage({ message: challenge.message });

    await expect(
      completeWalletChallenge(env, { sessionToken, challengeId: challenge.challengeId, signature })
    ).resolves.toMatchObject({ address: account.address, family: "evm", chainId: "apechain" });
    await expect(
      completeWalletChallenge(env, { sessionToken, challengeId: challenge.challengeId, signature })
    ).rejects.toMatchObject({ status: 409 });
  });

  it("rejects a signature from a different wallet", async () => {
    const env = createEnv();
    const claimed = privateKeyToAccount(`0x${"22".repeat(32)}`);
    const signer = privateKeyToAccount(`0x${"33".repeat(32)}`);
    const sessionToken = await createVerificationSession(env, "discord-2", "guild-2");
    const challenge = await createWalletChallenge(env, "https://verify.example", {
      sessionToken,
      address: claimed.address,
      chainId: "ethereum"
    });
    const signature = await signer.signMessage({ message: challenge.message });
    mockEoaBytecodeLookup();

    await expect(
      completeWalletChallenge(env, { sessionToken, challengeId: challenge.challengeId, signature })
    ).rejects.toBeInstanceOf(VerificationError);
  });

  it("lists and unlinks only wallets owned by the session's Discord user", async () => {
    const env = createEnv();
    const account = privateKeyToAccount(`0x${"44".repeat(32)}`);
    const ownerToken = await createVerificationSession(env, "discord-owner", "guild-1");
    const challenge = await createWalletChallenge(env, "https://verify.example", {
      sessionToken: ownerToken,
      address: account.address,
      chainId: "ethereum"
    });
    await completeWalletChallenge(env, {
      sessionToken: ownerToken,
      challengeId: challenge.challengeId,
      signature: await account.signMessage({ message: challenge.message })
    });

    const wallets = await listLinkedWallets(env, ownerToken);
    expect(wallets).toHaveLength(1);
    expect(wallets[0]).toMatchObject({ address: account.address, family: "evm" });

    const otherToken = await createVerificationSession(env, "discord-other", "guild-1");
    await expect(unlinkWallet(env, otherToken, wallets[0]?.id)).rejects.toMatchObject({ status: 404 });
    await expect(unlinkWallet(env, ownerToken, wallets[0]?.id)).resolves.toMatchObject({
      discordUserId: "discord-owner",
      guildId: "guild-1"
    });
    await expect(listLinkedWallets(env, ownerToken)).resolves.toEqual([]);
  });

  it("accepts an EIP-1271 signature only when the wallet contract returns the magic value", async () => {
    const env = createEnv();
    const contractAddress = "0x5555555555555555555555555555555555555555";
    const sessionToken = await createVerificationSession(env, "discord-contract", "guild-1");
    const challenge = await createWalletChallenge(env, "https://verify.example", {
      sessionToken,
      address: contractAddress,
      chainId: "ethereum"
    });

    mockContractSignature("0xffffffff");
    await expect(
      completeWalletChallenge(env, {
        sessionToken,
        challengeId: challenge.challengeId,
        signature: "0x1234"
      })
    ).rejects.toMatchObject({ status: 401 });

    vi.restoreAllMocks();
    mockContractSignature("0x1626ba7e");
    await expect(
      completeWalletChallenge(env, {
        sessionToken,
        challengeId: challenge.challengeId,
        signature: "0x1234"
      })
    ).resolves.toMatchObject({ address: contractAddress, family: "evm", chainId: "ethereum" });
  });

  it("links a Solana wallet only after a valid Ed25519 signature", async () => {
    const env = createEnv();
    const keypair = nacl.sign.keyPair();
    const address = bs58.encode(keypair.publicKey);
    const sessionToken = await createVerificationSession(env, "discord-solana", "guild-1");
    const challenge = await createWalletChallenge(env, "https://verify.example", {
      sessionToken,
      address,
      chainId: "solana"
    });
    expect(challenge.message).toContain("wants you to sign in with your Solana account");
    expect(challenge.message).toContain("Chain ID: solana:mainnet");
    const signature = btoa(
      String.fromCharCode(...nacl.sign.detached(new TextEncoder().encode(challenge.message), keypair.secretKey))
    );

    await expect(
      completeWalletChallenge(env, { sessionToken, challengeId: challenge.challengeId, signature })
    ).resolves.toMatchObject({ address, family: "solana", chainId: "solana" });
    await expect(listLinkedWallets(env, sessionToken)).resolves.toContainEqual(
      expect.objectContaining({ address, family: "solana" })
    );
  });

  it("limits challenge creation for each private verification link", async () => {
    const env = createEnv();
    const account = privateKeyToAccount(`0x${"66".repeat(32)}`);
    const sessionToken = await createVerificationSession(env, "discord-limited", "guild-1");

    for (let attempt = 0; attempt < 8; attempt += 1) {
      await expect(
        createWalletChallenge(env, "https://verify.example", {
          sessionToken,
          address: account.address,
          chainId: "ethereum"
        })
      ).resolves.toHaveProperty("challengeId");
    }
    await expect(
      createWalletChallenge(env, "https://verify.example", {
        sessionToken,
        address: account.address,
        chainId: "ethereum"
      })
    ).rejects.toMatchObject({ status: 429 });
  });

  it("limits signature checks for each private verification link", async () => {
    const env = createEnv();
    const claimed = privateKeyToAccount(`0x${"77".repeat(32)}`);
    const signer = privateKeyToAccount(`0x${"78".repeat(32)}`);
    const sessionToken = await createVerificationSession(env, "discord-signature-limited", "guild-1");
    const challenge = await createWalletChallenge(env, "https://verify.example", {
      sessionToken,
      address: claimed.address,
      chainId: "ethereum"
    });
    const signature = await signer.signMessage({ message: challenge.message });
    mockEoaBytecodeLookup();

    for (let attempt = 0; attempt < 12; attempt += 1) {
      await expect(
        completeWalletChallenge(env, { sessionToken, challengeId: challenge.challengeId, signature })
      ).rejects.toMatchObject({ status: 401 });
    }
    await expect(
      completeWalletChallenge(env, { sessionToken, challengeId: challenge.challengeId, signature })
    ).rejects.toMatchObject({ status: 429 });
  });
});
