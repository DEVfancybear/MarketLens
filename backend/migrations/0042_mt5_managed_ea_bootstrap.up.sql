-- Bind a one-time EA pairing token to the exact managed account assignment that
-- issued it. This table still stores only a token hash and non-secret identity
-- constraints; raw broker credentials remain in Vault.

ALTER TABLE execution_mt5_vm_workers
  ADD COLUMN worker_substrate text NOT NULL DEFAULT 'windows_vm' CHECK (
    worker_substrate IN ('windows_vm', 'bare_metal')
  );

ALTER TABLE execution_mt5_vm_accounts
  ADD COLUMN identity_fingerprint bytea CHECK (
    identity_fingerprint IS NULL OR octet_length(identity_fingerprint) = 32
  ),
  ADD COLUMN pending_identity_fingerprint bytea CHECK (
    pending_identity_fingerprint IS NULL OR
    octet_length(pending_identity_fingerprint) = 32
  ),
  ADD COLUMN server_fingerprint bytea CHECK (
    server_fingerprint IS NULL OR octet_length(server_fingerprint) = 32
  ),
  ADD COLUMN pending_server_fingerprint bytea CHECK (
    pending_server_fingerprint IS NULL OR
    octet_length(pending_server_fingerprint) = 32
  );

ALTER TABLE execution_mt5_vm_accounts
  ADD COLUMN pending_reserved_at timestamptz,
  ADD COLUMN disconnect_requested_revision bigint CHECK (
    disconnect_requested_revision IS NULL OR disconnect_requested_revision > 0
  );
UPDATE execution_mt5_vm_accounts
SET pending_reserved_at = now() - interval '31 seconds'
WHERE pending_secret_ref IS NOT NULL;
ALTER TABLE execution_mt5_vm_accounts
  ADD CONSTRAINT execution_mt5_vm_accounts_pending_reservation_check CHECK (
    (pending_secret_ref IS NULL AND pending_reserved_at IS NULL) OR
    (pending_secret_ref IS NOT NULL AND pending_reserved_at IS NOT NULL)
  );

-- Revision 15 no longer persists the exact broker server. Existing managed
-- rows must be re-credentialed so the API can supply keyed identity hashes.
ALTER TABLE execution_mt5_vm_accounts
  DROP CONSTRAINT IF EXISTS execution_mt5_vm_accounts_normalized_server_check;
UPDATE execution_accounts
SET server = ''
WHERE connector_kind = 'windows_vm';
UPDATE execution_mt5_vm_accounts
SET normalized_server = '', connection_status = 'credentials_required';
ALTER TABLE execution_mt5_vm_accounts
  ADD CONSTRAINT execution_mt5_vm_accounts_normalized_server_redacted_check
  CHECK (normalized_server = '');

-- A one-to-four digit "suffix" can equal the complete broker login. Preserve
-- only an opaque mask for short logins and exactly four trailing digits for
-- longer logins.
ALTER TABLE execution_mt5_vm_accounts
  DROP CONSTRAINT IF EXISTS execution_mt5_vm_accounts_masked_login_suffix_check;
UPDATE execution_mt5_vm_accounts
SET masked_login_suffix = '****'
WHERE masked_login_suffix IS NOT NULL
  AND char_length(masked_login_suffix) < 4;
ALTER TABLE execution_mt5_vm_accounts
  ADD CONSTRAINT execution_mt5_vm_accounts_masked_login_suffix_check CHECK (
    masked_login_suffix IS NULL OR masked_login_suffix = '****' OR
    masked_login_suffix ~ '^[0-9]{4}$'
  );

ALTER TABLE execution_mt5_vm_account_state
  DROP CONSTRAINT IF EXISTS execution_mt5_vm_account_state_observed_server_check;
UPDATE execution_mt5_vm_account_state SET observed_server = '';
ALTER TABLE execution_mt5_vm_account_state
  ADD CONSTRAINT execution_mt5_vm_account_state_observed_server_redacted_check
  CHECK (observed_server = '');

CREATE UNIQUE INDEX execution_mt5_vm_accounts_active_identity_idx
  ON execution_mt5_vm_accounts (
    COALESCE(pending_identity_fingerprint, identity_fingerprint)
  )
  WHERE COALESCE(pending_identity_fingerprint, identity_fingerprint) IS NOT NULL
    AND connection_status NOT IN ('disconnected', 'credentials_required');

