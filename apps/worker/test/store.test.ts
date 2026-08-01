import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createStoreItem,
  listRecentPurchases,
  listStoreItems,
  purchaseStoreItem,
  removeStoreItem,
  StoreError
} from "../src/store.js";
import { getPointsBalance, grantPoints } from "../src/points.js";
import type { Env } from "../src/types.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

type ItemRow = {
  id: string;
  guild_id: string;
  title: string;
  description: string;
  price: number;
  role_id: string | null;
  stock: number | null;
  purchase_limit_per_member: number | null;
  enabled: number;
};

class StoreStatement {
  private values: unknown[] = [];

  constructor(private readonly db: StoreDb, private readonly sql: string) {}

  bind(...values: unknown[]): this {
    this.values = values;
    return this;
  }

  async all<T>(): Promise<D1Result<T>> {
    if (this.sql.includes("FROM store_items")) {
      const results = this.db.items
        .filter((row) => row.guild_id === this.values[0] && row.enabled === 1)
        .map((row) => ({
          ...row,
          sold: this.db.purchases.filter((purchase) => purchase.item_id === row.id).length
        }));
      return { success: true, results, meta: {} } as unknown as D1Result<T>;
    }
    if (this.sql.includes("FROM store_purchases")) {
      if (this.sql.includes("GROUP BY item_id")) {
        const counts = new Map<string, number>();
        for (const purchase of this.db.purchases.filter(
          (row) => row.guild_id === this.values[0] && row.discord_user_id === this.values[1]
        )) counts.set(purchase.item_id, (counts.get(purchase.item_id) ?? 0) + 1);
        return {
          success: true,
          results: [...counts].map(([item_id, purchases]) => ({ item_id, purchases })),
          meta: {}
        } as unknown as D1Result<T>;
      }
      const results = this.db.purchases
        .filter((purchase) => purchase.guild_id === this.values[0])
        .map((purchase) => ({
          id: purchase.id,
          discord_user_id: purchase.discord_user_id,
          price_paid: purchase.price_paid,
          created_at: purchase.created_at,
          item_title: this.db.items.find((item) => item.id === purchase.item_id)?.title ?? "?"
        }));
      return { success: true, results, meta: {} } as unknown as D1Result<T>;
    }
    return { success: true, results: [], meta: {} } as unknown as D1Result<T>;
  }

  async first<T>(): Promise<T | null> {
    if (this.sql.includes("FROM guild_settings")) return null;
    if (this.sql.includes("COUNT(*) AS purchases FROM store_purchases")) {
      const purchases = this.db.purchases.filter(
        (row) => row.item_id === this.values[0] && row.discord_user_id === this.values[1]
      ).length;
      return { purchases } as T;
    }
    const balance = this.db.transactions
      .filter((entry) => entry.guild_id === this.values[0] && entry.discord_user_id === this.values[1])
      .reduce((sum, entry) => sum + entry.amount, 0);
    return { balance } as T;
  }

