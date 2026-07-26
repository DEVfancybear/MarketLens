-- MT5 execution is paired through the broker-neutral EA. The application no
-- longer receives or stores broker master passwords.
ALTER TABLE user_integrations
  DROP COLUMN IF EXISTS mt5_verified_at,
  DROP COLUMN IF EXISTS mt5_password_cipher,
  DROP COLUMN IF EXISTS mt5_server,
  DROP COLUMN IF EXISTS mt5_login;
