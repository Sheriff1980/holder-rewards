ALTER TABLE verification_sessions
  ADD COLUMN challenge_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE verification_sessions
  ADD COLUMN completion_count INTEGER NOT NULL DEFAULT 0;
