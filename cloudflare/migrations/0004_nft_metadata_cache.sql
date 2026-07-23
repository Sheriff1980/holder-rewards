CREATE TABLE IF NOT EXISTS nft_metadata_cache (
  chain_id TEXT NOT NULL,
  contract_address TEXT NOT NULL,
  token_id TEXT NOT NULL,
  attributes TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (chain_id, contract_address, token_id)
);

CREATE INDEX IF NOT EXISTS nft_metadata_cache_expiry_idx ON nft_metadata_cache(expires_at);
