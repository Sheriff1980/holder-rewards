ALTER TABLE store_items ADD COLUMN purchase_limit_per_member INTEGER
  CHECK (purchase_limit_per_member IS NULL OR (purchase_limit_per_member >= 1 AND purchase_limit_per_member <= 10000));
