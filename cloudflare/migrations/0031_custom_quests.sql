CREATE TABLE quests_new (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('link_wallet', 'hold_role', 'daily_claims', 'code', 'custom')),
  config TEXT NOT NULL DEFAULT '{}',
  reward INTEGER NOT NULL CHECK (reward >= 1 AND reward <= 1000000),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO quests_new (id, guild_id, title, kind, config, reward, enabled, created_at, updated_at)
SELECT id, guild_id, title, kind, config, reward, enabled, created_at, updated_at FROM quests;

CREATE TABLE quest_completions_new (
  quest_id TEXT NOT NULL REFERENCES quests_new(id) ON DELETE CASCADE,
  guild_id TEXT NOT NULL,
  discord_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (quest_id, discord_user_id)
);

INSERT INTO quest_completions_new (quest_id, guild_id, discord_user_id, created_at)
SELECT quest_id, guild_id, discord_user_id, created_at FROM quest_completions;

CREATE TABLE quest_submissions_new (
  id TEXT PRIMARY KEY,
  quest_id TEXT NOT NULL REFERENCES quests_new(id) ON DELETE CASCADE,
  guild_id TEXT NOT NULL,
  discord_user_id TEXT NOT NULL,
  proof TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT,
  UNIQUE (quest_id, discord_user_id)
);

INSERT INTO quest_submissions_new
  (id, quest_id, guild_id, discord_user_id, proof, status, reviewed_by, created_at, reviewed_at)
SELECT id, quest_id, guild_id, discord_user_id, proof, status, reviewed_by, created_at, reviewed_at
FROM quest_submissions;

DROP TABLE quest_submissions;
DROP TABLE quest_completions;
DROP TABLE quests;

ALTER TABLE quests_new RENAME TO quests;
ALTER TABLE quest_completions_new RENAME TO quest_completions;
ALTER TABLE quest_submissions_new RENAME TO quest_submissions;

CREATE INDEX quests_guild_idx ON quests(guild_id, enabled);
CREATE INDEX quest_completions_guild_idx ON quest_completions(guild_id, discord_user_id);
CREATE INDEX quest_submissions_guild_idx ON quest_submissions(guild_id, status);
