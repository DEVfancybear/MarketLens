DO $migration_0042$
DECLARE
  invalid_write_was_rejected boolean;
  removed_column_count integer;
BEGIN
  IF (SELECT count(*) FROM execution_accounts
      WHERE connector_kind = 'windows_vm' AND server = 'redacted') <> 2 THEN
    RAISE EXCEPTION '0042 down did not leave registry server redacted';
  END IF;
  IF (SELECT count(*) FROM execution_mt5_vm_accounts
      WHERE normalized_server = 'redacted') <> 2 THEN
    RAISE EXCEPTION '0042 down did not leave normalized server redacted';
  END IF;
  IF (SELECT count(*) FROM execution_mt5_vm_account_state
      WHERE observed_server = 'redacted') <> 2 THEN
    RAISE EXCEPTION '0042 down did not leave observed server redacted';
  END IF;

  SELECT count(*) INTO removed_column_count
  FROM information_schema.columns
  WHERE table_schema = current_schema()
    AND (
      (table_name = 'execution_mt5_vm_workers' AND column_name = 'worker_substrate') OR
      (table_name = 'execution_mt5_vm_accounts' AND column_name IN (
        'identity_fingerprint', 'pending_identity_fingerprint',
        'server_fingerprint', 'pending_server_fingerprint',
        'pending_reserved_at', 'disconnect_requested_revision'
      )) OR
      (table_name = 'execution_pairing_tokens' AND column_name IN (
        'managed_account_id', 'managed_worker_id', 'worker_session_generation',
        'lease_generation', 'connection_revision', 'masked_login_suffix',
        'identity_fingerprint', 'managed_slot_id', 'managed_terminal_pid',
        'managed_gateway_origin'
      )) OR
      (table_name = 'execution_ea_sessions' AND column_name IN (
        'managed_worker_id', 'worker_session_generation', 'lease_generation',
        'connection_revision', 'managed_slot_id', 'managed_terminal_pid',
        'managed_gateway_origin'
      ))
    );
  IF removed_column_count <> 0 THEN
    RAISE EXCEPTION '0042 down left revision-15 columns behind';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = current_schema()
      AND indexname IN (
        'execution_mt5_vm_accounts_active_identity_idx',
        'execution_pairing_tokens_managed_assignment_active_idx'
      )
  ) THEN
    RAISE EXCEPTION '0042 down left revision-15 indexes behind';
  END IF;
  IF to_regprocedure(
      'execution_bind_mt5_managed_ea_bootstrap(bytea,text,bigint,text,bigint,bigint,text,bigint,text)'
    ) IS NOT NULL THEN
    RAISE EXCEPTION '0042 down left managed EA runtime binder behind';
  END IF;

  invalid_write_was_rejected := false;
  BEGIN
    UPDATE execution_mt5_vm_accounts
    SET normalized_server = ''
    WHERE account_id = 'mt5acct01';
  EXCEPTION WHEN check_violation THEN
    invalid_write_was_rejected := true;
  END;
  IF NOT invalid_write_was_rejected THEN
    RAISE EXCEPTION '0042 down restored a fail-open normalized server constraint';
  END IF;

  invalid_write_was_rejected := false;
  BEGIN
    UPDATE execution_mt5_vm_account_state
    SET observed_server = ''
    WHERE account_id = 'mt5acct01';
  EXCEPTION WHEN check_violation THEN
    invalid_write_was_rejected := true;
  END;
  IF NOT invalid_write_was_rejected THEN
    RAISE EXCEPTION '0042 down restored a fail-open observed server constraint';
  END IF;
END
$migration_0042$;
