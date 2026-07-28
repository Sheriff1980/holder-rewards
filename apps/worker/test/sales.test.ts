import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSalesWatch,
  listSalesWatches,
  pollSalesWatches,
  removeSalesWatch,
  SalesWatchError
} from "../src/sales.js";
import type { Env } from "../src/types.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

type WatchRow = {
  id: string;
  guild_id: string;
  chain_id: string;
  contract_address: string;
  channel_id: string;
  last_seen_block: number;
  last_error: string | null;
  enabled: number;
};

class SalesStatement {
  private values: unknown[] = [];

  constructor(private readonly db: SalesDb, private readonly sql: string) {}

  bind(...values: unknown[]): this {
    this.values = values;
    return this;
  }

  async all<T>(): Promise<D1Result<T>> {
    if (this.sql.includes("FROM chain_configs")) {
      return { success: true, results: [], meta: {} } as unknown as D1Result<T>;
    }
    if (this.sql.includes("FROM sales_watches")) {
      const results = this.db.watches.filter(
        (row) => row.enabled === 1 && (this.values.length === 0 || row.guild_id === this.values[0])
      );
      return { success: true, results, meta: {} } as unknown as D1Result<T>;
    }
    return { success: true, results: [], meta: {} } as unknown as D1Result<T>;
  }

  async first<T>(): Promise<T | null> {
    if (this.sql.includes("FROM indexer_configs")) {
      const url = this.db.indexers.get(String(this.values[0]));
      return (url ? { url } : null) as T | null;
    }
    return null;
  }

  async run(): Promise<D1Result> {
    if (this.sql.includes("INSERT INTO sales_watches")) {
      this.db.watches.push({
        id: String(this.values[0]),
        guild_id: String(this.values[1]),
        chain_id: String(this.values[2]),
        contract_address: String(this.values[3]),
        channel_id: String(this.values[4]),
        last_seen_block: 0,
        last_error: null,
        enabled: 1
      });
      return { success: true, meta: { changes: 1 } } as D1Result;
    }
    if (this.sql.includes("SET enabled = 0")) {
      const watch = this.db.watches.find(
        (row) => row.id === this.values[0] && row.guild_id === this.values[1] && row.enabled === 1
      );
      if (!watch) return { success: true, meta: { changes: 0 } } as D1Result;
      watch.enabled = 0;
      return { success: true, meta: { changes: 1 } } as D1Result;
    }
    if (this.sql.includes("SET last_seen_block")) {
      const watch = this.db.watches.find((row) => row.id === this.values[2]);
      if (watch) {
        watch.last_seen_block = Number(this.values[0]);
        watch.last_error = this.values[1] === null ? null : String(this.values[1]);
      }
      return { success: true, meta: { changes: 1 } } as D1Result;
    }
    return { success: true, meta: { changes: 1 } } as D1Result;
  }
}

class SalesDb {
  watches: WatchRow[] = [];
  indexers = new Map<string, string>();

  prepare(sql: string): SalesStatement {
    return new SalesStatement(this, sql);
  }

  async batch(statements: SalesStatement[]): Promise<D1Result[]> {
    return Promise.all(statements.map((statement) => statement.run()));
  }
}

function createEnv(db = new SalesDb()): Env {
  return {
    DB: db as unknown as D1Database,
    APP_NAME: "Holder Rewards",
    REWARD_CURRENCY_NAME: "Points",
    DISCORD_BOT_TOKEN: "token"
  };
}

const GUILD = "100000000000000000";
const CONTRACT = "0x00000000000000000000000000000000000000aa";
const CHANNEL = "400000000000000000";

describe("sales watch setup", () => {
  it("requires an indexer URL, a valid contract, and no duplicates", async () => {
    const db = new SalesDb();
    const env = createEnv(db);
    await expect(
      createSalesWatch(env, { guildId: GUILD, chainId: "ethereum", contractAddress: CONTRACT, channelId: CHANNEL, createdBy: "m" })
    ).rejects.toThrow("indexer URL");

    db.indexers.set("ethereum", "https://nft.example.com/v3/key");
    await expect(
      createSalesWatch(env, { guildId: GUILD, chainId: "ethereum", contractAddress: "not-an-address", channelId: CHANNEL, createdBy: "m" })
    ).rejects.toBeInstanceOf(SalesWatchError);
    await expect(
      createSalesWatch(env, { guildId: GUILD, chainId: "solana", contractAddress: CONTRACT, channelId: CHANNEL, createdBy: "m" })
    ).rejects.toThrow("EVM");

    const watch = await createSalesWatch(env, {
      guildId: GUILD, chainId: "ethereum", contractAddress: CONTRACT, channelId: CHANNEL, createdBy: "m"
    });
    expect(watch.lastSeenBlock).toBe(0);
    await expect(
      createSalesWatch(env, { guildId: GUILD, chainId: "ethereum", contractAddress: CONTRACT, channelId: CHANNEL, createdBy: "m" })
    ).rejects.toThrow("already being watched");

    expect(await removeSalesWatch(env, GUILD, watch.id)).toBe(true);
    expect(await listSalesWatches(env, GUILD)).toHaveLength(0);
  });
});