ALTER TABLE execution_ea_sessions
  ADD COLUMN managed_worker_id text,
  ADD COLUMN worker_session_generation bigint CHECK (
    worker_session_generation IS NULL OR worker_session_generation > 0
  ),
  ADD COLUMN lease_generation bigint CHECK (
    lease_generation IS NULL OR lease_generation > 0
  ),
  ADD COLUMN connection_revision bigint CHECK (
    connection_revision IS NULL OR connection_revision > 0
  ),
  ADD COLUMN managed_slot_id text CHECK (
    managed_slot_id IS NULL OR managed_slot_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$'
  ),
  ADD COLUMN managed_terminal_pid bigint CHECK (
    managed_terminal_pid IS NULL OR managed_terminal_pid BETWEEN 1 AND 4294967295
  ),
  ADD COLUMN managed_gateway_origin text CHECK (
    managed_gateway_origin IS NULL OR (
      char_length(managed_gateway_origin) BETWEEN 8 AND 2048 AND
      position('@' IN managed_gateway_origin) = 0 AND
      position('?' IN managed_gateway_origin) = 0 AND
      position('#' IN managed_gateway_origin) = 0 AND
      position(chr(92) IN managed_gateway_origin) = 0 AND
      (
        (
          managed_gateway_origin LIKE 'https://%' AND
          position('/' IN substring(managed_gateway_origin FROM 9)) = 0
        ) OR
        managed_gateway_origin ~ '^http://127[.]0[.]0[.]1(:[0-9]{1,5})?$' OR
        managed_gateway_origin ~ '^http://localhost(:[0-9]{1,5})?$' OR
        managed_gateway_origin = 'http://[::1]' OR
        (
          managed_gateway_origin LIKE 'http://[::1]:%' AND
          substring(managed_gateway_origin FROM 14) ~ '^[0-9]{1,5}$'
        )
      )
    )
  ),
  ADD CONSTRAINT execution_ea_sessions_managed_runtime_binding_check CHECK (
    (
      managed_worker_id IS NULL AND worker_session_generation IS NULL AND
      lease_generation IS NULL AND connection_revision IS NULL AND
      managed_slot_id IS NULL AND managed_terminal_pid IS NULL AND
      managed_gateway_origin IS NULL
    ) OR (
      managed_worker_id IS NOT NULL AND worker_session_generation IS NOT NULL AND
      lease_generation IS NOT NULL AND connection_revision IS NOT NULL AND
      managed_slot_id IS NOT NULL AND managed_terminal_pid IS NOT NULL AND
      managed_gateway_origin IS NOT NULL
    )
  );

-- Publish managed bare-metal readiness through one atomic database gate. EA
-- heartbeats only refresh registry telemetry; neither the registry nor the
-- managed account may say ready until the same current worker/lease/session
-- generation has a fresh EA poll and all four authoritative sync families.
CREATE FUNCTION execution_advance_mt5_managed_readiness(
  p_user_id uuid,
  p_account_id text,
  p_poll_freshness_ms bigint
) RETURNS boolean
LANGUAGE plpgsql
AS $managed_readiness$
DECLARE
  eligible boolean;
  next_revision bigint;
