CREATE TABLE IF NOT EXISTS raffles (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  title TEXT NOT NULL,
  prize TEXT NOT NULL,
  prize_role_id TEXT,
  entry_cost INTEGER NOT NULL CHECK (entry_cost >= 1 AND entry_cost <= 1000000),
  max_entries_per_member INTEGER NOT NULL DEFAULT 10 CHECK (max_entries_per_member >= 1 AND max_entries_per_member <= 1000),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'drawn', 'cancelled')),
  winner_discord_user_id TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS raffles_guild_idx ON raffles(guild_id, status);

CREATE TABLE IF NOT EXISTS raffle_entries (
  raffle_id TEXT NOT NULL REFERENCES raffles(id) ON DELETE CASCADE,
  guild_id TEXT NOT NULL,
  discord_user_id TEXT NOT NULL,
  entries INTEGER NOT NULL CHECK (entries >= 1),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (raffle_id, discord_user_id)
);

CREATE INDEX IF NOT EXISTS raffle_entries_guild_idx ON raffle_entries(guild_id, discord_user_id);
