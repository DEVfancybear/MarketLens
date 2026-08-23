DROP FUNCTION IF EXISTS execution_advance_mt5_managed_readiness(uuid, text, bigint);
DROP FUNCTION IF EXISTS execution_fence_mt5_managed_disconnect(uuid, text, bigint);
DROP FUNCTION IF EXISTS execution_bind_mt5_managed_ea_bootstrap(
  bytea, text, bigint, text, bigint, bigint, text, bigint, text
);

DROP INDEX IF EXISTS execution_pairing_tokens_managed_assignment_active_idx;

ALTER TABLE execution_pairing_tokens
  DROP CONSTRAINT IF EXISTS execution_pairing_tokens_managed_binding_check,
  DROP CONSTRAINT IF EXISTS execution_pairing_tokens_managed_worker_fk,
  DROP CONSTRAINT IF EXISTS execution_pairing_tokens_managed_account_fk,
  DROP COLUMN IF EXISTS managed_gateway_origin,
  DROP COLUMN IF EXISTS managed_terminal_pid,
  DROP COLUMN IF EXISTS managed_slot_id,
  DROP COLUMN IF EXISTS masked_login_suffix,
  DROP COLUMN IF EXISTS connection_revision,
  DROP COLUMN IF EXISTS lease_generation,
  DROP COLUMN IF EXISTS worker_session_generation,
  DROP COLUMN IF EXISTS managed_worker_id,
  DROP COLUMN IF EXISTS identity_fingerprint,
  DROP COLUMN IF EXISTS managed_account_id;

ALTER TABLE execution_ea_sessions
  DROP CONSTRAINT IF EXISTS execution_ea_sessions_managed_runtime_binding_check,
  DROP COLUMN IF EXISTS managed_gateway_origin,
  DROP COLUMN IF EXISTS managed_terminal_pid,
  DROP COLUMN IF EXISTS managed_slot_id,
  DROP COLUMN IF EXISTS connection_revision,
  DROP COLUMN IF EXISTS lease_generation,
  DROP COLUMN IF EXISTS worker_session_generation,
  DROP COLUMN IF EXISTS managed_worker_id;

DROP INDEX IF EXISTS execution_mt5_vm_accounts_active_identity_idx;

ALTER TABLE execution_mt5_vm_account_state
  DROP CONSTRAINT IF EXISTS execution_mt5_vm_account_state_observed_server_redacted_check;
UPDATE execution_mt5_vm_account_state SET observed_server = 'redacted';
ALTER TABLE execution_mt5_vm_account_state
  ADD CONSTRAINT execution_mt5_vm_account_state_observed_server_check
  CHECK (char_length(observed_server) BETWEEN 1 AND 128);

ALTER TABLE execution_mt5_vm_accounts
  DROP CONSTRAINT IF EXISTS execution_mt5_vm_accounts_normalized_server_redacted_check;
UPDATE execution_mt5_vm_accounts SET normalized_server = 'redacted';
ALTER TABLE execution_mt5_vm_accounts
  ADD CONSTRAINT execution_mt5_vm_accounts_normalized_server_check
  CHECK (char_length(normalized_server) BETWEEN 1 AND 128);
UPDATE execution_accounts
SET server = 'redacted'
WHERE connector_kind = 'windows_vm' AND server = '';

ALTER TABLE execution_mt5_vm_accounts
  DROP CONSTRAINT IF EXISTS execution_mt5_vm_accounts_masked_login_suffix_check;
UPDATE execution_mt5_vm_accounts
SET masked_login_suffix = NULL
WHERE masked_login_suffix = '****';
ALTER TABLE execution_mt5_vm_accounts
  ADD CONSTRAINT execution_mt5_vm_accounts_masked_login_suffix_check CHECK (
    masked_login_suffix IS NULL OR masked_login_suffix ~ '^[0-9]{1,4}$'
  );

ALTER TABLE execution_mt5_vm_accounts
  DROP CONSTRAINT IF EXISTS execution_mt5_vm_accounts_pending_reservation_check,
  DROP COLUMN IF EXISTS disconnect_requested_revision,
  DROP COLUMN IF EXISTS pending_reserved_at,
  DROP COLUMN IF EXISTS pending_server_fingerprint,
  DROP COLUMN IF EXISTS server_fingerprint,
  DROP COLUMN IF EXISTS pending_identity_fingerprint,
  DROP COLUMN IF EXISTS identity_fingerprint;

ALTER TABLE execution_mt5_vm_workers
  DROP COLUMN IF EXISTS worker_substrate;
