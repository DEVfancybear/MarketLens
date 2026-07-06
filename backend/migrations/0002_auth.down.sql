-- Reverse 0002_auth. Drop in FK-safe order (children before parents).
DROP TABLE IF EXISTS push_tokens;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS auth_identities;
DROP TABLE IF EXISTS users;

DROP TYPE IF EXISTS push_platform;
DROP TYPE IF EXISTS auth_provider;
DROP TYPE IF EXISTS user_status;

DROP FUNCTION IF EXISTS set_updated_at();