BEGIN
  IF p_poll_freshness_ms < 1000 OR p_poll_freshness_ms > 300000 THEN
    RAISE EXCEPTION 'managed EA poll freshness is outside the fail-closed range'
      USING ERRCODE = '22023';
  END IF;

  SELECT true INTO eligible
  FROM execution_mt5_vm_accounts account
  JOIN execution_accounts registry
    ON registry.user_id = account.user_id AND registry.id = account.account_id
  JOIN execution_mt5_vm_workers worker
    ON worker.worker_id = account.worker_id
  JOIN execution_mt5_vm_account_leases lease
    ON lease.account_id = account.account_id
  WHERE account.user_id = p_user_id
    AND account.account_id = p_account_id
    AND account.connection_status IN (
      'queued', 'provisioning', 'synchronizing', 'degraded', 'reconnecting', 'ready'
    )
    AND account.identity_fingerprint IS NOT NULL
    AND account.server_fingerprint IS NOT NULL
    AND account.disconnect_requested_revision IS NULL
    AND registry.connector_kind = 'windows_vm'
    AND registry.status <> 'disabled'
    AND registry.trade_allowed
    AND registry.last_seen_at > now() - interval '1 minute'
    AND worker.worker_substrate = 'bare_metal'
    AND worker.status = 'healthy' AND NOT worker.drain
    AND worker.heartbeat_expires_at > now()
    AND lease.user_id = account.user_id
    AND lease.worker_id = account.worker_id
    AND lease.worker_session_generation = worker.session_generation
    AND lease.generation = account.lease_generation
    AND lease.status = 'active' AND lease.expires_at > now()
    AND EXISTS (
      SELECT 1 FROM execution_ea_sessions session
      WHERE session.user_id = account.user_id
        AND session.account_id = account.account_id
        AND session.managed_worker_id = account.worker_id
        AND session.worker_session_generation = worker.session_generation
        AND session.lease_generation = account.lease_generation
        AND session.connection_revision = account.connection_revision
        AND session.managed_slot_id IS NOT NULL
        AND session.managed_terminal_pid IS NOT NULL
        AND session.managed_gateway_origin IS NOT NULL
        AND session.revoked_at IS NULL
        AND session.expires_at > now()
        AND session.absolute_expires_at > now()
        AND session.last_poll_at >
            now() - (p_poll_freshness_ms * interval '1 millisecond')
    )
    AND EXISTS (
      SELECT 1 FROM execution_mt5_vm_account_state state
      WHERE state.user_id = account.user_id
        AND state.account_id = account.account_id
        AND state.worker_id = account.worker_id
        AND state.lease_generation = account.lease_generation
        AND state.worker_session_generation = worker.session_generation
        AND state.trade_allowed
        AND state.observed_login_suffix IS NOT DISTINCT FROM account.masked_login_suffix
    )
    AND 4 = (
      SELECT count(*) FROM execution_mt5_vm_sync_state sync
      WHERE sync.user_id = account.user_id
        AND sync.account_id = account.account_id
        AND sync.last_result = 'complete'
        AND sync.worker_id = account.worker_id
        AND sync.lease_generation = account.lease_generation
        AND sync.worker_session_generation = worker.session_generation
        AND sync.family IN ('account', 'positions', 'pending_orders', 'instruments')
    )
  FOR UPDATE OF account, registry;

  IF NOT FOUND OR NOT eligible THEN
    RETURN false;
  END IF;

  UPDATE execution_accounts
  SET status = 'ready', updated_at = now()
  WHERE user_id = p_user_id AND id = p_account_id
    AND connector_kind = 'windows_vm' AND status <> 'disabled';

  UPDATE execution_mt5_vm_accounts
  SET connection_status = 'ready',
      connection_revision = connection_revision + 1,
      last_error_code = NULL,
      updated_at = now()
  WHERE user_id = p_user_id AND account_id = p_account_id
    AND connection_status <> 'ready'
  RETURNING connection_revision INTO next_revision;

  IF next_revision IS NOT NULL THEN
    UPDATE execution_ea_sessions session
    SET connection_revision = next_revision
    FROM execution_mt5_vm_accounts account
    JOIN execution_mt5_vm_workers worker
      ON worker.worker_id = account.worker_id
    WHERE account.user_id = p_user_id
      AND account.account_id = p_account_id
      AND session.user_id = account.user_id
      AND session.account_id = account.account_id
      AND session.managed_worker_id = account.worker_id
      AND session.worker_session_generation = worker.session_generation
      AND session.lease_generation = account.lease_generation
      AND session.connection_revision = next_revision - 1
      AND session.revoked_at IS NULL;
  END IF;

  RETURN true;
END
$managed_readiness$;

