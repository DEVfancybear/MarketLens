-- Authentication & identity (DATABASE.md §5).
-- Includes the shared set_updated_at() trigger function (declared here because
-- the auth tables are the first mutable tables; later migrations reuse it).

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 5.1 users
CREATE TYPE user_status AS ENUM ('active', 'disabled', 'deleted');

CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          citext UNIQUE NOT NULL,
  email_verified boolean NOT NULL DEFAULT false,
  display_name   text,
  photo_url      text,
  status         user_status NOT NULL DEFAULT 'active',
  last_login_at  timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_users_set_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 5.2 auth_identities
CREATE TYPE auth_provider AS ENUM ('google');

CREATE TABLE auth_identities (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider     auth_provider NOT NULL,
  provider_uid text NOT NULL,               -- Google 'sub' / stable provider id
  firebase_uid text,                        -- Firebase Auth uid (verified from ID token)
  raw_profile  jsonb NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_uid)
);
CREATE INDEX idx_auth_identities_user ON auth_identities(user_id);
CREATE UNIQUE INDEX idx_auth_identities_firebase ON auth_identities(firebase_uid)
  WHERE firebase_uid IS NOT NULL;

CREATE TRIGGER trg_auth_identities_set_updated_at BEFORE UPDATE ON auth_identities
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 5.3 sessions (refresh tokens)
CREATE TABLE sessions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash text NOT NULL,          -- SHA-256 of the opaque refresh token
  user_agent         text,
  ip                 inet,
  expires_at         timestamptz NOT NULL,
  revoked_at         timestamptz,            -- non-null = logged out / rotated
  created_at         timestamptz NOT NULL DEFAULT now(),
  last_used_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_sessions_user ON sessions(user_id) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX idx_sessions_token ON sessions(refresh_token_hash);

-- 5.4 push_tokens (FCM)
CREATE TYPE push_platform AS ENUM ('web', 'android', 'ios');

CREATE TABLE push_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fcm_token    text NOT NULL,
  platform     push_platform NOT NULL DEFAULT 'web',
  permission   text,                          -- 'granted' | 'denied' | 'default'
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (fcm_token)
);
CREATE INDEX idx_push_tokens_user ON push_tokens(user_id);
