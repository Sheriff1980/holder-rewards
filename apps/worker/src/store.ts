import { getPointsBalance, getRewardSettings } from "./points.js";
import { changeDiscordRole } from "./rules.js";
import type { Env } from "./types.js";

export type StoreItem = {
  id: string;
  guildId: string;
  title: string;
  description: string;
  price: number;
  roleId: string | null;
  stock: number | null;
  purchaseLimitPerMember: number | null;
  sold: number;
};

export type StorePurchase = {
  id: string;
  itemTitle: string;
  discordUserId: string;
  pricePaid: number;
  createdAt: string;
};

export class StoreError extends Error {}

type StoreItemRow = {
  id: string;
  guild_id: string;
  title: string;
  description: string;
  price: number;
  role_id: string | null;
  stock: number | null;
  purchase_limit_per_member: number | null;
  sold: number | string | null;
};

function parseStoreItem(row: StoreItemRow): StoreItem | null {
  if (!Number.isSafeInteger(row.price) || row.price < 1) return null;
  const sold = Number(row.sold ?? 0);
  return {
    id: row.id,
    guildId: row.guild_id,
    title: row.title,
    description: row.description,
    price: row.price,
    roleId: row.role_id,
    stock: row.stock === null ? null : Number(row.stock),
    purchaseLimitPerMember: row.purchase_limit_per_member === null
      ? null
      : Number(row.purchase_limit_per_member),
    sold: Number.isSafeInteger(sold) ? sold : 0
  };
}

export async function listStoreItems(env: Env, guildId: string): Promise<StoreItem[]> {
  const rows = await env.DB.prepare(
    `SELECT store_items.id, store_items.guild_id, store_items.title, store_items.description,
       store_items.price, store_items.role_id, store_items.stock,
       store_items.purchase_limit_per_member,
       COUNT(store_purchases.id) AS sold
     FROM store_items
     LEFT JOIN store_purchases ON store_purchases.item_id = store_items.id
     WHERE store_items.guild_id = ? AND store_items.enabled = 1
     GROUP BY store_items.id
     ORDER BY store_items.price, store_items.created_at`
  )
    .bind(guildId)
    .all<StoreItemRow>();
  return rows.results.map(parseStoreItem).filter((item): item is StoreItem => item !== null);
}