ALTER TABLE execution_pairing_tokens
  ADD COLUMN managed_account_id text,
  ADD COLUMN managed_worker_id text,
  ADD COLUMN worker_session_generation bigint CHECK (
    worker_session_generation IS NULL OR worker_session_generation > 0
  ),
  ADD COLUMN lease_generation bigint CHECK (
    lease_generation IS NULL OR lease_generation > 0
  ),
  ADD COLUMN connection_revision bigint CHECK (
    connection_revision IS NULL OR connection_revision > 0
  ),
  ADD COLUMN masked_login_suffix text CHECK (
    masked_login_suffix IS NULL OR masked_login_suffix = '****' OR
    masked_login_suffix ~ '^[0-9]{4}$'
  ),
  ADD COLUMN identity_fingerprint bytea CHECK (
    identity_fingerprint IS NULL OR octet_length(identity_fingerprint) = 32
  ),
  ADD COLUMN managed_slot_id text CHECK (
    managed_slot_id IS NULL OR managed_slot_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$'
  ),
  ADD COLUMN managed_terminal_pid bigint CHECK (
    managed_terminal_pid IS NULL OR managed_terminal_pid BETWEEN 1 AND 4294967295
  ),
  ADD COLUMN managed_gateway_origin text CHECK (
    managed_gateway_origin IS NULL OR (
      char_length(managed_gateway_origin) BETWEEN 8 AND 2048 AND
      position('@' IN managed_gateway_origin) = 0 AND
      position('?' IN managed_gateway_origin) = 0 AND
      position('#' IN managed_gateway_origin) = 0 AND
      position(chr(92) IN managed_gateway_origin) = 0 AND
      (
        (
          managed_gateway_origin LIKE 'https://%' AND
          position('/' IN substring(managed_gateway_origin FROM 9)) = 0
        ) OR
        managed_gateway_origin ~ '^http://127[.]0[.]0[.]1(:[0-9]{1,5})?$' OR
        managed_gateway_origin ~ '^http://localhost(:[0-9]{1,5})?$' OR
        managed_gateway_origin = 'http://[::1]' OR
        (
          managed_gateway_origin LIKE 'http://[::1]:%' AND
          substring(managed_gateway_origin FROM 14) ~ '^[0-9]{1,5}$'
        )
      )
    )
  ),
  ADD CONSTRAINT execution_pairing_tokens_managed_account_fk
    FOREIGN KEY (user_id, managed_account_id)
    REFERENCES execution_mt5_vm_accounts(user_id, account_id) ON DELETE CASCADE,
  ADD CONSTRAINT execution_pairing_tokens_managed_worker_fk
    FOREIGN KEY (managed_worker_id)
    REFERENCES execution_mt5_vm_workers(worker_id) ON DELETE CASCADE,
  ADD CONSTRAINT execution_pairing_tokens_managed_binding_check CHECK (
    (
      managed_account_id IS NULL AND managed_worker_id IS NULL AND
      worker_session_generation IS NULL AND lease_generation IS NULL AND
      connection_revision IS NULL AND
      masked_login_suffix IS NULL AND identity_fingerprint IS NULL AND
      managed_slot_id IS NULL AND managed_terminal_pid IS NULL AND
      managed_gateway_origin IS NULL
    ) OR (
      managed_account_id IS NOT NULL AND managed_worker_id IS NOT NULL AND
      worker_session_generation IS NOT NULL AND lease_generation IS NOT NULL AND
      connection_revision IS NOT NULL AND
      masked_login_suffix IS NOT NULL AND identity_fingerprint IS NOT NULL AND
      (
        (
          managed_slot_id IS NULL AND managed_terminal_pid IS NULL AND
          managed_gateway_origin IS NULL
        ) OR (
          managed_slot_id IS NOT NULL AND managed_terminal_pid IS NOT NULL AND
          managed_gateway_origin IS NOT NULL
        )
      )
    )
  );

CREATE UNIQUE INDEX execution_pairing_tokens_managed_assignment_active_idx
  ON execution_pairing_tokens (
    managed_account_id, managed_worker_id, worker_session_generation,
    lease_generation, connection_revision
  )
  WHERE managed_account_id IS NOT NULL AND consumed_at IS NULL;

CREATE FUNCTION execution_bind_mt5_managed_ea_bootstrap(
  p_token_hash bytea,
  p_worker_id text,
  p_worker_session_generation bigint,
  p_account_id text,
  p_lease_generation bigint,
  p_connection_revision bigint,
  p_slot_id text,
  p_terminal_pid bigint,
  p_gateway_origin text
) RETURNS TABLE (
  outcome text,
  idempotent boolean
)
LANGUAGE plpgsql
AS $managed_ea_bind$
DECLARE
  v_token_id uuid;
  v_slot_id text;
  v_terminal_pid bigint;
  v_gateway_origin text;
