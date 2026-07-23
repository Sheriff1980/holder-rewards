CREATE TABLE IF NOT EXISTS ownership_cache (
  cache_key TEXT PRIMARY KEY,
  qualifies INTEGER NOT NULL CHECK (qualifies IN (0, 1)),
  balance TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ownership_cache_expires_at_idx
  ON ownership_cache(expires_at);