export async function createStoreItem(
  env: Env,
  input: {
    guildId: unknown;
    title: unknown;
    description?: unknown;
    price: unknown;
    roleId?: unknown;
    stock?: unknown;
    purchaseLimitPerMember?: unknown;
  }
): Promise<StoreItem> {
  if (typeof input.guildId !== "string" || !/^[0-9]{15,22}$/.test(input.guildId)) {
    throw new StoreError("Server must be a valid Discord ID.");
  }
  if (typeof input.title !== "string" || input.title.trim().length < 2 || input.title.trim().length > 80) {
    throw new StoreError("Item title must be between 2 and 80 characters.");
  }
  const description = typeof input.description === "string" ? input.description.trim() : "";
  if (description.length > 200) {
    throw new StoreError("Item description must be at most 200 characters.");
  }
  const price = Number(input.price);
  if (!Number.isSafeInteger(price) || price < 1 || price > 1_000_000) {
    throw new StoreError("Price must be a whole number between 1 and 1,000,000.");
  }
  let roleId: string | null = null;
  if (typeof input.roleId === "string" && input.roleId.length > 0) {
    if (!/^[0-9]{15,22}$/.test(input.roleId)) {
      throw new StoreError("Role must be a valid Discord role.");
    }
    roleId = input.roleId;
  }
  let stock: number | null = null;
  if (input.stock !== undefined && input.stock !== null && input.stock !== "") {
    const parsed = Number(input.stock);
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 10_000) {
      throw new StoreError("Stock must be a whole number between 1 and 10,000, or blank for unlimited.");
    }
    stock = parsed;
  }
  let purchaseLimitPerMember: number | null = null;
  if (
    input.purchaseLimitPerMember !== undefined &&
    input.purchaseLimitPerMember !== null &&
    input.purchaseLimitPerMember !== ""
  ) {
    const parsed = Number(input.purchaseLimitPerMember);
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 10_000) {
      throw new StoreError("Maximum purchases per member must be between 1 and 10,000, or blank for unlimited.");
    }
    purchaseLimitPerMember = parsed;
  }

  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO guilds (id, updated_at) VALUES (?, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP"
    ).bind(input.guildId),
    env.DB.prepare(
      `INSERT INTO store_items
        (id, guild_id, title, description, price, role_id, stock, purchase_limit_per_member)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, input.guildId, input.title.trim(), description, price, roleId, stock, purchaseLimitPerMember)
  ]);
  return {
    id,
    guildId: input.guildId,
    title: input.title.trim(),
    description,
    price,
    roleId,
    stock,
    purchaseLimitPerMember,
    sold: 0
  };
}

export async function removeStoreItem(env: Env, guildId: string, itemId: string): Promise<boolean> {
  const result = await env.DB.prepare(
    "UPDATE store_items SET enabled = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND guild_id = ? AND enabled = 1"
  )
    .bind(itemId, guildId)
    .run();
  return (result.meta.changes ?? 0) === 1;
}

export async function purchaseStoreItem(
  env: Env,
  input: { guildId: string; itemId: string; discordUserId: string }
): Promise<{ item: StoreItem; balance: number; roleGranted: boolean; currencyName: string }> {
  const items = await listStoreItems(env, input.guildId);
  const item = items.find(
    (candidate) => candidate.id === input.itemId || candidate.id.startsWith(input.itemId)
  );
  if (!item) throw new StoreError("That item was not found. Check the item ID from /store list.");
  if (item.stock !== null && item.stock <= 0) {
    throw new StoreError(`${item.title} is sold out.`);
  }
  const memberPurchases = await env.DB.prepare(
    "SELECT COUNT(*) AS purchases FROM store_purchases WHERE item_id = ? AND discord_user_id = ?"
  )
    .bind(item.id, input.discordUserId)
    .first<{ purchases: number | string }>();
  const purchaseCount = Number(memberPurchases?.purchases ?? 0);
  if (item.purchaseLimitPerMember !== null && purchaseCount >= item.purchaseLimitPerMember) {
    throw new StoreError(
      `You already purchased the maximum of ${item.purchaseLimitPerMember.toLocaleString()} for ${item.title}.`
    );
  }
  const [balance, settings] = await Promise.all([
    getPointsBalance(env, input.guildId, input.discordUserId),
    getRewardSettings(env, input.guildId)
  ]);
  if (balance < item.price) {
    throw new StoreError(
      `${item.title} costs ${item.price.toLocaleString()} ${settings.currencyName} but your balance is ${balance.toLocaleString()}.`
    );
  }

  if (item.stock !== null) {
    const decremented = await env.DB.prepare(
      "UPDATE store_items SET stock = stock - 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND stock > 0"
    )
      .bind(item.id)
      .run();
    if ((decremented.meta.changes ?? 0) !== 1) {
      throw new StoreError(`${item.title} just sold out. You were not charged.`);
    }
  }

  const purchaseId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO discord_users (id, updated_at) VALUES (?, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP"
    ).bind(input.discordUserId),
    env.DB.prepare(
      `INSERT INTO point_transactions (id, guild_id, discord_user_id, amount, source, metadata)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(
      crypto.randomUUID(),
      input.guildId,
      input.discordUserId,
      -item.price,
      `store:${item.id}`,
      JSON.stringify({ kind: "store_purchase", itemId: item.id, purchaseId })
    ),
    env.DB.prepare(
      `INSERT INTO store_purchases (id, item_id, guild_id, discord_user_id, price_paid)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(purchaseId, item.id, input.guildId, input.discordUserId, item.price)
  ]);

  let roleGranted = false;
  if (item.roleId) {
    try {
      await changeDiscordRole(env, input.guildId, input.discordUserId, item.roleId, "add");
      roleGranted = true;
    } catch {
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO point_transactions (id, guild_id, discord_user_id, amount, source, metadata)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).bind(
          crypto.randomUUID(),
          input.guildId,
          input.discordUserId,
          item.price,
          `store_refund:${item.id}`,
          JSON.stringify({ kind: "store_refund", itemId: item.id, purchaseId })
        ),
        env.DB.prepare("DELETE FROM store_purchases WHERE id = ?").bind(purchaseId),
        ...(item.stock !== null
          ? [env.DB.prepare(
              "UPDATE store_items SET stock = stock + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
            ).bind(item.id)]
          : [])
      ]);
      throw new StoreError(
        "Discord could not grant the role, so the purchase was cancelled and you were not charged. Move the bot's role above the store role and try again."
      );
    }
  }

  return {
    item,
    balance: balance - item.price,
    roleGranted,
    currencyName: settings.currencyName
  };
}

export async function listStorePurchaseCountsForMember(
  env: Env,
  guildId: string,
  discordUserId: string
): Promise<Map<string, number>> {
  const rows = await env.DB.prepare(
    `SELECT item_id, COUNT(*) AS purchases
     FROM store_purchases
     WHERE guild_id = ? AND discord_user_id = ?
     GROUP BY item_id`
  )
    .bind(guildId, discordUserId)
    .all<{ item_id: string; purchases: number | string }>();
  return new Map(rows.results.map((row) => [row.item_id, Number(row.purchases)]));
}

export async function listRecentPurchases(env: Env, guildId: string): Promise<StorePurchase[]> {
  const rows = await env.DB.prepare(
    `SELECT store_purchases.id, store_purchases.discord_user_id, store_purchases.price_paid,
       store_purchases.created_at, store_items.title AS item_title
     FROM store_purchases
     JOIN store_items ON store_items.id = store_purchases.item_id
     WHERE store_purchases.guild_id = ?
     ORDER BY store_purchases.created_at DESC
     LIMIT 25`
  )
    .bind(guildId)
    .all<{
      id: string;
      discord_user_id: string;
      price_paid: number;
      created_at: string;
      item_title: string;
    }>();
  return rows.results.map((row) => ({
    id: row.id,
    itemTitle: row.item_title,
    discordUserId: row.discord_user_id,
    pricePaid: row.price_paid,
    createdAt: row.created_at
  }));
}