describe("sales polling", () => {
  function stubFetch(options: {
    sales: Array<Record<string, unknown>>;
    failSales?: boolean;
  }) {
    const posts: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("getNFTSales")) {
        if (options.failSales) return new Response("down", { status: 500 });
        return new Response(JSON.stringify({ nftSales: options.sales }), { status: 200 });
      }
      if (url.includes("getNFTMetadata")) {
        return new Response(
          JSON.stringify({ name: "Cool Cat #7", image: { thumbnailUrl: "https://img.example.com/7.png" } }),
          { status: 200 }
        );
      }
      if (url.includes("/messages")) {
        posts.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response("{}", { status: 200 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    return posts;
  }

  const saleAt = (block: number, tokenId: string) => ({
    tokenId,
    marketplace: "opensea",
    buyerAddress: "0x00000000000000000000000000000000000000bb",
    sellerAddress: "0x00000000000000000000000000000000000000cc",
    price: { value: "0.5", paymentToken: { symbol: "ETH" } },
    transactionHash: "0xdeadbeef",
    blockNumber: block
  });

  it("starts at the latest sale without backfilling history", async () => {
    const db = new SalesDb();
    db.indexers.set("ethereum", "https://nft.example.com/v3/key");
    const env = createEnv(db);
    const watch = await createSalesWatch(env, {
      guildId: GUILD, chainId: "ethereum", contractAddress: CONTRACT, channelId: CHANNEL, createdBy: "m"
    });
    const posts = stubFetch({ sales: [saleAt(100, "1")] });

    const report = await pollSalesWatches(env);
    expect(report).toMatchObject({ checked: 1, posted: 0, errors: 0 });
    expect(posts).toHaveLength(0);
    expect(db.watches.find((row) => row.id === watch.id)?.last_seen_block).toBe(100);
  });

  it("posts new sales with embeds and advances the cursor", async () => {
    const db = new SalesDb();
    db.indexers.set("ethereum", "https://nft.example.com/v3/key");
    const env = createEnv(db);
    const watch = await createSalesWatch(env, {
      guildId: GUILD, chainId: "ethereum", contractAddress: CONTRACT, channelId: CHANNEL, createdBy: "m"
    });
    db.watches.find((row) => row.id === watch.id)!.last_seen_block = 100;
    const posts = stubFetch({ sales: [saleAt(101, "7"), saleAt(102, "8")] });

    const report = await pollSalesWatches(env);
    expect(report).toMatchObject({ checked: 1, posted: 2, errors: 0 });
    expect(posts).toHaveLength(2);
    const embed = (posts[0]!.embeds as Array<Record<string, unknown>>)[0]!;
    expect(embed.title).toBe("Cool Cat #7 sold for 0.5 ETH");
    expect(embed.thumbnail).toEqual({ url: "https://img.example.com/7.png" });
    expect(db.watches.find((row) => row.id === watch.id)?.last_seen_block).toBe(102);
  });

  it("records indexer failures on the watch without advancing the cursor", async () => {
    const db = new SalesDb();
    db.indexers.set("ethereum", "https://nft.example.com/v3/key");
    const env = createEnv(db);
    const watch = await createSalesWatch(env, {
      guildId: GUILD, chainId: "ethereum", contractAddress: CONTRACT, channelId: CHANNEL, createdBy: "m"
    });
    db.watches.find((row) => row.id === watch.id)!.last_seen_block = 100;
    stubFetch({ sales: [], failSales: true });

    const report = await pollSalesWatches(env);
    expect(report).toMatchObject({ checked: 1, posted: 0, errors: 1 });
    const stored = db.watches.find((row) => row.id === watch.id)!;
    expect(stored.last_seen_block).toBe(100);
    expect(stored.last_error).toContain("500");
  });
});
