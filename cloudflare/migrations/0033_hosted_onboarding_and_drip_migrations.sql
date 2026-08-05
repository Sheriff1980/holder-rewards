CREATE TABLE IF NOT EXISTS hosted_oauth_states (
  token_hash TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS hosted_sessions (
  token_hash TEXT PRIMARY KEY,
  discord_user_id TEXT NOT NULL,
  guilds_json TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS hosted_sessions_expires_at_idx
  ON hosted_sessions(expires_at);

CREATE TABLE IF NOT EXISTS migration_batches (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('drip_api', 'drip_csv')),
  status TEXT NOT NULL DEFAULT 'preview' CHECK (status IN ('preview', 'applied', 'rolled_back')),
  source_currency TEXT NOT NULL,
  target_currency TEXT NOT NULL,
  conversion_ratio TEXT NOT NULL,
  created_by TEXT NOT NULL,
  row_count INTEGER NOT NULL DEFAULT 0,
  matched_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  source_total INTEGER NOT NULL DEFAULT 0,
  import_total INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  applied_at TEXT,
  rolled_back_at TEXT
);

CREATE INDEX IF NOT EXISTS migration_batches_guild_created_idx
  ON migration_batches(guild_id, created_at DESC);

CREATE TABLE IF NOT EXISTS migration_rows (
  batch_id TEXT NOT NULL REFERENCES migration_batches(id) ON DELETE CASCADE,
  row_number INTEGER NOT NULL,
  discord_user_id TEXT,
  source_balance INTEGER,
  import_amount INTEGER,
  status TEXT NOT NULL CHECK (status IN ('ready', 'skipped', 'imported', 'rolled_back')),
  note TEXT,
  PRIMARY KEY (batch_id, row_number)
);

CREATE INDEX IF NOT EXISTS migration_rows_batch_status_idx
  ON migration_rows(batch_id, status);
