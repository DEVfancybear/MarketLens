DROP INDEX IF EXISTS execution_ea_sessions_poll_liveness_idx;

ALTER TABLE execution_ea_sessions
  DROP COLUMN IF EXISTS last_poll_at;
