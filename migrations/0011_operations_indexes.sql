CREATE INDEX IF NOT EXISTS role_sync_events_guild_created_idx
  ON role_sync_events(guild_id, created_at DESC);

CREATE INDEX IF NOT EXISTS point_transactions_guild_created_idx
  ON point_transactions(guild_id, created_at DESC);
