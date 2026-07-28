CREATE TABLE IF NOT EXISTS sales_watches (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  chain_id TEXT NOT NULL,
  contract_address TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  last_seen_block INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (guild_id, chain_id, contract_address)
);

CREATE INDEX IF NOT EXISTS sales_watches_enabled_idx ON sales_watches(enabled);
