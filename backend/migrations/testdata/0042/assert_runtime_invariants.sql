UPDATE execution_mt5_vm_workers
SET worker_substrate = 'bare_metal',
    status = 'healthy',
    drain = false,
    session_generation = 7,
    last_heartbeat_at = now(),
    heartbeat_expires_at = now() + interval '30 minutes'
WHERE worker_id = 'migration-worker-0042';

UPDATE execution_accounts
SET status = 'connecting',
    last_seen_at = now(),
    trade_allowed = true,
    secret_ref = 'mt5-11111111111111111111111111111111'
WHERE id = 'mt5acct01'
  AND user_id = '42000000-0000-4000-8000-000000000001';

UPDATE execution_mt5_vm_accounts
SET worker_id = 'migration-worker-0042',
    lease_generation = 1,
    connection_status = 'synchronizing',
    identity_fingerprint = decode(repeat('a1', 32), 'hex'),
    server_fingerprint = decode(repeat('b1', 32), 'hex')
WHERE account_id = 'mt5acct01';

UPDATE execution_mt5_vm_account_state
SET observed_server = '',
    worker_id = 'migration-worker-0042',
    lease_generation = 1,
    worker_session_generation = 7,
    sync_sequence = 2,
    observed_at = now()
WHERE account_id = 'mt5acct01';

INSERT INTO execution_mt5_vm_account_leases (
  user_id, account_id, worker_id, worker_session_generation, generation,
  status, expires_at
)
VALUES (
  '42000000-0000-4000-8000-000000000001', 'mt5acct01',
  'migration-worker-0042', 7, 1, 'active', now() + interval '30 minutes'
)
ON CONFLICT (account_id) DO UPDATE SET
  worker_id = EXCLUDED.worker_id,
  worker_session_generation = EXCLUDED.worker_session_generation,
  generation = EXCLUDED.generation,
  status = 'active',
  expires_at = EXCLUDED.expires_at,
  renewed_at = now(),
  released_at = NULL,
  release_reason = NULL;

INSERT INTO execution_mt5_vm_sync_state (
  user_id, account_id, family, sync_sequence, last_result,
  observed_at, last_complete_sync_at, worker_id, lease_generation,
  worker_session_generation
)
SELECT
  '42000000-0000-4000-8000-000000000001'::uuid,
  'mt5acct01', family, 2, 'complete', now(), now(),
  'migration-worker-0042', 1, 7
FROM unnest(ARRAY['account', 'positions', 'pending_orders', 'instruments']) AS family
ON CONFLICT (account_id, family) DO UPDATE SET
  sync_sequence = EXCLUDED.sync_sequence,
  last_result = 'complete',
  last_error_code = NULL,
  observed_at = EXCLUDED.observed_at,
  last_complete_sync_at = EXCLUDED.last_complete_sync_at,
  worker_id = EXCLUDED.worker_id,
  lease_generation = EXCLUDED.lease_generation,
  worker_session_generation = EXCLUDED.worker_session_generation;

INSERT INTO execution_pairing_tokens (
  user_id, token_hash, expires_at, managed_account_id, managed_worker_id,
  worker_session_generation, lease_generation, connection_revision,
  masked_login_suffix, identity_fingerprint
)
SELECT
  account.user_id, decode(repeat('d1', 32), 'hex'), now() + interval '10 minutes',
  account.account_id, account.worker_id, 7, account.lease_generation,
  account.connection_revision, account.masked_login_suffix,
  account.identity_fingerprint
FROM execution_mt5_vm_accounts account
WHERE account.account_id = 'mt5acct01';

DO $runtime_bind_0042$
DECLARE
  bind_outcome text;
  bind_idempotent boolean;
