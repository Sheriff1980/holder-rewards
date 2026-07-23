ALTER TABLE guild_settings ADD COLUMN accent_color TEXT NOT NULL DEFAULT '#2F80ED'
  CHECK (accent_color GLOB '#[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]');

CREATE TABLE IF NOT EXISTS guild_brand_assets (
  guild_id TEXT PRIMARY KEY REFERENCES guilds(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL,
  data BLOB NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
