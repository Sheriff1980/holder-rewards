CREATE TABLE IF NOT EXISTS chain_configs (
  id TEXT PRIMARY KEY,
  family TEXT NOT NULL CHECK (family IN ('evm', 'solana')),
  name TEXT NOT NULL,
  chain_reference TEXT NOT NULL,
  native_currency_symbol TEXT NOT NULL,
  rpc_url TEXT,
  explorer_url TEXT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (family, chain_reference)
);

CREATE INDEX IF NOT EXISTS chain_configs_enabled_idx ON chain_configs(enabled);