BEGIN
  SELECT outcome, idempotent INTO bind_outcome, bind_idempotent
  FROM execution_bind_mt5_managed_ea_bootstrap(
    decode(repeat('d1', 32), 'hex'), 'migration-worker-0042', 7,
    'mt5acct01', 1,
    (SELECT connection_revision FROM execution_mt5_vm_accounts
     WHERE account_id = 'mt5acct01'),
    'slot-01', 4242, 'http://127.0.0.1:8790'
  );
  IF bind_outcome <> 'bound' OR bind_idempotent THEN
    RAISE EXCEPTION 'managed EA runtime binding did not bind exactly once';
  END IF;

  SELECT outcome, idempotent INTO bind_outcome, bind_idempotent
  FROM execution_bind_mt5_managed_ea_bootstrap(
    decode(repeat('d1', 32), 'hex'), 'migration-worker-0042', 7,
    'mt5acct01', 1,
    (SELECT connection_revision FROM execution_mt5_vm_accounts
     WHERE account_id = 'mt5acct01'),
    'slot-01', 4242, 'http://127.0.0.1:8790'
  );
  IF bind_outcome <> 'bound' OR NOT bind_idempotent THEN
    RAISE EXCEPTION 'managed EA runtime binding retry was not idempotent';
  END IF;

  SELECT outcome, idempotent INTO bind_outcome, bind_idempotent
  FROM execution_bind_mt5_managed_ea_bootstrap(
    decode(repeat('d1', 32), 'hex'), 'migration-worker-0042', 7,
    'mt5acct01', 1,
    (SELECT connection_revision FROM execution_mt5_vm_accounts
     WHERE account_id = 'mt5acct01'),
    'slot-01', 4243, 'http://127.0.0.1:8790'
  );
  IF bind_outcome <> 'fenced' OR bind_idempotent THEN
    RAISE EXCEPTION 'managed EA runtime binding accepted a different terminal PID';
  END IF;
END
$runtime_bind_0042$;

INSERT INTO execution_ea_sessions (
  id, user_id, account_id, agent_id, token_hash, expires_at,
  absolute_expires_at, last_poll_at, managed_worker_id,
  worker_session_generation, lease_generation, connection_revision,
  managed_slot_id, managed_terminal_pid, managed_gateway_origin
)
SELECT
  '42000000-0000-4000-8000-000000000010',
  '42000000-0000-4000-8000-000000000001',
  'mt5acct01', 'migration-ea-0042', decode(repeat('c1', 32), 'hex'),
  now() + interval '10 minutes', now() + interval '1 hour',
  now() - interval '10 minutes', token.managed_worker_id,
  token.worker_session_generation, token.lease_generation,
  token.connection_revision, token.managed_slot_id,
  token.managed_terminal_pid, token.managed_gateway_origin
FROM execution_pairing_tokens token
WHERE token.token_hash = decode(repeat('d1', 32), 'hex')
ON CONFLICT (id) DO UPDATE SET
  revoked_at = NULL,
  expires_at = EXCLUDED.expires_at,
  absolute_expires_at = EXCLUDED.absolute_expires_at,
  last_poll_at = EXCLUDED.last_poll_at,
  managed_worker_id = EXCLUDED.managed_worker_id,
  worker_session_generation = EXCLUDED.worker_session_generation,
  lease_generation = EXCLUDED.lease_generation,
  connection_revision = EXCLUDED.connection_revision,
  managed_slot_id = EXCLUDED.managed_slot_id,
  managed_terminal_pid = EXCLUDED.managed_terminal_pid,
  managed_gateway_origin = EXCLUDED.managed_gateway_origin;

UPDATE execution_pairing_tokens
SET consumed_at = now()
WHERE token_hash = decode(repeat('d1', 32), 'hex');

DO $runtime_0042$
DECLARE
  revision_before bigint;
