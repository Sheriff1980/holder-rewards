CREATE TABLE IF NOT EXISTS quests (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('link_wallet', 'hold_role', 'daily_claims', 'code')),
  config TEXT NOT NULL DEFAULT '{}',
  reward INTEGER NOT NULL CHECK (reward >= 1 AND reward <= 1000000),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS quests_guild_idx ON quests(guild_id, enabled);

CREATE TABLE IF NOT EXISTS quest_completions (
  quest_id TEXT NOT NULL REFERENCES quests(id) ON DELETE CASCADE,
  guild_id TEXT NOT NULL,
  discord_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (quest_id, discord_user_id)
);

CREATE INDEX IF NOT EXISTS quest_completions_guild_idx ON quest_completions(guild_id, discord_user_id);
