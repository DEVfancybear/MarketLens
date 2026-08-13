-- Phase 3: durable, non-secret MT5 connection and one-time Vault grant state.
-- PostgreSQL stores only opaque references and hashes; raw broker credentials and
-- Vault wrapping tokens are never written here.

ALTER TABLE execution_mt5_vm_accounts
  ADD COLUMN credential_revision bigint NOT NULL DEFAULT 1 CHECK (credential_revision > 0),
  ADD COLUMN credentials_updated_at timestamptz,
  ADD COLUMN credential_consumed_at timestamptz,
  ADD COLUMN removal_requested_at timestamptz,
  ADD COLUMN pending_secret_ref text CHECK (
    pending_secret_ref IS NULL OR pending_secret_ref ~ '^mt5-[0-9a-f]{32}$'
  );

ALTER TABLE execution_accounts
  ADD CONSTRAINT execution_accounts_mt5_vm_secret_ref_check CHECK (
    connector_kind <> 'windows_vm' OR secret_ref IS NULL OR
    secret_ref ~ '^mt5-[0-9a-f]{32}$'
  );

CREATE TABLE execution_mt5_vm_credential_grants (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                    uuid NOT NULL,
  account_id                 text NOT NULL,
  command_id                 uuid NOT NULL UNIQUE REFERENCES execution_mt5_vm_control_commands(id)
                               ON DELETE CASCADE,
  worker_id                  text NOT NULL REFERENCES execution_mt5_vm_workers(worker_id)
                               ON DELETE RESTRICT,
  worker_session_generation  bigint NOT NULL CHECK (worker_session_generation > 0),
  lease_generation           bigint NOT NULL CHECK (lease_generation > 0),
  grant_token_hash           bytea NOT NULL UNIQUE CHECK (octet_length(grant_token_hash) = 32),
  status                     text NOT NULL DEFAULT 'issued' CHECK (
                               status IN ('issued', 'consumed', 'expired', 'revoked')
                             ),
  expires_at                 timestamptz NOT NULL,
  issued_at                  timestamptz NOT NULL DEFAULT now(),
  consumed_at                timestamptz,
  FOREIGN KEY (user_id, account_id)
    REFERENCES execution_mt5_vm_accounts(user_id, account_id) ON DELETE CASCADE,
  CHECK (expires_at > issued_at),
  CHECK (
    (status = 'consumed' AND consumed_at IS NOT NULL) OR
    (status <> 'consumed' AND consumed_at IS NULL)
  )
);
CREATE INDEX execution_mt5_vm_credential_grants_expiry_idx
  ON execution_mt5_vm_credential_grants (expires_at, id)
  WHERE status = 'issued';

COMMENT ON TABLE execution_mt5_vm_credential_grants IS
  'One-time worker/session/lease-bound credential grant metadata; never stores raw grant tokens or broker credentials.';
