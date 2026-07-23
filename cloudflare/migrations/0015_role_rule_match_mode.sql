ALTER TABLE role_rules
ADD COLUMN match_mode TEXT NOT NULL DEFAULT 'any'
CHECK (match_mode IN ('any', 'all'));