  async run(): Promise<D1Result> {
    if (this.sql.includes("INSERT INTO store_items")) {
      this.db.items.push({
        id: String(this.values[0]),
        guild_id: String(this.values[1]),
        title: String(this.values[2]),
        description: String(this.values[3]),
        price: Number(this.values[4]),
        role_id: this.values[5] === null ? null : String(this.values[5]),
        stock: this.values[6] === null ? null : Number(this.values[6]),
        purchase_limit_per_member: this.values[7] === null ? null : Number(this.values[7]),
        enabled: 1
      });
      return { success: true, meta: { changes: 1 } } as D1Result;
    }
    if (this.sql.includes("UPDATE store_items SET enabled = 0")) {
      const item = this.db.items.find(
        (row) => row.id === this.values[0] && row.guild_id === this.values[1] && row.enabled === 1
      );
      if (!item) return { success: true, meta: { changes: 0 } } as D1Result;
      item.enabled = 0;
      return { success: true, meta: { changes: 1 } } as D1Result;
    }
    if (this.sql.includes("SET stock = stock - 1")) {
      const item = this.db.items.find((row) => row.id === this.values[0]);
      if (!item || item.stock === null || item.stock <= 0) {
        return { success: true, meta: { changes: 0 } } as D1Result;
      }
      item.stock -= 1;
      return { success: true, meta: { changes: 1 } } as D1Result;
    }
    if (this.sql.includes("SET stock = stock + 1")) {
      const item = this.db.items.find((row) => row.id === this.values[0]);
      if (item && item.stock !== null) item.stock += 1;
      return { success: true, meta: { changes: 1 } } as D1Result;
    }
    if (this.sql.includes("INSERT INTO store_purchases")) {
      this.db.purchases.push({
        id: String(this.values[0]),
        item_id: String(this.values[1]),
        guild_id: String(this.values[2]),
        discord_user_id: String(this.values[3]),
        price_paid: Number(this.values[4]),
        created_at: "2026-07-28 12:00:00"
      });
      return { success: true, meta: { changes: 1 } } as D1Result;
    }
    if (this.sql.includes("DELETE FROM store_purchases")) {
      this.db.purchases = this.db.purchases.filter((purchase) => purchase.id !== this.values[0]);
      return { success: true, meta: { changes: 1 } } as D1Result;
    }
    if (this.sql.includes("INSERT INTO point_transactions")) {
      this.db.transactions.push({
        guild_id: String(this.values[1]),
        discord_user_id: String(this.values[2]),
        amount: Number(this.values[3]),
        source: this.sql.includes("'admin_grant'") ? "admin_grant" : String(this.values[4])
      });
      return { success: true, meta: { changes: 1 } } as D1Result;
    }
    return { success: true, meta: { changes: 1 } } as D1Result;
  }
}

class StoreDb {
  items: ItemRow[] = [];
  purchases: Array<{
    id: string;
    item_id: string;
    guild_id: string;
    discord_user_id: string;
    price_paid: number;
    created_at: string;
  }> = [];
  transactions: Array<{ guild_id: string; discord_user_id: string; amount: number; source: string }> = [];

  prepare(sql: string): StoreStatement {
    return new StoreStatement(this, sql);
  }

  async batch(statements: StoreStatement[]): Promise<D1Result[]> {
    const results: D1Result[] = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }
}

function createEnv(db = new StoreDb()): Env {
  return {
    DB: db as unknown as D1Database,
    APP_NAME: "Holder Rewards",
    REWARD_CURRENCY_NAME: "Points",
    DISCORD_BOT_TOKEN: "token"
  };
}

const GUILD = "100000000000000000";

