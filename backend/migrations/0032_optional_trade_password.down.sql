CREATE TABLE webauthn_credentials (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    credential_id   bytea NOT NULL UNIQUE,
    credential_data bytea NOT NULL,
    label            text NOT NULL DEFAULT 'Passkey' CHECK (char_length(label) BETWEEN 1 AND 80),
    created_at       timestamptz NOT NULL DEFAULT now(),
    last_used_at     timestamptz,
    updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX webauthn_credentials_user_idx
    ON webauthn_credentials (user_id, created_at);

CREATE TRIGGER trg_webauthn_credentials_set_updated_at
    BEFORE UPDATE ON webauthn_credentials
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE webauthn_challenges (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id   uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    ceremony     text NOT NULL CHECK (ceremony IN ('registration', 'transaction')),
    operation    text CHECK (operation IS NULL OR operation IN ('order', 'command')),
    payload      jsonb,
    session_data bytea NOT NULL,
    expires_at   timestamptz NOT NULL,
    consumed_at  timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now(),
    CHECK (
        (ceremony = 'registration' AND operation IS NULL AND payload IS NULL) OR
        (ceremony = 'transaction' AND operation IS NOT NULL AND payload IS NOT NULL)
    ),
    CHECK (expires_at > created_at AND expires_at <= created_at + interval '5 minutes')
);

CREATE INDEX webauthn_challenges_active_idx
    ON webauthn_challenges (user_id, session_id, expires_at)
    WHERE consumed_at IS NULL;

ALTER TABLE trade_authorizations
    DROP COLUMN verification_method;

-- Credential data cannot be reconstructed after the forward migration. The
-- nullable column keeps existing authorizations readable during rollback.
ALTER TABLE trade_authorizations
    ADD COLUMN credential_id uuid REFERENCES webauthn_credentials(id) ON DELETE RESTRICT;

COMMENT ON TABLE trade_authorizations IS
    'One-time authorizations bound to an exact JSONB execution payload.';

DROP TRIGGER IF EXISTS trg_trade_security_settings_set_updated_at
    ON trade_security_settings;
DROP TABLE trade_unlock_sessions;
DROP TABLE trade_security_settings;
