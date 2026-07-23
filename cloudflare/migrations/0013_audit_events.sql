CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  actor_discord_user_id TEXT,
  subject_discord_user_id TEXT,
  action TEXT NOT NULL,
  detail TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS audit_events_guild_created_idx
  ON audit_events(guild_id, created_at DESC);
