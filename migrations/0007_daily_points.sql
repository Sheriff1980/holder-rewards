CREATE UNIQUE INDEX IF NOT EXISTS point_transactions_daily_claim_idx
  ON point_transactions(guild_id, discord_user_id, source)
  WHERE source LIKE 'daily_claim:%';