BEGIN
  SELECT connection_revision INTO revision_before
  FROM execution_mt5_vm_accounts
  WHERE account_id = 'mt5acct01';

  PERFORM execution_advance_mt5_managed_readiness(
    '42000000-0000-4000-8000-000000000001',
    'mt5acct01',
    30000
  );

  IF (SELECT connection_status FROM execution_mt5_vm_accounts
      WHERE account_id = 'mt5acct01') <> 'synchronizing' THEN
    RAISE EXCEPTION 'managed account became READY without a fresh successful EA poll';
  END IF;
  IF (SELECT connection_revision FROM execution_mt5_vm_accounts
      WHERE account_id = 'mt5acct01') <> revision_before THEN
    RAISE EXCEPTION 'stale EA poll changed the managed connection revision';
  END IF;
  IF (SELECT status FROM execution_accounts
      WHERE id = 'mt5acct01'
        AND user_id = '42000000-0000-4000-8000-000000000001') = 'ready' THEN
    RAISE EXCEPTION 'stale EA poll published READY in the execution registry';
  END IF;

  UPDATE execution_ea_sessions
  SET last_poll_at = now()
  WHERE id = '42000000-0000-4000-8000-000000000010';

  PERFORM execution_advance_mt5_managed_readiness(
    '42000000-0000-4000-8000-000000000001',
    'mt5acct01',
    30000
  );

  IF (SELECT connection_status FROM execution_mt5_vm_accounts
      WHERE account_id = 'mt5acct01') <> 'ready' THEN
    RAISE EXCEPTION 'managed account did not become READY after a fresh successful EA poll';
  END IF;
  IF (SELECT connection_revision FROM execution_mt5_vm_accounts
      WHERE account_id = 'mt5acct01') <> revision_before + 1 THEN
    RAISE EXCEPTION 'fresh EA poll did not advance the managed connection exactly once';
  END IF;
  IF (SELECT connection_revision FROM execution_ea_sessions
      WHERE id = '42000000-0000-4000-8000-000000000010') <> revision_before + 1 THEN
    RAISE EXCEPTION 'managed EA session did not advance with the ready revision';
  END IF;
  IF (SELECT status FROM execution_accounts
      WHERE id = 'mt5acct01'
        AND user_id = '42000000-0000-4000-8000-000000000001') <> 'ready' THEN
    RAISE EXCEPTION 'fresh EA poll did not atomically publish READY in the execution registry';
  END IF;
END
$runtime_0042$;

INSERT INTO execution_mt5_vm_control_commands (
  id, message_id, user_id, account_id, worker_id,
  worker_session_generation, lease_generation, protocol_version,
  idempotency_key, command_kind, payload, status, expires_at,
  dispatch_lease_until, dispatched_at
)
VALUES (
  '42000000-0000-4000-8000-000000000020',
  '42000000-0000-4000-8000-000000000021',
  '42000000-0000-4000-8000-000000000001',
  'mt5acct01', 'migration-worker-0042', 7, 1, 1,
  'migration-0042-credential-command', 'provision_account', '{}',
  'dispatched', now() + interval '10 minutes',
  now() + interval '15 seconds', now()
);

INSERT INTO execution_mt5_vm_credential_grants (
  id, user_id, account_id, command_id, worker_id,
  worker_session_generation, lease_generation, grant_token_hash,
  status, expires_at
)
VALUES (
  '42000000-0000-4000-8000-000000000022',
  '42000000-0000-4000-8000-000000000001',
  'mt5acct01', '42000000-0000-4000-8000-000000000020',
  'migration-worker-0042', 7, 1, decode(repeat('d1', 32), 'hex'),
  'issued', now() + interval '5 minutes'
);

DO $grant_0042$
DECLARE
  first_consume_count integer;
  second_consume_count integer;
