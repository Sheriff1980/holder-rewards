CREATE TABLE IF NOT EXISTS store_items (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price INTEGER NOT NULL CHECK (price >= 1 AND price <= 1000000),
  role_id TEXT,
  stock INTEGER CHECK (stock IS NULL OR stock >= 0),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS store_items_guild_idx ON store_items(guild_id, enabled);

CREATE TABLE IF NOT EXISTS store_purchases (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES store_items(id) ON DELETE CASCADE,
  guild_id TEXT NOT NULL,
  discord_user_id TEXT NOT NULL,
  price_paid INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS store_purchases_guild_idx ON store_purchases(guild_id, created_at DESC);
