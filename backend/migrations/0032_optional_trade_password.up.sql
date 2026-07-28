CREATE TABLE trade_security_settings (
    user_id          uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    enabled          boolean NOT NULL DEFAULT false,
    password_hash    text,
    failed_attempts  integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
    locked_until     timestamptz,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    CHECK (password_hash IS NULL OR char_length(password_hash) BETWEEN 80 AND 512)
);

CREATE TRIGGER trg_trade_security_settings_set_updated_at
    BEFORE UPDATE ON trade_security_settings
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE trade_unlock_sessions (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id    uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    token_hash    bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
    expires_at    timestamptz NOT NULL,
    last_used_at  timestamptz NOT NULL DEFAULT now(),
    created_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, session_id),
    CHECK (expires_at > created_at AND expires_at <= created_at + interval '24 hours')
);

CREATE INDEX trade_unlock_sessions_active_idx
    ON trade_unlock_sessions (user_id, session_id, expires_at);

-- Keep the one-time, exact-payload authorization boundary while removing its
-- dependency on a WebAuthn credential.
ALTER TABLE trade_authorizations
    DROP COLUMN credential_id;

ALTER TABLE trade_authorizations
    ADD COLUMN verification_method text NOT NULL DEFAULT 'disabled'
        CHECK (verification_method IN ('disabled', 'password', 'session'));

COMMENT ON TABLE trade_authorizations IS
    'One-time trade authorizations bound to an exact JSONB payload, session, user, and operation.';

DROP TABLE webauthn_challenges;
DROP TABLE webauthn_credentials;
