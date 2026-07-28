import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchDasCollectionAssets,
  fetchIndexedNftsForOwner,
  getIndexerUrl,
  IndexerConfigError,
  listIndexerConfigs,
  removeIndexerConfig,
  saveIndexerConfig
} from "../src/indexers.js";
import type { Env } from "../src/types.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

type IndexerRow = { chain_id: string; url: string; enabled: number };

class IndexerStatement {
  private values: unknown[] = [];

  constructor(private readonly db: IndexerDb, private readonly sql: string) {}

  bind(...values: unknown[]): this {
    this.values = values;
    return this;
  }

  async all<T>(): Promise<D1Result<T>> {
    if (this.sql.includes("FROM chain_configs")) {
      return { success: true, results: [], meta: {} } as unknown as D1Result<T>;
    }
    return {
      success: true,
      results: this.db.rows
        .filter((row) => row.enabled === 1)
        .map((row) => ({ chain_id: row.chain_id, url: row.url })),
      meta: {}
    } as unknown as D1Result<T>;
  }

  async first<T>(): Promise<T | null> {
    const row = this.db.rows.find(
      (candidate) => candidate.chain_id === this.values[0] && candidate.enabled === 1
    );
    return (row ? { url: row.url } : null) as T | null;
  }

  async run(): Promise<D1Result> {
    if (this.sql.includes("INSERT INTO indexer_configs")) {
      const existing = this.db.rows.find((row) => row.chain_id === this.values[0]);
      if (existing) {
        existing.url = String(this.values[1]);
        existing.enabled = 1;
      } else {
        this.db.rows.push({
          chain_id: String(this.values[0]),
          url: String(this.values[1]),
          enabled: 1
        });
      }
      return { success: true, meta: { changes: 1 } } as D1Result;
    }
    if (this.sql.includes("UPDATE indexer_configs")) {
      const existing = this.db.rows.find(
        (row) => row.chain_id === this.values[0] && row.enabled === 1
      );
      if (!existing) return { success: true, meta: { changes: 0 } } as D1Result;
      existing.enabled = 0;
      return { success: true, meta: { changes: 1 } } as D1Result;
    }
    return { success: true, meta: { changes: 0 } } as D1Result;
  }
}

class IndexerDb {
  rows: IndexerRow[] = [];

  prepare(sql: string): IndexerStatement {
    return new IndexerStatement(this, sql);
  }
}

function createEnv(db: IndexerDb): Env {
  return {
    DB: db as unknown as D1Database,
    APP_NAME: "Holder Rewards",
    REWARD_CURRENCY_NAME: "Points",
    DISCORD_BOT_TOKEN: "token"
  };
}

describe("indexer configuration", () => {
  it("stores, updates, and removes an indexer URL for a chain", async () => {
    const env = createEnv(new IndexerDb());

    await saveIndexerConfig(env, { chainId: "base", url: "https://nft.example.com/v3/key/" });
    expect(await getIndexerUrl(env, "base")).toBe("https://nft.example.com/v3/key");
    expect(await listIndexerConfigs(env)).toEqual([
      { chainId: "base", url: "https://nft.example.com/v3/key" }
    ]);

    await saveIndexerConfig(env, { chainId: "base", url: "https://other.example.com/v3/key2" });
    expect(await listIndexerConfigs(env)).toEqual([
      { chainId: "base", url: "https://other.example.com/v3/key2" }
    ]);

    expect(await removeIndexerConfig(env, "base")).toBe(true);
    expect(await getIndexerUrl(env, "base")).toBeNull();
    expect(await removeIndexerConfig(env, "base")).toBe(false);
  });

  it("rejects insecure URLs and unknown chains", async () => {
    const env = createEnv(new IndexerDb());

    await expect(
      saveIndexerConfig(env, { chainId: "base", url: "http://insecure.example.com" })
    ).rejects.toBeInstanceOf(IndexerConfigError);
    await expect(
      saveIndexerConfig(env, { chainId: "base", url: "https://user:secret@nft.example.com" })
    ).rejects.toBeInstanceOf(IndexerConfigError);
    await expect(
      saveIndexerConfig(env, { chainId: "not-a-chain", url: "https://nft.example.com" })
    ).rejects.toBeInstanceOf(IndexerConfigError);
    expect(await listIndexerConfigs(env)).toEqual([]);
  });
});

describe("EVM NFT indexer", () => {
  it("paginates and normalizes owned tokens with attributes", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      const first = !url.includes("pageKey=");
      return new Response(
        JSON.stringify(
          first
            ? {
                ownedNfts: [
                  {
                    tokenId: "0x10",
                    raw: { metadata: { attributes: [{ trait_type: "Eyes", value: "Blue" }] } }
                  }
                ],
                pageKey: "abc"
              }
            : { ownedNfts: [{ tokenId: "21", raw: { metadata: {} } }] }
        ),
        { status: 200 }
      );
    });

    const nfts = await fetchIndexedNftsForOwner(
      "https://nft.example.com/v3/key",
      "0x0000000000000000000000000000000000000001",
      "0x0000000000000000000000000000000000000002"
    );

    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain("getNFTsForOwner");
    expect(calls[0]).toContain("contractAddresses%5B%5D=");
    expect(calls[1]).toContain("pageKey=abc");
    expect(nfts).toEqual([
      { tokenId: "16", attributes: [{ name: "Eyes", value: "Blue" }] },
      { tokenId: "21", attributes: [] }
    ]);
  });

  it("fails loudly when the indexer cannot answer", async () => {
    vi.stubGlobal("fetch", async () => new Response("overloaded", { status: 503 }));
    await expect(
      fetchIndexedNftsForOwner(
        "https://nft.example.com/v3/key",
        "0x0000000000000000000000000000000000000001",
        "0x0000000000000000000000000000000000000002"
      )
    ).rejects.toThrow("503");
  });
});

describe("Solana DAS indexer", () => {
  it("keeps only assets grouped under the requested collection", async () => {
    const bodies: string[] = [];
    vi.stubGlobal("fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(String(init?.body));
      return new Response(
        JSON.stringify({
          result: {
            total: 2,
            items: [
              {
                id: "mint-one",
                grouping: [{ group_key: "collection", group_value: "COLLECTION" }],
                content: { metadata: { attributes: [{ trait_type: "Rank", value: 7 }] } }
              },
              {
                id: "mint-two",
                grouping: [{ group_key: "collection", group_value: "OTHER" }]
              }
            ]
          }
        }),
        { status: 200 }
      );
    });

    const assets = await fetchDasCollectionAssets(
      "https://das.example.com",
      ["owner-one"],
      "COLLECTION"
    );

    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain("getAssetsByOwner");
    expect(bodies[0]).toContain("owner-one");
    expect(assets).toEqual([
      { mintAddress: "mint-one", attributes: [{ name: "Rank", value: "7" }] }
    ]);
  });

  it("rejects endpoints that do not serve DAS responses", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify({ error: { message: "Method not found" } }), { status: 200 })
    );
    await expect(
      fetchDasCollectionAssets("https://das.example.com", ["owner-one"], "COLLECTION")
    ).rejects.toThrow("Method not found");
  });
});
