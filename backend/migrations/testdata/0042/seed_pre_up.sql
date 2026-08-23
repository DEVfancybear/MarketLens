BEGIN;

INSERT INTO users (id, email, email_verified, display_name)
VALUES
  ('42000000-0000-4000-8000-000000000001', 'migration-0042-owner-a@example.invalid', true, 'Migration Owner A'),
  ('42000000-0000-4000-8000-000000000002', 'migration-0042-owner-b@example.invalid', true, 'Migration Owner B');

INSERT INTO execution_accounts (
  id, user_id, venue_kind, broker_code, external_account_ref, server,
  label, mode, status, secret_ref, connector_kind, last_seen_at
)
VALUES
  (
    'mt5acct01', '42000000-0000-4000-8000-000000000001', 'metatrader5',
    'synthetic-broker', 'synthetic-demo-a', 'broker-a.example',
    'Disposable MT5 A', 'demo', 'ready', 'mt5-11111111111111111111111111111111',
    'windows_vm', now()
  ),
  (
    'mt5acct02', '42000000-0000-4000-8000-000000000002', 'metatrader5',
    'synthetic-broker', 'synthetic-demo-b', 'broker-b.example',
    'Disposable MT5 B', 'demo', 'ready', 'mt5-22222222222222222222222222222222',
    'windows_vm', now()
  );

INSERT INTO execution_mt5_vm_workers (
  worker_id, protocol_version, session_generation, session_token_hash,
  agent_version, image_version, runtime_version, capacity, region,
  status, drain, last_heartbeat_at, heartbeat_expires_at
)
VALUES (
  'migration-worker-0042', 1, 7, decode(repeat('42', 32), 'hex'),
  'test-agent', 'test-image', 'test-runtime', 2, 'loopback-test',
  'healthy', false, now(), now() + interval '30 minutes'
);

INSERT INTO execution_mt5_vm_accounts (
  user_id, account_id, normalized_server, masked_login_suffix,
  persistence_mode, connection_status, connection_revision,
  worker_id, lease_generation, required_protocol_version,
  required_runtime_version, agent_version, runtime_version,
  terminal_version, last_heartbeat_at
)
VALUES
  (
    '42000000-0000-4000-8000-000000000001', 'mt5acct01',
    'broker-a.example', '1001', 'managed', 'ready', 3,
    'migration-worker-0042', 1, 1, 'test-runtime', 'test-agent',
    'test-runtime', 'synthetic-terminal', now()
  ),
  (
    '42000000-0000-4000-8000-000000000002', 'mt5acct02',
    'broker-b.example', '2002', 'managed', 'ready', 5,
    'migration-worker-0042', 2, 1, 'test-runtime', 'test-agent',
    'test-runtime', 'synthetic-terminal', now()
  );

INSERT INTO execution_mt5_vm_account_state (
  user_id, account_id, currency, leverage, balance, equity, margin,
  free_margin, margin_level, margin_mode, account_mode, trade_allowed,
  observed_server, observed_login_suffix, worker_id, lease_generation,
  worker_session_generation, sync_sequence, observed_at
)
VALUES
  (
    '42000000-0000-4000-8000-000000000001', 'mt5acct01', 'USD', 100,
    10000, 10000, 0, 10000, NULL, 'hedging', 'demo', true,
    'broker-a.example', '1001', 'migration-worker-0042', 1, 7, 1, now()
  ),
  (
    '42000000-0000-4000-8000-000000000002', 'mt5acct02', 'USD', 100,
    10000, 10000, 0, 10000, NULL, 'hedging', 'demo', true,
    'broker-b.example', '2002', 'migration-worker-0042', 2, 7, 1, now()
  );

INSERT INTO execution_pairing_tokens (user_id, token_hash, expires_at)
VALUES (
  '42000000-0000-4000-8000-000000000001',
  decode(repeat('24', 32), 'hex'),
  now() + interval '30 minutes'
);

COMMIT;
