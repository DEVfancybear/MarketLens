-- Broker-neutral execution registry and durable command ledger.
-- Raw broker/API credentials and raw pairing tokens are never stored here.

CREATE TABLE execution_accounts (
  id                    text PRIMARY KEY CHECK (
                            id ~ '^[a-z0-9][a-z0-9_-]{7,95}$'
                          ),
  user_id               uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  venue_kind            text NOT NULL CHECK (venue_kind IN (
                            'metatrader5', 'binance_spot', 'binance_usdm'
                          )),
  broker_code           text NOT NULL,
  external_account_ref  text NOT NULL,
  server                text NOT NULL DEFAULT '',
  label                 text NOT NULL,
  mode                  text NOT NULL CHECK (mode IN ('demo', 'live', 'unknown')),
  status                text NOT NULL DEFAULT 'offline' CHECK (status IN (
                            'disabled', 'offline', 'connecting', 'ready',
                            'degraded', 'blocked'
                          )),
  currency              text NOT NULL DEFAULT '',
  balance               numeric,
  equity                numeric,
  trade_allowed         boolean NOT NULL DEFAULT false,
  capabilities          jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata              jsonb NOT NULL DEFAULT '{}'::jsonb,
  secret_ref            text,
  last_seen_at          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, id)
);

CREATE UNIQUE INDEX execution_accounts_identity_unique
  ON execution_accounts (
    user_id, venue_kind, lower(broker_code), external_account_ref, lower(server)
  );
CREATE INDEX execution_accounts_user_status_idx
  ON execution_accounts (user_id, status, updated_at DESC);

CREATE TABLE execution_copy_groups (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name               text NOT NULL,
  source_account_id  text NOT NULL,
  enabled            boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name),
  UNIQUE (user_id, id),
  FOREIGN KEY (user_id, source_account_id)
    REFERENCES execution_accounts(user_id, id) ON DELETE CASCADE
);

CREATE TABLE execution_copy_targets (
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id          uuid NOT NULL,
  account_id        text NOT NULL,
  enabled           boolean NOT NULL DEFAULT true,
  allocation_mode   text NOT NULL CHECK (allocation_mode IN (
                        'same_quantity', 'multiplier',
                        'equity_proportional', 'risk_percent'
                      )),
  multiplier        numeric NOT NULL DEFAULT 1 CHECK (multiplier > 0),
  risk_basis_points integer CHECK (
                        risk_basis_points IS NULL OR
                        risk_basis_points BETWEEN 1 AND 10000
                      ),
  max_quantity      numeric CHECK (max_quantity IS NULL OR max_quantity > 0),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, account_id),
  FOREIGN KEY (user_id, group_id)
    REFERENCES execution_copy_groups(user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, account_id)
    REFERENCES execution_accounts(user_id, id) ON DELETE CASCADE
);

CREATE TABLE execution_commands (
  id                 text NOT NULL CHECK (
                       id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
                     ),
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_account_id  text,
  idempotency_key    text NOT NULL,
  intent             jsonb NOT NULL,
  status             text NOT NULL CHECK (status IN (
                         'received', 'routing', 'routed', 'partially_rejected',
                         'submitted', 'completed', 'failed'
                       )),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id),
  UNIQUE (user_id, idempotency_key),
  FOREIGN KEY (user_id, source_account_id)
    REFERENCES execution_accounts(user_id, id) ON DELETE RESTRICT
);
CREATE INDEX execution_commands_user_created_idx
  ON execution_commands (user_id, created_at DESC);

CREATE TABLE execution_target_commands (
  id                  text NOT NULL CHECK (
                        id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
                      ),
  user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_command_id   text NOT NULL,
  target_account_id   text NOT NULL,
  idempotency_key     text NOT NULL,
  command_payload     jsonb NOT NULL,
  status              text NOT NULL CHECK (status IN (
                          'ready', 'rejected', 'queued', 'submitted',
                          'accepted', 'partially_filled', 'filled',
                          'cancelled', 'failed', 'unknown'
                        )),
  reject_code         text,
  reject_message      text,
  venue_request_id    text,
  broker_order_id     text,
  broker_deal_id      text,
  attempt_count       integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at     timestamptz NOT NULL DEFAULT now(),
  lease_owner         uuid,
  lease_expires_at    timestamptz,
  first_delivered_at  timestamptz,
  terminal_ack_at     timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id),
  UNIQUE (user_id, parent_command_id, target_account_id),
  UNIQUE (user_id, idempotency_key),
  FOREIGN KEY (user_id, parent_command_id)
    REFERENCES execution_commands(user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, target_account_id)
    REFERENCES execution_accounts(user_id, id) ON DELETE RESTRICT,
  CHECK (
    (lease_owner IS NULL AND lease_expires_at IS NULL) OR
    (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
  )
);
CREATE INDEX execution_target_commands_account_status_idx
  ON execution_target_commands (
    user_id, target_account_id, status, next_attempt_at, updated_at DESC
  );

