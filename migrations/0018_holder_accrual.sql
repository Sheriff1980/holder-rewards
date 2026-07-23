ALTER TABLE guild_settings ADD COLUMN holder_daily_amount INTEGER NOT NULL DEFAULT 0
  CHECK (holder_daily_amount BETWEEN 0 AND 1000000);

ALTER TABLE role_rules ADD COLUMN reward_multiplier INTEGER NOT NULL DEFAULT 1
  CHECK (reward_multiplier BETWEEN 1 AND 100);

CREATE UNIQUE INDEX IF NOT EXISTS point_transactions_holder_accrual_idx
  ON point_transactions(guild_id, discord_user_id, source)
  WHERE source LIKE 'holder_accrual:%';