BEGIN
  WITH consumed AS (
    UPDATE execution_mt5_vm_credential_grants grant_row
    SET status = 'consumed', consumed_at = now()
    FROM execution_mt5_vm_control_commands command,
         execution_mt5_vm_account_leases lease,
         execution_mt5_vm_workers worker
    WHERE grant_row.command_id = '42000000-0000-4000-8000-000000000020'
      AND grant_row.grant_token_hash = decode(repeat('d1', 32), 'hex')
      AND grant_row.status = 'issued' AND grant_row.expires_at > now()
      AND command.id = grant_row.command_id
      AND command.account_id = 'mt5acct01'
      AND command.worker_id = 'migration-worker-0042'
      AND command.worker_session_generation = 7
      AND command.lease_generation = 1
      AND command.protocol_version = 1
      AND command.status IN ('dispatched', 'received')
      AND lease.account_id = command.account_id
      AND lease.worker_id = command.worker_id
      AND lease.worker_session_generation = command.worker_session_generation
      AND lease.generation = command.lease_generation
      AND lease.status = 'active' AND lease.expires_at > now()
      AND worker.worker_id = command.worker_id
      AND worker.session_generation = command.worker_session_generation
      AND worker.heartbeat_expires_at > now()
    RETURNING grant_row.user_id, grant_row.account_id
  )
  SELECT count(*) INTO first_consume_count FROM consumed;

  WITH consumed AS (
    UPDATE execution_mt5_vm_credential_grants grant_row
    SET status = 'consumed', consumed_at = now()
    FROM execution_mt5_vm_control_commands command,
         execution_mt5_vm_account_leases lease,
         execution_mt5_vm_workers worker
    WHERE grant_row.command_id = '42000000-0000-4000-8000-000000000020'
      AND grant_row.grant_token_hash = decode(repeat('d1', 32), 'hex')
      AND grant_row.status = 'issued' AND grant_row.expires_at > now()
      AND command.id = grant_row.command_id
      AND command.account_id = 'mt5acct01'
      AND command.worker_id = 'migration-worker-0042'
      AND command.worker_session_generation = 7
      AND command.lease_generation = 1
      AND command.protocol_version = 1
      AND command.status IN ('dispatched', 'received')
      AND lease.account_id = command.account_id
      AND lease.worker_id = command.worker_id
      AND lease.worker_session_generation = command.worker_session_generation
      AND lease.generation = command.lease_generation
      AND lease.status = 'active' AND lease.expires_at > now()
      AND worker.worker_id = command.worker_id
      AND worker.session_generation = command.worker_session_generation
      AND worker.heartbeat_expires_at > now()
    RETURNING grant_row.user_id, grant_row.account_id
  )
  SELECT count(*) INTO second_consume_count FROM consumed;

  IF first_consume_count <> 1 OR second_consume_count <> 0 THEN
    RAISE EXCEPTION 'credential grant replay gate failed: first %, second %',
      first_consume_count, second_consume_count;
  END IF;
END
$grant_0042$;

INSERT INTO execution_commands (
  id, user_id, source_account_id, idempotency_key, intent, status
)
VALUES (
  'migration-parent-0042',
  '42000000-0000-4000-8000-000000000001',
  'mt5acct01', 'migration-parent-0042', '{}', 'submitted'
);

INSERT INTO execution_target_commands (
  id, user_id, parent_command_id, target_account_id, idempotency_key,
  command_payload, status, reject_code, reject_message, attempt_count,
  next_attempt_at, first_delivered_at, terminal_ack_at, created_at
)
VALUES (
  'migration-target-unknown-0042',
  '42000000-0000-4000-8000-000000000001',
  'migration-parent-0042', 'mt5acct01', 'migration-target-unknown-0042',
  '{}', 'unknown', 'DELIVERY_OUTCOME_UNKNOWN',
  'synthetic delivery outcome requires reconciliation', 0,
  now() - interval '2 minutes', now() - interval '2 minutes', NULL,
  now() - interval '3 minutes'
);

DO $unknown_0042$
DECLARE
  expired_count integer;
  repolled_count integer;
BEGIN
  WITH expired AS (
    UPDATE execution_target_commands
    SET status = CASE WHEN first_delivered_at IS NULL THEN 'failed' ELSE 'unknown' END,
        reject_code = CASE
          WHEN first_delivered_at IS NULL THEN 'DELIVERY_UNAVAILABLE'
          ELSE 'DELIVERY_OUTCOME_UNKNOWN'
        END,
        terminal_ack_at = CASE WHEN first_delivered_at IS NULL THEN now() ELSE NULL END,
        lease_owner = NULL,
        lease_expires_at = NULL,
        updated_at = now()
    WHERE user_id = '42000000-0000-4000-8000-000000000001'
      AND target_account_id = 'mt5acct01'
      AND terminal_ack_at IS NULL
      AND status IN ('ready', 'queued', 'unknown')
      AND (
        first_delivered_at IS NULL OR
        reject_code IS DISTINCT FROM 'DELIVERY_OUTCOME_UNKNOWN'
      )
      AND COALESCE(first_delivered_at, next_attempt_at, created_at) <=
          now() - interval '30 seconds'
    RETURNING id
  )
  SELECT count(*) INTO expired_count FROM expired;

  WITH candidates AS (
    SELECT id
    FROM execution_target_commands
    WHERE user_id = '42000000-0000-4000-8000-000000000001'
      AND target_account_id = 'mt5acct01'
      AND terminal_ack_at IS NULL
      AND status IN ('ready', 'queued', 'unknown')
      AND COALESCE(first_delivered_at, next_attempt_at, created_at) >
          now() - interval '30 seconds'
      AND next_attempt_at <= now()
      AND (lease_expires_at IS NULL OR lease_expires_at <= now())
    ORDER BY created_at, id
    FOR UPDATE SKIP LOCKED
    LIMIT 16
  ), repolled AS (
    UPDATE execution_target_commands commands
    SET lease_owner = '42000000-0000-4000-8000-000000000010',
        lease_expires_at = now() + interval '15 seconds',
        first_delivered_at = COALESCE(first_delivered_at, now()),
        attempt_count = attempt_count + 1,
        updated_at = now()
    FROM candidates
    WHERE commands.id = candidates.id
    RETURNING commands.id
  )
  SELECT count(*) INTO repolled_count FROM repolled;

  IF expired_count <> 0 OR repolled_count <> 0 THEN
    RAISE EXCEPTION 'DELIVERY_OUTCOME_UNKNOWN was expired or re-polled: expired %, re-polled %',
      expired_count, repolled_count;
  END IF;
  IF (SELECT attempt_count FROM execution_target_commands
      WHERE id = 'migration-target-unknown-0042') <> 0 THEN
    RAISE EXCEPTION 'DELIVERY_OUTCOME_UNKNOWN attempt count changed';
  END IF;
