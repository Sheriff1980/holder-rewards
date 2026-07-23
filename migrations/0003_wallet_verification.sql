CREATE TABLE IF NOT EXISTS verification_sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  discord_user_id TEXT NOT NULL REFERENCES discord_users(id) ON DELETE CASCADE,
  guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS wallet_challenges (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES verification_sessions(id) ON DELETE CASCADE,
  chain_id TEXT NOT NULL,
  chain_reference TEXT NOT NULL,
  address TEXT NOT NULL,
  nonce TEXT NOT NULL UNIQUE,
  message TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS verification_sessions_token_idx
  ON verification_sessions(token_hash, expires_at);
CREATE INDEX IF NOT EXISTS wallet_challenges_session_idx
  ON wallet_challenges(session_id, expires_at);