describe("store purchases", () => {
  it("charges the price, decrements stock, and records the purchase", async () => {
    const db = new StoreDb();
    const env = createEnv(db);
    const item = await createStoreItem(env, {
      guildId: GUILD,
      title: "Merch code",
      description: "One hoodie discount",
      price: 100,
      stock: 2
    });
    await grantPoints(env, { guildId: GUILD, discordUserId: "user-1", amount: 250, grantedBy: "m" });

    const purchase = await purchaseStoreItem(env, { guildId: GUILD, itemId: item.id, discordUserId: "user-1" });
    expect(purchase).toMatchObject({ balance: 150, roleGranted: false, currencyName: "Points" });

    const [listed] = await listStoreItems(env, GUILD);
    expect(listed?.stock).toBe(1);
    expect(listed?.sold).toBe(1);
    expect(await listRecentPurchases(env, GUILD)).toHaveLength(1);
    expect(await getPointsBalance(env, GUILD, "user-1")).toBe(150);
  });

  it("rejects purchases without balance and sold-out items", async () => {
    const env = createEnv();
    const item = await createStoreItem(env, { guildId: GUILD, title: "Merch code", price: 100, stock: 1 });
    await expect(
      purchaseStoreItem(env, { guildId: GUILD, itemId: item.id, discordUserId: "user-1" })
    ).rejects.toThrow("balance is 0");

    await grantPoints(env, { guildId: GUILD, discordUserId: "user-1", amount: 100, grantedBy: "m" });
    await purchaseStoreItem(env, { guildId: GUILD, itemId: item.id, discordUserId: "user-1" });
    await expect(
      purchaseStoreItem(env, { guildId: GUILD, itemId: item.id, discordUserId: "user-2" })
    ).rejects.toThrow("sold out");
  });

  it("enforces a separate purchase limit for each member", async () => {
    const db = new StoreDb();
    const env = createEnv(db);
    const item = await createStoreItem(env, {
      guildId: GUILD,
      title: "Limited reward",
      price: 10,
      stock: 10,
      purchaseLimitPerMember: 1
    });
    await grantPoints(env, { guildId: GUILD, discordUserId: "user-1", amount: 20, grantedBy: "m" });
    await grantPoints(env, { guildId: GUILD, discordUserId: "user-2", amount: 20, grantedBy: "m" });

    await purchaseStoreItem(env, { guildId: GUILD, itemId: item.id, discordUserId: "user-1" });
    await expect(
      purchaseStoreItem(env, { guildId: GUILD, itemId: item.id, discordUserId: "user-1" })
    ).rejects.toThrow("maximum of 1");
    await expect(
      purchaseStoreItem(env, { guildId: GUILD, itemId: item.id, discordUserId: "user-2" })
    ).resolves.toMatchObject({ balance: 10 });
  });

  it("grants role items and refunds the charge when Discord rejects the role", async () => {
    const db = new StoreDb();
    const env = createEnv(db);
    const item = await createStoreItem(env, {
      guildId: GUILD,
      title: "VIP role",
      price: 100,
      stock: 1,
      roleId: "300000000000000000"
    });
    await grantPoints(env, { guildId: GUILD, discordUserId: "user-1", amount: 100, grantedBy: "m" });

    vi.stubGlobal("fetch", async () => new Response("Missing Permissions", { status: 403 }));
    await expect(
      purchaseStoreItem(env, { guildId: GUILD, itemId: item.id, discordUserId: "user-1" })
    ).rejects.toThrow("not charged");
    expect(await getPointsBalance(env, GUILD, "user-1")).toBe(100);
    const [listed] = await listStoreItems(env, GUILD);
    expect(listed?.stock).toBe(1);
    expect(listed?.sold).toBe(0);

    vi.stubGlobal("fetch", async () => new Response(null, { status: 204 }));
    const purchase = await purchaseStoreItem(env, { guildId: GUILD, itemId: item.id, discordUserId: "user-1" });
    expect(purchase.roleGranted).toBe(true);
    expect(await getPointsBalance(env, GUILD, "user-1")).toBe(0);
  });

  it("validates items and hides removed ones", async () => {
    const env = createEnv();
    await expect(
      createStoreItem(env, { guildId: GUILD, title: "x", price: 100 })
    ).rejects.toBeInstanceOf(StoreError);
    await expect(
      createStoreItem(env, { guildId: GUILD, title: "Bad stock", price: 100, stock: 0 })
    ).rejects.toBeInstanceOf(StoreError);
    await expect(
      createStoreItem(env, { guildId: GUILD, title: "Bad limit", price: 100, purchaseLimitPerMember: 0 })
    ).rejects.toBeInstanceOf(StoreError);

    const item = await createStoreItem(env, { guildId: GUILD, title: "Gone", price: 10 });
    expect(await removeStoreItem(env, GUILD, item.id)).toBe(true);
    expect(await removeStoreItem(env, GUILD, item.id)).toBe(false);
    expect(await listStoreItems(env, GUILD)).toHaveLength(0);
  });
});
