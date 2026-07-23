import { describe, expect, it } from "vitest";
import {
  AssetError,
  getBrandLogo,
  getCurrencyIcon,
  hasBrandLogo,
  hasCurrencyIcon,
  removeCurrencyIcon,
  removeBrandLogo,
  saveBrandLogo,
  saveCurrencyIcon
} from "../src/assets.js";
import type { Env } from "../src/types.js";

type StoredAsset = { content_type: string; data: ArrayBuffer; updated_at: string };

class Statement {
  private values: unknown[] = [];

  constructor(private readonly db: MemoryD1, private readonly sql: string) {}

  bind(...values: unknown[]): this {
    this.values = values;
    return this;
  }

  async run(): Promise<D1Result> {
    if (this.sql.includes("INSERT INTO guild_brand_assets")) {
      this.db.brandAssets.set(String(this.values[0]), {
        content_type: String(this.values[1]),
        data: this.values[2] as ArrayBuffer,
        updated_at: new Date().toISOString()
      });
      return { success: true, meta: { changes: 1 } } as D1Result;
    }
    if (this.sql.includes("DELETE FROM guild_brand_assets")) {
      const removed = this.db.brandAssets.delete(String(this.values[0]));
      return { success: true, meta: { changes: removed ? 1 : 0 } } as D1Result;
    }
    if (this.sql.includes("INSERT INTO guild_assets")) {
      this.db.assets.set(String(this.values[0]), {
        content_type: String(this.values[1]),
        data: this.values[2] as ArrayBuffer,
        updated_at: new Date().toISOString()
      });
      return { success: true, meta: { changes: 1 } } as D1Result;
    }
    if (this.sql.includes("DELETE FROM guild_assets")) {
      const removed = this.db.assets.delete(String(this.values[0]));
      return { success: true, meta: { changes: removed ? 1 : 0 } } as D1Result;
    }
    return { success: true, meta: { changes: 0 } } as D1Result;
  }

  async first<T>(): Promise<T | null> {
    const asset = this.sql.includes("guild_brand_assets")
      ? this.db.brandAssets.get(String(this.values[0]))
      : this.db.assets.get(String(this.values[0]));
    if (this.sql.includes("SELECT 1 AS found")) {
      return (asset ? { found: 1 } : null) as T | null;
    }
    return (asset
      ? { ...asset, data: Array.from(new Uint8Array(asset.data)) }
      : null) as T | null;
  }
}

class MemoryD1 {
  assets = new Map<string, StoredAsset>();
  brandAssets = new Map<string, StoredAsset>();

  prepare(sql: string): Statement {
    return new Statement(this, sql);
  }
}

function createEnv(): Env {
  return {
    DB: new MemoryD1() as unknown as D1Database,
    APP_NAME: "Holder Rewards",
    REWARD_CURRENCY_NAME: "Points",
    DISCORD_BOT_TOKEN: "token"
  };
}

describe("currency icons", () => {
  it("stores, serves, replaces, and removes a verified image", async () => {
    const env = createEnv();
    const png = new File(
      [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
      "currency.png",
      { type: "image/png" }
    );
    await saveCurrencyIcon(env, "123456789012345678", png);
    await expect(hasCurrencyIcon(env, "123456789012345678")).resolves.toBe(true);
    const stored = await getCurrencyIcon(env, "123456789012345678");
    expect(stored).toMatchObject({
      content_type: "image/png"
    });
    expect(Array.from(new Uint8Array(stored?.data ?? new ArrayBuffer(0)))).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
    ]);
    await expect(removeCurrencyIcon(env, "123456789012345678")).resolves.toBe(true);
    await expect(hasCurrencyIcon(env, "123456789012345678")).resolves.toBe(false);
  });

  it("rejects non-image content even when the filename claims it is an image", async () => {
    const env = createEnv();
    const fake = new File(["not an image"], "currency.png", { type: "image/png" });
    await expect(saveCurrencyIcon(env, "123456789012345678", fake)).rejects.toBeInstanceOf(
      AssetError
    );
  });

  it("stores community logos separately from currency icons", async () => {
    const env = createEnv();
    const gif = new File(["GIF89a"], "logo.gif", { type: "image/gif" });
    await saveBrandLogo(env, "123456789012345678", gif);
    await expect(hasBrandLogo(env, "123456789012345678")).resolves.toBe(true);
    await expect(getBrandLogo(env, "123456789012345678")).resolves.toMatchObject({
      content_type: "image/gif"
    });
    await expect(hasCurrencyIcon(env, "123456789012345678")).resolves.toBe(false);
    await expect(removeBrandLogo(env, "123456789012345678")).resolves.toBe(true);
  });
});
