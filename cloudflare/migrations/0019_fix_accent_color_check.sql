CREATE TABLE guild_settings_rebuilt (
  guild_id TEXT PRIMARY KEY REFERENCES guilds(id) ON DELETE CASCADE,
  app_name TEXT NOT NULL DEFAULT 'Holder Rewards',
  reward_currency_name TEXT NOT NULL DEFAULT 'Points',
  public_wallet_visibility INTEGER NOT NULL DEFAULT 0
    CHECK (public_wallet_visibility IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  daily_claim_amount INTEGER NOT NULL DEFAULT 10
    CHECK (daily_claim_amount BETWEEN 1 AND 1000000),
  accent_color TEXT NOT NULL DEFAULT '#2F80ED'
    CHECK (
      length(accent_color) = 7
      AND substr(accent_color, 1, 1) = '#'
      AND substr(accent_color, 2) NOT GLOB '*[^0-9A-Fa-f]*'
    ),
  manager_full_wallet_visibility INTEGER NOT NULL DEFAULT 0
    CHECK (manager_full_wallet_visibility IN (0, 1)),
  holder_daily_amount INTEGER NOT NULL DEFAULT 0
    CHECK (holder_daily_amount BETWEEN 0 AND 1000000)
);

INSERT INTO guild_settings_rebuilt (
  guild_id,
  app_name,
  reward_currency_name,
  public_wallet_visibility,
  created_at,
  updated_at,
  daily_claim_amount,
  accent_color,
  manager_full_wallet_visibility,
  holder_daily_amount
)
SELECT
  guild_id,
  app_name,
  reward_currency_name,
  public_wallet_visibility,
  created_at,
  updated_at,
  daily_claim_amount,
  accent_color,
  manager_full_wallet_visibility,
  holder_daily_amount
FROM guild_settings;

DROP TABLE guild_settings;
ALTER TABLE guild_settings_rebuilt RENAME TO guild_settings;