CREATE TABLE execution_events (
  id                 bigserial PRIMARY KEY,
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id         text,
  target_command_id  text,
  external_event_id  text,
  event_type         text NOT NULL,
  payload            jsonb NOT NULL,
  occurred_at        timestamptz NOT NULL,
  received_at        timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (user_id, account_id)
    REFERENCES execution_accounts(user_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id, target_command_id)
    REFERENCES execution_target_commands(user_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX execution_events_external_unique
  ON execution_events (account_id, external_event_id)
  WHERE external_event_id IS NOT NULL;
CREATE INDEX execution_events_user_received_idx
  ON execution_events (user_id, received_at DESC);

CREATE TABLE execution_pairing_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  bytea NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);
CREATE INDEX execution_pairing_tokens_expiry_idx
  ON execution_pairing_tokens (expires_at)
  WHERE consumed_at IS NULL;

CREATE TABLE execution_ea_sessions (
  id            uuid PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id    text NOT NULL,
  agent_id      text NOT NULL,
  token_hash    bytea NOT NULL UNIQUE,
  expires_at    timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  revoked_at    timestamptz,
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (user_id, account_id)
    REFERENCES execution_accounts(user_id, id) ON DELETE CASCADE,
  CHECK (expires_at <= absolute_expires_at)
);
CREATE INDEX execution_ea_sessions_active_idx
  ON execution_ea_sessions (user_id, account_id, expires_at DESC)
  WHERE revoked_at IS NULL;

CREATE TABLE execution_instruments (
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id    text NOT NULL,
  venue_symbol  text NOT NULL,
  snapshot      jsonb NOT NULL,
  bid           numeric,
  ask           numeric,
  observed_at   timestamptz NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, account_id, venue_symbol),
  FOREIGN KEY (user_id, account_id)
    REFERENCES execution_accounts(user_id, id) ON DELETE CASCADE,
  CHECK (bid IS NULL OR bid >= 0),
  CHECK (ask IS NULL OR ask >= 0)
);
CREATE INDEX execution_instruments_freshness_idx
  ON execution_instruments (user_id, account_id, observed_at DESC);

CREATE TABLE execution_positions (
  user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id          text NOT NULL,
  broker_position_id  text NOT NULL,
  snapshot             jsonb NOT NULL,
  observed_at          timestamptz NOT NULL,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, account_id, broker_position_id),
  FOREIGN KEY (user_id, account_id)
    REFERENCES execution_accounts(user_id, id) ON DELETE CASCADE
);
CREATE INDEX execution_positions_account_idx
  ON execution_positions (user_id, account_id, updated_at DESC);

CREATE TABLE execution_pending_orders (
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id       text NOT NULL,
  broker_order_id  text NOT NULL,
  snapshot          jsonb NOT NULL,
  observed_at       timestamptz NOT NULL,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, account_id, broker_order_id),
  FOREIGN KEY (user_id, account_id)
    REFERENCES execution_accounts(user_id, id) ON DELETE CASCADE
);
CREATE INDEX execution_pending_orders_account_idx
  ON execution_pending_orders (user_id, account_id, updated_at DESC);

CREATE TABLE execution_symbol_mappings (
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id       text NOT NULL,
  canonical_symbol text NOT NULL,
  venue_symbol     text NOT NULL,
  mapping_source   text NOT NULL CHECK (
                     mapping_source IN ('exact', 'user', 'broker_adapter')
                   ),
  enabled          boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, account_id, canonical_symbol),
  FOREIGN KEY (user_id, account_id)
    REFERENCES execution_accounts(user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, account_id, venue_symbol)
    REFERENCES execution_instruments(user_id, account_id, venue_symbol)
    ON DELETE CASCADE
);

CREATE TABLE execution_risk_policies (
  user_id                         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id                      text NOT NULL,
  max_risk_per_trade_basis_points integer NOT NULL DEFAULT 100 CHECK (
                                      max_risk_per_trade_basis_points
                                      BETWEEN 1 AND 10000
                                    ),
  max_order_quantity              numeric CHECK (
                                      max_order_quantity IS NULL OR
                                      max_order_quantity > 0
                                    ),
  require_stop_loss               boolean NOT NULL DEFAULT true,
  allowed_symbols                 text[] NOT NULL DEFAULT '{}',
  blocked_symbols                 text[] NOT NULL DEFAULT '{}',
  updated_at                      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, account_id),
  FOREIGN KEY (user_id, account_id)
    REFERENCES execution_accounts(user_id, id) ON DELETE CASCADE
);

-- Append-only security and execution audit trail. The application role gets no
-- UPDATE/DELETE path in code; a trigger also prevents accidental mutation.
CREATE TABLE execution_audit_log (
  sequence       bigserial PRIMARY KEY,
  user_id        uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_type     text NOT NULL CHECK (actor_type IN ('user', 'service', 'ea')),
  actor_id       text NOT NULL,
  action         text NOT NULL,
  resource_type  text NOT NULL,
  resource_id    text,
  request_id     text,
  source_ip      inet,
  details        jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX execution_audit_log_user_time_idx
  ON execution_audit_log (user_id, occurred_at DESC);

CREATE FUNCTION prevent_execution_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'execution audit log is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_execution_audit_no_update
  BEFORE UPDATE OR DELETE ON execution_audit_log
  FOR EACH ROW EXECUTE FUNCTION prevent_execution_audit_mutation();
