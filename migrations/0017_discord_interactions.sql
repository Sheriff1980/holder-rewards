CREATE TABLE IF NOT EXISTS discord_interactions (
  interaction_id TEXT PRIMARY KEY,
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS discord_interactions_received_at_idx
  ON discord_interactions(received_at);
