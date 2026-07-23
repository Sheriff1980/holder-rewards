ALTER TABLE guild_settings
  ADD COLUMN manager_full_wallet_visibility INTEGER NOT NULL DEFAULT 0
  CHECK (manager_full_wallet_visibility IN (0, 1));
