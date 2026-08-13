DROP TABLE IF EXISTS execution_mt5_vm_credential_grants;
ALTER TABLE execution_accounts
  DROP CONSTRAINT IF EXISTS execution_accounts_mt5_vm_secret_ref_check;
ALTER TABLE execution_mt5_vm_accounts
  DROP COLUMN IF EXISTS pending_secret_ref,
  DROP COLUMN IF EXISTS removal_requested_at,
  DROP COLUMN IF EXISTS credential_consumed_at,
  DROP COLUMN IF EXISTS credentials_updated_at,
  DROP COLUMN IF EXISTS credential_revision;
