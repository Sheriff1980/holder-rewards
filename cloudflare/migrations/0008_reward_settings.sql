ALTER TABLE guild_settings ADD COLUMN daily_claim_amount INTEGER NOT NULL DEFAULT 10
  CHECK (daily_claim_amount BETWEEN 1 AND 1000000);
