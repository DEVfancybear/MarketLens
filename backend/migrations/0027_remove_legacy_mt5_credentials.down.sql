-- Rollback restores only empty compatibility columns. Deleted broker
-- credentials are intentionally not recoverable from the application database.
ALTER TABLE user_integrations
  ADD COLUMN mt5_login text NOT NULL DEFAULT '',
  ADD COLUMN mt5_server text NOT NULL DEFAULT '',
  ADD COLUMN mt5_password_cipher bytea,
  ADD COLUMN mt5_verified_at timestamptz;
