DO $migration_0042$
DECLARE
  invalid_write_was_rejected boolean;
  managed_column_count integer;
  managed_session_column_count integer;
BEGIN
  IF (SELECT count(*) FROM execution_accounts
      WHERE connector_kind = 'windows_vm' AND server = '') <> 2 THEN
    RAISE EXCEPTION '0042 did not scrub execution_accounts.server';
  END IF;
  IF (SELECT count(*) FROM execution_mt5_vm_accounts
      WHERE normalized_server = '' AND connection_status = 'credentials_required') <> 2 THEN
    RAISE EXCEPTION '0042 did not redact managed server state and require credentials';
  END IF;
  IF (SELECT count(*) FROM execution_mt5_vm_account_state
      WHERE observed_server = '') <> 2 THEN
    RAISE EXCEPTION '0042 did not scrub observed server state';
  END IF;
  IF (SELECT count(*) FROM execution_mt5_vm_workers
      WHERE worker_substrate = 'windows_vm') <> 1 THEN
    RAISE EXCEPTION '0042 did not preserve existing workers with the safe substrate default';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = current_schema()
      AND indexname = 'execution_mt5_vm_accounts_active_identity_idx'
  ) THEN
    RAISE EXCEPTION '0042 active identity index is missing';
  END IF;

  SELECT count(*) INTO managed_column_count
  FROM information_schema.columns
  WHERE table_schema = current_schema()
    AND table_name = 'execution_pairing_tokens'
    AND column_name IN (
      'managed_account_id', 'managed_worker_id', 'worker_session_generation',
      'lease_generation', 'connection_revision', 'masked_login_suffix',
      'identity_fingerprint', 'managed_slot_id', 'managed_terminal_pid',
      'managed_gateway_origin'
    );
  IF managed_column_count <> 10 THEN
    RAISE EXCEPTION '0042 managed pairing binding columns are incomplete';
  END IF;
  SELECT count(*) INTO managed_session_column_count
  FROM information_schema.columns
  WHERE table_schema = current_schema()
    AND table_name = 'execution_ea_sessions'
    AND column_name IN (
      'managed_worker_id', 'worker_session_generation', 'lease_generation',
      'connection_revision', 'managed_slot_id', 'managed_terminal_pid',
      'managed_gateway_origin'
    );
  IF managed_session_column_count <> 7 THEN
    RAISE EXCEPTION '0042 managed EA session binding columns are incomplete';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'execution_mt5_vm_accounts'
      AND column_name = 'pending_reserved_at'
  ) THEN
    RAISE EXCEPTION '0042 pending credential reservation lease is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'execution_mt5_vm_accounts'
      AND column_name = 'disconnect_requested_revision'
  ) THEN
    RAISE EXCEPTION '0042 idempotent disconnect revision marker is missing';
  END IF;
  IF to_regprocedure(
      'execution_fence_mt5_managed_disconnect(uuid,text,bigint)'
    ) IS NULL THEN
    RAISE EXCEPTION '0042 transactional managed disconnect fence is missing';
  END IF;
  IF to_regprocedure(
      'execution_bind_mt5_managed_ea_bootstrap(bytea,text,bigint,text,bigint,bigint,text,bigint,text)'
    ) IS NULL THEN
    RAISE EXCEPTION '0042 authenticated managed EA runtime binder is missing';
  END IF;

  invalid_write_was_rejected := false;
  BEGIN
    UPDATE execution_mt5_vm_accounts
    SET normalized_server = 'must-not-persist.example'
    WHERE account_id = 'mt5acct01';
  EXCEPTION WHEN check_violation THEN
    invalid_write_was_rejected := true;
  END;
  IF NOT invalid_write_was_rejected THEN
    RAISE EXCEPTION '0042 normalized_server redaction constraint is fail-open';
  END IF;

  invalid_write_was_rejected := false;
  BEGIN
    UPDATE execution_mt5_vm_account_state
    SET observed_server = 'must-not-persist.example'
    WHERE account_id = 'mt5acct01';
  EXCEPTION WHEN check_violation THEN
    invalid_write_was_rejected := true;
  END;
  IF NOT invalid_write_was_rejected THEN
    RAISE EXCEPTION '0042 observed_server redaction constraint is fail-open';
  END IF;

  invalid_write_was_rejected := false;
  BEGIN
    UPDATE execution_mt5_vm_accounts
    SET identity_fingerprint = decode('01', 'hex')
    WHERE account_id = 'mt5acct01';
  EXCEPTION WHEN check_violation THEN
    invalid_write_was_rejected := true;
  END;
  IF NOT invalid_write_was_rejected THEN
    RAISE EXCEPTION '0042 fingerprint length constraint is fail-open';
  END IF;

  UPDATE execution_mt5_vm_accounts
  SET masked_login_suffix = '****'
  WHERE account_id = 'mt5acct01';
  invalid_write_was_rejected := false;
  BEGIN
    UPDATE execution_mt5_vm_accounts
    SET masked_login_suffix = '1'
    WHERE account_id = 'mt5acct01';
  EXCEPTION WHEN check_violation THEN
    invalid_write_was_rejected := true;
  END;
  IF NOT invalid_write_was_rejected THEN
    RAISE EXCEPTION '0042 accepted a raw short login as a persisted suffix';
  END IF;
  UPDATE execution_mt5_vm_accounts
  SET masked_login_suffix = '1001'
  WHERE account_id = 'mt5acct01';

  invalid_write_was_rejected := false;
  BEGIN
    UPDATE execution_mt5_vm_accounts
    SET pending_secret_ref = 'mt5-33333333333333333333333333333333',
        pending_reserved_at = NULL
    WHERE account_id = 'mt5acct01';
  EXCEPTION WHEN check_violation THEN
    invalid_write_was_rejected := true;
  END;
  IF NOT invalid_write_was_rejected THEN
    RAISE EXCEPTION '0042 allowed an unfenced pending credential reservation';
  END IF;
  invalid_write_was_rejected := false;
  BEGIN
    UPDATE execution_mt5_vm_accounts
    SET disconnect_requested_revision = 0
    WHERE account_id = 'mt5acct01';
  EXCEPTION WHEN check_violation THEN
    invalid_write_was_rejected := true;
  END;
  IF NOT invalid_write_was_rejected THEN
    RAISE EXCEPTION '0042 accepted an invalid disconnect revision marker';
  END IF;
  UPDATE execution_mt5_vm_accounts
  SET pending_secret_ref = 'mt5-33333333333333333333333333333333',
      pending_reserved_at = now()
  WHERE account_id = 'mt5acct01';
  UPDATE execution_mt5_vm_accounts
  SET pending_secret_ref = NULL, pending_reserved_at = NULL
  WHERE account_id = 'mt5acct01';

  UPDATE execution_mt5_vm_accounts
  SET identity_fingerprint = decode(repeat('a1', 32), 'hex'),
      connection_status = 'queued'
  WHERE account_id = 'mt5acct01';

  invalid_write_was_rejected := false;
  BEGIN
    UPDATE execution_mt5_vm_accounts
    SET identity_fingerprint = decode(repeat('a1', 32), 'hex'),
        connection_status = 'queued'
    WHERE account_id = 'mt5acct02';
  EXCEPTION WHEN unique_violation THEN
    invalid_write_was_rejected := true;
  END;
  IF NOT invalid_write_was_rejected THEN
    RAISE EXCEPTION '0042 allowed a cross-owner active identity fingerprint collision';
  END IF;

  invalid_write_was_rejected := false;
  BEGIN
    INSERT INTO execution_pairing_tokens (
      user_id, token_hash, expires_at, managed_account_id
    ) VALUES (
      '42000000-0000-4000-8000-000000000001',
      decode(repeat('25', 32), 'hex'),
      now() + interval '30 minutes',
      'mt5acct01'
    );
  EXCEPTION WHEN check_violation THEN
    invalid_write_was_rejected := true;
  END;
  IF NOT invalid_write_was_rejected THEN
    RAISE EXCEPTION '0042 accepted a partial managed pairing binding';
  END IF;

  INSERT INTO execution_pairing_tokens (
    user_id, token_hash, expires_at, managed_account_id, managed_worker_id,
    worker_session_generation, lease_generation, connection_revision,
    masked_login_suffix, identity_fingerprint
  ) VALUES (
    '42000000-0000-4000-8000-000000000001',
    decode(repeat('26', 32), 'hex'),
    now() + interval '30 minutes',
    'mt5acct01', 'migration-worker-0042', 7, 1, 3, '****',
    decode(repeat('a1', 32), 'hex')
  );

  invalid_write_was_rejected := false;
  BEGIN
    UPDATE execution_pairing_tokens
    SET managed_slot_id = 'slot-01'
    WHERE token_hash = decode(repeat('26', 32), 'hex');
  EXCEPTION WHEN check_violation THEN
    invalid_write_was_rejected := true;
  END;
  IF NOT invalid_write_was_rejected THEN
    RAISE EXCEPTION '0042 accepted a partial runtime pairing binding';
  END IF;

  invalid_write_was_rejected := false;
  BEGIN
    INSERT INTO execution_pairing_tokens (
      user_id, token_hash, expires_at, managed_account_id, managed_worker_id,
      worker_session_generation, lease_generation, connection_revision,
      masked_login_suffix, identity_fingerprint
    ) VALUES (
      '42000000-0000-4000-8000-000000000001',
      decode(repeat('27', 32), 'hex'),
      now() + interval '30 minutes',
      'mt5acct01', 'migration-worker-0042', 7, 1, 3, '1001',
      decode(repeat('a1', 32), 'hex')
    );
  EXCEPTION WHEN unique_violation THEN
    invalid_write_was_rejected := true;
  END;
  IF NOT invalid_write_was_rejected THEN
    RAISE EXCEPTION '0042 allowed two active bootstraps for one managed assignment';
  END IF;

  DELETE FROM execution_pairing_tokens
  WHERE token_hash IN (
    decode(repeat('26', 32), 'hex'),
    decode(repeat('27', 32), 'hex')
  );
  UPDATE execution_mt5_vm_accounts
  SET identity_fingerprint = NULL,
      pending_identity_fingerprint = NULL,
      server_fingerprint = NULL,
      pending_server_fingerprint = NULL,
      connection_status = 'credentials_required';
END
$migration_0042$;
