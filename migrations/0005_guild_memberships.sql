CREATE TABLE IF NOT EXISTS guild_memberships (
  guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  discord_user_id TEXT NOT NULL REFERENCES discord_users(id) ON DELETE CASCADE,
  last_verified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_synced_at TEXT,
  last_sync_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (guild_id, discord_user_id)
);

CREATE INDEX IF NOT EXISTS guild_memberships_sync_idx
  ON guild_memberships(last_synced_at, guild_id, discord_user_id);

INSERT OR IGNORE INTO guild_memberships (guild_id, discord_user_id, last_verified_at)
SELECT DISTINCT verification_sessions.guild_id,
  verification_sessions.discord_user_id,
  verification_sessions.created_at
FROM verification_sessions
INNER JOIN wallets
  ON wallets.discord_user_id = verification_sessions.discord_user_id;