BEGIN
  IF octet_length(p_token_hash) <> 32 OR
     p_worker_session_generation <= 0 OR p_lease_generation <= 0 OR
     p_connection_revision <= 0 OR p_terminal_pid <= 0 OR
     p_terminal_pid > 4294967295 OR
     p_slot_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$' THEN
    RAISE EXCEPTION 'managed EA runtime binding is invalid' USING ERRCODE = '22023';
  END IF;

  SELECT token.id, token.managed_slot_id, token.managed_terminal_pid,
         token.managed_gateway_origin
  INTO v_token_id, v_slot_id, v_terminal_pid, v_gateway_origin
  FROM execution_pairing_tokens token
  JOIN execution_mt5_vm_accounts account
    ON account.user_id = token.user_id
   AND account.account_id = token.managed_account_id
  JOIN execution_mt5_vm_workers worker
    ON worker.worker_id = token.managed_worker_id
  JOIN execution_mt5_vm_account_leases lease
    ON lease.account_id = token.managed_account_id
  WHERE token.token_hash = p_token_hash
    AND token.consumed_at IS NULL AND token.expires_at > now()
    AND token.managed_worker_id = p_worker_id
    AND token.worker_session_generation = p_worker_session_generation
    AND token.managed_account_id = p_account_id
    AND token.lease_generation = p_lease_generation
    AND token.connection_revision = p_connection_revision
    AND account.worker_id = p_worker_id
    AND account.lease_generation = p_lease_generation
    AND account.connection_revision = p_connection_revision
    AND account.disconnect_requested_revision IS NULL
    AND worker.session_generation = p_worker_session_generation
    AND worker.worker_substrate = 'bare_metal'
    AND worker.status = 'healthy' AND NOT worker.drain
    AND worker.heartbeat_expires_at > now()
    AND lease.worker_id = p_worker_id
    AND lease.worker_session_generation = p_worker_session_generation
    AND lease.generation = p_lease_generation
    AND lease.status = 'active' AND lease.expires_at > now()
  FOR UPDATE OF token, account, worker, lease;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'fenced'::text, false;
    RETURN;
  END IF;

  IF v_slot_id IS NULL AND v_terminal_pid IS NULL AND v_gateway_origin IS NULL THEN
    UPDATE execution_pairing_tokens
    SET managed_slot_id = p_slot_id,
        managed_terminal_pid = p_terminal_pid,
        managed_gateway_origin = p_gateway_origin
    WHERE id = v_token_id;
    RETURN QUERY SELECT 'bound'::text, false;
    RETURN;
  END IF;

  IF v_slot_id = p_slot_id AND v_terminal_pid = p_terminal_pid AND
     v_gateway_origin = p_gateway_origin THEN
    RETURN QUERY SELECT 'bound'::text, true;
  ELSE
    RETURN QUERY SELECT 'fenced'::text, false;
  END IF;
END
$managed_ea_bind$;

CREATE FUNCTION execution_fence_mt5_managed_disconnect(
  p_user_id uuid,
  p_account_id text,
  p_expected_revision bigint
) RETURNS TABLE (
  outcome text,
  new_revision bigint,
  stopping boolean,
  idempotent boolean
)
LANGUAGE plpgsql
AS $managed_disconnect$
DECLARE
  v_current_revision bigint;
  v_disconnect_revision bigint;
  v_worker_id text;
  v_lease_generation bigint;
  v_first_request boolean;