END
$unknown_0042$;

INSERT INTO execution_pairing_tokens (
  user_id, token_hash, expires_at, managed_account_id, managed_worker_id,
  worker_session_generation, lease_generation, connection_revision,
  masked_login_suffix, identity_fingerprint
)
VALUES (
  '42000000-0000-4000-8000-000000000001',
  decode(repeat('e1', 32), 'hex'), now() + interval '10 minutes',
  'mt5acct01', 'migration-worker-0042', 7, 1,
  (SELECT connection_revision FROM execution_mt5_vm_accounts
   WHERE account_id = 'mt5acct01'),
  '1001', decode(repeat('a1', 32), 'hex')
);

INSERT INTO execution_mt5_vm_control_commands (
  id, message_id, user_id, account_id, worker_id,
  worker_session_generation, lease_generation, protocol_version,
  idempotency_key, command_kind, payload, status, expires_at
)
VALUES (
  '42000000-0000-4000-8000-000000000030',
  '42000000-0000-4000-8000-000000000031',
  '42000000-0000-4000-8000-000000000001',
  'mt5acct01', 'migration-worker-0042', 7, 1, 1,
  'migration-0042-disconnect-provision', 'provision_account', '{}',
  'queued', now() + interval '10 minutes'
);

INSERT INTO execution_mt5_vm_credential_grants (
  id, user_id, account_id, command_id, worker_id,
  worker_session_generation, lease_generation, grant_token_hash,
  status, expires_at
)
VALUES (
  '42000000-0000-4000-8000-000000000032',
  '42000000-0000-4000-8000-000000000001',
  'mt5acct01', '42000000-0000-4000-8000-000000000030',
  'migration-worker-0042', 7, 1, decode(repeat('e2', 32), 'hex'),
  'issued', now() + interval '5 minutes'
);

INSERT INTO execution_commands (
  id, user_id, source_account_id, idempotency_key, intent, status
)
VALUES
  ('migration-disconnect-parent-a',
   '42000000-0000-4000-8000-000000000001', 'mt5acct01',
   'migration-disconnect-parent-a', '{}', 'submitted'),
  ('migration-disconnect-parent-b',
   '42000000-0000-4000-8000-000000000001', 'mt5acct01',
   'migration-disconnect-parent-b', '{}', 'submitted');

INSERT INTO execution_target_commands (
  id, user_id, parent_command_id, target_account_id, idempotency_key,
  command_payload, status, reject_code, attempt_count, next_attempt_at,
  first_delivered_at, terminal_ack_at, created_at
)
VALUES
  ('migration-disconnect-not-delivered',
   '42000000-0000-4000-8000-000000000001',
   'migration-disconnect-parent-a', 'mt5acct01',
   'migration-disconnect-not-delivered', '{}', 'ready', NULL, 0,
   now(), NULL, NULL, now()),
  ('migration-disconnect-delivery-unknown',
   '42000000-0000-4000-8000-000000000001',
   'migration-disconnect-parent-b', 'mt5acct01',
   'migration-disconnect-delivery-unknown', '{}', 'queued', NULL, 1,
   now(), now(), NULL, now());

