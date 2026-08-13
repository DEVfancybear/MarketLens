-- Durable, private control plane for the MarketLens-managed MT5 Windows VM pool.
-- This phase stores no raw MT5 login, password, worker session token, or vault payload.

ALTER TABLE execution_accounts
  ADD COLUMN connector_kind text NOT NULL DEFAULT 'ea' CHECK (
    connector_kind IN ('ea', 'windows_vm')
  );

CREATE TABLE execution_mt5_vm_workers (
  worker_id                text PRIMARY KEY CHECK (
                             worker_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$'
                           ),
  protocol_version         integer NOT NULL CHECK (protocol_version > 0),
  session_generation       bigint NOT NULL CHECK (session_generation > 0),
  session_token_hash       bytea NOT NULL UNIQUE CHECK (
                             octet_length(session_token_hash) = 32
                           ),
  agent_version            text NOT NULL CHECK (
                             char_length(agent_version) BETWEEN 1 AND 64
                           ),
  image_version            text NOT NULL CHECK (
                             char_length(image_version) BETWEEN 1 AND 64
                           ),
  runtime_version          text NOT NULL CHECK (
                             char_length(runtime_version) BETWEEN 1 AND 64
                           ),
  capacity                 integer NOT NULL CHECK (capacity BETWEEN 1 AND 4),
  region                   text NOT NULL CHECK (char_length(region) BETWEEN 1 AND 64),
  capabilities             jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
                             jsonb_typeof(capabilities) = 'object'
                           ),
  status                   text NOT NULL DEFAULT 'healthy' CHECK (
                             status IN ('healthy', 'draining', 'offline')
                           ),
  drain                    boolean NOT NULL DEFAULT false,
  last_heartbeat_at        timestamptz NOT NULL,
  heartbeat_expires_at     timestamptz NOT NULL,
  last_assigned_at         timestamptz,
  registered_at            timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CHECK (heartbeat_expires_at > last_heartbeat_at)
);
CREATE INDEX execution_mt5_vm_workers_placement_idx
  ON execution_mt5_vm_workers (
    status, drain, protocol_version, runtime_version,
    heartbeat_expires_at, last_assigned_at, worker_id
  );

CREATE TABLE execution_mt5_vm_accounts (
  user_id                     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id                  text PRIMARY KEY,
  normalized_server           text NOT NULL CHECK (
                                char_length(normalized_server) BETWEEN 1 AND 128
                              ),
  masked_login_suffix         text CHECK (
                                masked_login_suffix IS NULL OR
                                masked_login_suffix ~ '^[0-9]{1,4}$'
                              ),
  persistence_mode            text NOT NULL CHECK (
                                persistence_mode IN ('session', 'managed')
                              ),
  connection_status           text NOT NULL DEFAULT 'queued' CHECK (
                                connection_status IN (
                                  'queued', 'provisioning', 'synchronizing', 'ready',
                                  'degraded', 'reconnecting', 'credentials_required',
                                  'unsupported', 'blocked', 'disconnected'
                                )
                              ),
  connection_revision         bigint NOT NULL DEFAULT 1 CHECK (connection_revision > 0),
  worker_id                   text REFERENCES execution_mt5_vm_workers(worker_id)
                                ON DELETE SET NULL,
  lease_generation            bigint NOT NULL DEFAULT 0 CHECK (lease_generation >= 0),
  required_protocol_version   integer NOT NULL DEFAULT 1 CHECK (
                                required_protocol_version > 0
                              ),
  required_runtime_version    text CHECK (
                                required_runtime_version IS NULL OR
                                char_length(required_runtime_version) BETWEEN 1 AND 64
                              ),
  agent_version               text,
  runtime_version             text,
  terminal_version            text,
  last_heartbeat_at           timestamptz,
  last_account_sync_at        timestamptz,
  last_portfolio_sync_at      timestamptz,
  last_instrument_sync_at     timestamptz,
  last_error_code             text CHECK (
                                last_error_code IS NULL OR
                                last_error_code ~ '^[A-Z][A-Z0-9_]{0,63}$'
                              ),
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, account_id),
  FOREIGN KEY (user_id, account_id)
    REFERENCES execution_accounts(user_id, id) ON DELETE CASCADE,
  CHECK (worker_id IS NULL OR lease_generation > 0)
);
CREATE INDEX execution_mt5_vm_accounts_schedule_idx
  ON execution_mt5_vm_accounts (
    connection_status, required_protocol_version,
    required_runtime_version, updated_at, account_id
  ) WHERE connection_status IN ('queued', 'reconnecting');
CREATE INDEX execution_mt5_vm_accounts_worker_idx
  ON execution_mt5_vm_accounts (worker_id, connection_status, updated_at)
  WHERE worker_id IS NOT NULL;