BEGIN
  SELECT account.connection_revision,
         account.disconnect_requested_revision,
         account.worker_id,
         account.lease_generation
  INTO v_current_revision, v_disconnect_revision, v_worker_id, v_lease_generation
  FROM execution_mt5_vm_accounts account
  JOIN execution_accounts registry
    ON registry.user_id = account.user_id AND registry.id = account.account_id
  WHERE account.user_id = p_user_id
    AND account.account_id = p_account_id
    AND registry.connector_kind = 'windows_vm'
  FOR UPDATE OF account, registry;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::text, 0::bigint, false, false;
    RETURN;
  END IF;
  IF p_expected_revision <= 0 THEN
    RETURN QUERY SELECT 'conflict'::text, v_current_revision, false, false;
    RETURN;
  END IF;

  v_first_request := v_disconnect_revision IS NULL
    AND v_current_revision = p_expected_revision;
  IF NOT v_first_request AND NOT (
    v_disconnect_revision = p_expected_revision
    AND v_current_revision = p_expected_revision + 1
  ) THEN
    RETURN QUERY SELECT 'conflict'::text, v_current_revision, false, false;
    RETURN;
  END IF;

  stopping := v_worker_id IS NOT NULL;
  IF stopping THEN
    INSERT INTO execution_mt5_vm_control_commands (
      user_id, account_id, worker_id, worker_session_generation,
      lease_generation, protocol_version, idempotency_key,
      command_kind, payload, expires_at
    )
    SELECT p_user_id, p_account_id, lease.worker_id,
           lease.worker_session_generation, lease.generation,
           worker.protocol_version,
           'stop:' || p_account_id || ':' || v_lease_generation::text,
           'stop_account', '{}'::jsonb, now() + interval '5 minutes'
    FROM execution_mt5_vm_account_leases lease
    JOIN execution_mt5_vm_workers worker ON worker.worker_id = lease.worker_id
    WHERE lease.user_id = p_user_id AND lease.account_id = p_account_id
      AND lease.generation = v_lease_generation
      AND lease.status = 'active' AND lease.expires_at > now()
      AND worker.session_generation = lease.worker_session_generation
      AND worker.heartbeat_expires_at > now()
    ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;

  UPDATE execution_ea_sessions
  SET revoked_at = COALESCE(revoked_at, now())
  WHERE user_id = p_user_id AND account_id = p_account_id;

  UPDATE execution_pairing_tokens
  SET consumed_at = COALESCE(consumed_at, now())
  WHERE user_id = p_user_id AND managed_account_id = p_account_id;

  UPDATE execution_mt5_vm_credential_grants
  SET status = 'revoked'
  WHERE user_id = p_user_id AND account_id = p_account_id
    AND status = 'issued';

  UPDATE execution_mt5_vm_control_commands
  SET status = 'fenced', completed_at = now(), dispatch_lease_until = NULL,
      error_code = 'ACCOUNT_DISCONNECTED'
  WHERE user_id = p_user_id AND account_id = p_account_id
    AND command_kind <> 'stop_account'
    AND status IN ('queued', 'dispatched', 'received');

  WITH fenced AS (
    UPDATE execution_target_commands
    SET status = CASE
          WHEN first_delivered_at IS NULL THEN 'failed'
          ELSE 'unknown'
        END,
        reject_code = CASE
          WHEN first_delivered_at IS NULL THEN 'ACCOUNT_DISCONNECTED'
          ELSE 'DELIVERY_OUTCOME_UNKNOWN'
        END,
        reject_message = CASE
          WHEN first_delivered_at IS NULL
            THEN 'account was disconnected before execution'
          ELSE 'delivery outcome is unknown after account disconnect'
        END,
        terminal_ack_at = CASE
          WHEN first_delivered_at IS NULL THEN COALESCE(terminal_ack_at, now())
          ELSE NULL
        END,
        lease_owner = NULL,
        lease_expires_at = NULL,
        updated_at = now()
    WHERE user_id = p_user_id
      AND target_account_id = p_account_id
      AND terminal_ack_at IS NULL
      AND status IN ('waiting', 'ready', 'queued', 'unknown')
    RETURNING parent_command_id
  ), affected_parents AS (
    SELECT DISTINCT parent_command_id FROM fenced
  )
  UPDATE execution_commands parent
  SET status = CASE
        WHEN EXISTS (
          SELECT 1 FROM execution_target_commands target
          WHERE target.user_id = parent.user_id
            AND target.parent_command_id = parent.id
            AND target.terminal_ack_at IS NULL
        ) THEN 'submitted'
        ELSE 'partially_rejected'
      END,
      updated_at = now()
  FROM affected_parents
  WHERE parent.user_id = p_user_id
    AND parent.id = affected_parents.parent_command_id;

  UPDATE execution_accounts
  SET status = 'offline', trade_allowed = false, updated_at = now()
  WHERE user_id = p_user_id AND id = p_account_id
    AND connector_kind = 'windows_vm';

  UPDATE execution_mt5_vm_accounts
  SET connection_status = CASE WHEN stopping THEN 'degraded' ELSE 'disconnected' END,
      connection_revision = CASE
        WHEN v_first_request THEN v_current_revision + 1
        ELSE v_current_revision
      END,
      disconnect_requested_revision = COALESCE(
        disconnect_requested_revision, p_expected_revision
      ),
      worker_id = CASE WHEN stopping THEN worker_id ELSE NULL END,
      last_error_code = NULL,
      updated_at = now()
  WHERE user_id = p_user_id AND account_id = p_account_id;

  RETURN QUERY SELECT
    'ok'::text,
    CASE WHEN v_first_request THEN v_current_revision + 1 ELSE v_current_revision END,
    stopping,
    NOT v_first_request;
END
$managed_disconnect$;
