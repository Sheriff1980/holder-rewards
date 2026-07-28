ALTER TABLE role_rules
  ADD COLUMN group_key TEXT NOT NULL DEFAULT '';

ALTER TABLE role_rules
  ADD COLUMN group_match_mode TEXT NOT NULL DEFAULT 'any'
  CHECK (group_match_mode IN ('any', 'all'));

UPDATE role_rules SET group_match_mode = match_mode WHERE group_key = '';
