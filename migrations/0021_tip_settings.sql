ALTER TABLE guild_settings
  ADD COLUMN tip_daily_limit INTEGER NOT NULL DEFAULT 100
  CHECK (tip_daily_limit >= 0 AND tip_daily_limit <= 1000000);
