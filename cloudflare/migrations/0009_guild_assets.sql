CREATE TABLE IF NOT EXISTS guild_assets (
  guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  asset_type TEXT NOT NULL CHECK (asset_type IN ('currency_icon')),
  content_type TEXT NOT NULL,
  data BLOB NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (guild_id, asset_type)
);