DO $disconnect_0042$
DECLARE
  revision_before bigint;
  first_result record;
  retry_result record;
BEGIN
  SELECT connection_revision INTO revision_before
  FROM execution_mt5_vm_accounts WHERE account_id = 'mt5acct01';

  SELECT * INTO first_result
  FROM execution_fence_mt5_managed_disconnect(
    '42000000-0000-4000-8000-000000000001', 'mt5acct01', revision_before
  );
  SELECT * INTO retry_result
  FROM execution_fence_mt5_managed_disconnect(
    '42000000-0000-4000-8000-000000000001', 'mt5acct01', revision_before
  );

  IF first_result.outcome <> 'ok' OR first_result.idempotent OR
     first_result.new_revision <> revision_before + 1 OR NOT first_result.stopping THEN
    RAISE EXCEPTION 'first managed disconnect did not fence exactly once';
  END IF;
  IF retry_result.outcome <> 'ok' OR NOT retry_result.idempotent OR
     retry_result.new_revision <> first_result.new_revision THEN
    RAISE EXCEPTION 'managed disconnect retry was not idempotent';
  END IF;
  IF (SELECT connection_revision FROM execution_mt5_vm_accounts
      WHERE account_id = 'mt5acct01') <> revision_before + 1 THEN
    RAISE EXCEPTION 'managed disconnect revision advanced more than once';
  END IF;
  IF (SELECT disconnect_requested_revision FROM execution_mt5_vm_accounts
      WHERE account_id = 'mt5acct01') <> revision_before THEN
    RAISE EXCEPTION 'managed disconnect request revision was not retained';
  END IF;
  IF (SELECT status <> 'offline' OR trade_allowed FROM execution_accounts
      WHERE user_id = '42000000-0000-4000-8000-000000000001'
        AND id = 'mt5acct01') THEN
    RAISE EXCEPTION 'managed disconnect did not publish offline fail-closed state';
  END IF;
  IF EXISTS (
    SELECT 1 FROM execution_ea_sessions
    WHERE account_id = 'mt5acct01' AND revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'managed disconnect left an EA session live';
  END IF;
  IF EXISTS (
    SELECT 1 FROM execution_pairing_tokens
    WHERE managed_account_id = 'mt5acct01' AND consumed_at IS NULL
  ) THEN
    RAISE EXCEPTION 'managed disconnect left a pairing bootstrap live';
  END IF;
  IF (SELECT status FROM execution_mt5_vm_credential_grants
      WHERE id = '42000000-0000-4000-8000-000000000032') <> 'revoked' THEN
    RAISE EXCEPTION 'managed disconnect left a credential grant live';
  END IF;
  IF (SELECT status FROM execution_mt5_vm_control_commands
      WHERE id = '42000000-0000-4000-8000-000000000030') <> 'fenced' THEN
    RAISE EXCEPTION 'managed disconnect left a provision command deliverable';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM execution_mt5_vm_control_commands
    WHERE account_id = 'mt5acct01' AND command_kind = 'stop_account'
      AND idempotency_key = 'stop:mt5acct01:1'
  ) THEN
    RAISE EXCEPTION 'managed disconnect did not preserve one graceful stop command';
  END IF;
  IF (SELECT status FROM execution_target_commands
      WHERE id = 'migration-disconnect-not-delivered') <> 'failed' OR
     (SELECT terminal_ack_at FROM execution_target_commands
      WHERE id = 'migration-disconnect-not-delivered') IS NULL THEN
    RAISE EXCEPTION 'managed disconnect did not terminally fence undelivered work';
  END IF;
  IF (SELECT status FROM execution_target_commands
      WHERE id = 'migration-disconnect-delivery-unknown') <> 'unknown' OR
     (SELECT reject_code FROM execution_target_commands
      WHERE id = 'migration-disconnect-delivery-unknown') <>
        'DELIVERY_OUTCOME_UNKNOWN' OR
     (SELECT terminal_ack_at FROM execution_target_commands
      WHERE id = 'migration-disconnect-delivery-unknown') IS NOT NULL THEN
    RAISE EXCEPTION 'managed disconnect invented an outcome for delivered work';
  END IF;
END
$disconnect_0042$;
