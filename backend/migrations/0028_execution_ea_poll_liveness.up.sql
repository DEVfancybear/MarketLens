ALTER TABLE execution_ea_sessions
  ADD COLUMN last_poll_at timestamptz;

CREATE INDEX execution_ea_sessions_poll_liveness_idx
  ON execution_ea_sessions (user_id, account_id, last_poll_at DESC)
  WHERE revoked_at IS NULL;