CREATE TABLE execution_mt5_vm_account_leases (
  user_id                    uuid NOT NULL,
  account_id                 text PRIMARY KEY,
  worker_id                  text NOT NULL REFERENCES execution_mt5_vm_workers(worker_id)
                               ON DELETE RESTRICT,
  worker_session_generation  bigint NOT NULL CHECK (worker_session_generation > 0),
  generation                 bigint NOT NULL CHECK (generation > 0),
  status                     text NOT NULL CHECK (
                               status IN ('active', 'released', 'expired')
                             ),
  expires_at                 timestamptz NOT NULL,
  acquired_at                timestamptz NOT NULL DEFAULT now(),
  renewed_at                 timestamptz NOT NULL DEFAULT now(),
  released_at                timestamptz,
  release_reason             text CHECK (
                               release_reason IS NULL OR
                               release_reason ~ '^[A-Z][A-Z0-9_]{0,63}$'
                             ),
  UNIQUE (account_id, generation),
  FOREIGN KEY (user_id, account_id)
    REFERENCES execution_mt5_vm_accounts(user_id, account_id) ON DELETE CASCADE,
  CHECK (
    (status = 'active' AND released_at IS NULL AND release_reason IS NULL) OR
    (status IN ('released', 'expired') AND released_at IS NOT NULL AND release_reason IS NOT NULL)
  )
);
CREATE INDEX execution_mt5_vm_leases_worker_active_idx
  ON execution_mt5_vm_account_leases (worker_id, expires_at, account_id)
  WHERE status = 'active';
CREATE INDEX execution_mt5_vm_leases_expiry_idx
  ON execution_mt5_vm_account_leases (expires_at, account_id)
  WHERE status = 'active';

CREATE TABLE execution_mt5_vm_control_commands (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id                 uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  user_id                    uuid NOT NULL,
  account_id                 text NOT NULL,
  worker_id                  text NOT NULL REFERENCES execution_mt5_vm_workers(worker_id)
                               ON DELETE RESTRICT,
  worker_session_generation  bigint NOT NULL CHECK (worker_session_generation > 0),
  lease_generation           bigint NOT NULL CHECK (lease_generation > 0),
  protocol_version           integer NOT NULL CHECK (protocol_version > 0),
  idempotency_key            text NOT NULL UNIQUE CHECK (
                               char_length(idempotency_key) BETWEEN 1 AND 192
                             ),
  command_kind               text NOT NULL CHECK (
                               command_kind IN (
                                 'provision_account', 'stop_account', 'reconcile_account'
                               )
                             ),
  payload                    jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
                               jsonb_typeof(payload) = 'object'
                             ),
  status                     text NOT NULL DEFAULT 'queued' CHECK (
                               status IN (
                                 'queued', 'dispatched', 'received', 'succeeded',
                                 'failed', 'expired', 'fenced'
                               )
                             ),
  attempt_count              integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at               timestamptz NOT NULL DEFAULT now(),
  expires_at                 timestamptz NOT NULL,
  dispatch_lease_until       timestamptz,
  dispatched_at              timestamptz,
  received_at                timestamptz,
  completed_at               timestamptz,
  result                     jsonb CHECK (result IS NULL OR jsonb_typeof(result) = 'object'),
  error_code                 text CHECK (
                               error_code IS NULL OR error_code ~ '^[A-Z][A-Z0-9_]{0,63}$'
                             ),
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (user_id, account_id)
    REFERENCES execution_mt5_vm_accounts(user_id, account_id) ON DELETE CASCADE,
  CHECK (expires_at > created_at),
  CHECK (
    (status IN ('queued', 'dispatched', 'received') AND completed_at IS NULL) OR
    (status IN ('succeeded', 'failed', 'expired', 'fenced') AND completed_at IS NOT NULL)
  ),
  CHECK (status <> 'failed' OR error_code IS NOT NULL)
);
CREATE INDEX execution_mt5_vm_commands_poll_idx
  ON execution_mt5_vm_control_commands (
    worker_id, status, available_at, dispatch_lease_until, created_at, id
  ) WHERE status IN ('queued', 'dispatched');
CREATE INDEX execution_mt5_vm_commands_account_idx
  ON execution_mt5_vm_control_commands (
    user_id, account_id, lease_generation, created_at DESC
  );

CREATE TRIGGER trg_execution_mt5_vm_workers_set_updated_at
  BEFORE UPDATE ON execution_mt5_vm_workers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_execution_mt5_vm_accounts_set_updated_at
  BEFORE UPDATE ON execution_mt5_vm_accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_execution_mt5_vm_commands_set_updated_at
  BEFORE UPDATE ON execution_mt5_vm_control_commands
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE execution_mt5_vm_workers IS
  'Private worker registry with hashed, generation-fenced control sessions.';
COMMENT ON TABLE execution_mt5_vm_account_leases IS
  'Monotonic account placement lease; stale worker generations cannot act.';
COMMENT ON TABLE execution_mt5_vm_control_commands IS
  'Durable non-trading lifecycle commands and idempotent worker acknowledgements.';
