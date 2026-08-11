CREATE TABLE trade_password_recovery_codes (
    user_id          uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    code_hash        bytea NOT NULL CHECK (octet_length(code_hash) = 32),
    failed_attempts  integer NOT NULL DEFAULT 0
        CHECK (failed_attempts >= 0 AND failed_attempts <= 5),
    sent_at          timestamptz NOT NULL DEFAULT now(),
    expires_at       timestamptz NOT NULL,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    CHECK (expires_at > sent_at AND expires_at <= sent_at + interval '15 minutes')
);

CREATE INDEX trade_password_recovery_codes_expiry_idx
    ON trade_password_recovery_codes (expires_at);

CREATE TRIGGER trg_trade_password_recovery_codes_set_updated_at
    BEFORE UPDATE ON trade_password_recovery_codes
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE trade_password_recovery_codes IS
    'Single-use, HMAC-protected email codes for resetting a configured trade password.';
