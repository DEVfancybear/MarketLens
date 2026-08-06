-- Durable, owner-scoped continuous trade copier control and lifecycle ledger.
-- The pipeline is inbox -> leased work item -> transactional command outbox.
-- All broker identifiers remain account-scoped and all processing is idempotent.

ALTER TABLE execution_copy_groups
  ALTER COLUMN enabled SET DEFAULT false,
  ADD COLUMN revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  ADD COLUMN applied_revision bigint NOT NULL DEFAULT 0 CHECK (applied_revision >= 0),
  ADD COLUMN runtime_status text NOT NULL DEFAULT 'inactive' CHECK (
    runtime_status IN ('inactive', 'starting', 'active', 'paused', 'degraded', 'error')
  ),
  ADD COLUMN configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN status_message text,
  ADD COLUMN last_event_at timestamptz,
  ADD COLUMN last_reconciled_at timestamptz,
  ADD CONSTRAINT execution_copy_groups_revision_check
    CHECK (applied_revision <= revision),
  ADD CONSTRAINT execution_copy_groups_configuration_check
    CHECK (jsonb_typeof(configuration) = 'object');

ALTER TABLE execution_copy_targets
  DROP CONSTRAINT execution_copy_targets_allocation_mode_check;

ALTER TABLE execution_copy_targets
  ADD CONSTRAINT execution_copy_targets_allocation_mode_check CHECK (
    allocation_mode IN (
      'same_quantity', 'fixed_quantity', 'multiplier',
      'equity_proportional', 'risk_percent'
    )
  ),
  ALTER COLUMN enabled SET DEFAULT false,
  ADD COLUMN fixed_quantity numeric CHECK (
    fixed_quantity IS NULL OR fixed_quantity > 0
  ),
  ADD COLUMN allocation_unit text NOT NULL DEFAULT 'lots' CHECK (
    allocation_unit IN ('lots', 'base_units', 'contracts', 'quote_notional')
  ),
  ADD COLUMN revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  ADD COLUMN applied_revision bigint NOT NULL DEFAULT 0 CHECK (applied_revision >= 0),
  ADD COLUMN runtime_status text NOT NULL DEFAULT 'inactive' CHECK (
    runtime_status IN (
      'inactive', 'connecting', 'active', 'waiting', 'degraded', 'error'
    )
  ),
  ADD COLUMN configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN symbol_mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN status_message text,
  ADD COLUMN last_error_at timestamptz,
  ADD COLUMN last_reconciled_at timestamptz,
  ADD CONSTRAINT execution_copy_targets_revision_check
    CHECK (applied_revision <= revision),
  ADD CONSTRAINT execution_copy_targets_configuration_check
    CHECK (jsonb_typeof(configuration) = 'object'),
  ADD CONSTRAINT execution_copy_targets_symbol_mapping_check
    CHECK (jsonb_typeof(symbol_mapping) = 'object'),
  ADD CONSTRAINT execution_copy_targets_fixed_quantity_check
    CHECK (
      (allocation_mode = 'fixed_quantity' AND fixed_quantity IS NOT NULL) OR
      (allocation_mode <> 'fixed_quantity' AND fixed_quantity IS NULL)
    ),
  ADD CONSTRAINT execution_copy_targets_owner_key
    UNIQUE (user_id, group_id, account_id);

CREATE INDEX execution_copy_groups_runtime_idx
  ON execution_copy_groups (user_id, runtime_status, updated_at DESC);
CREATE INDEX execution_copy_targets_runtime_idx
  ON execution_copy_targets (user_id, group_id, runtime_status, updated_at DESC);

CREATE TABLE execution_copy_lifecycle_inbox (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id            uuid NOT NULL,
  source_account_id   text NOT NULL,
  source_event_id     text NOT NULL CHECK (char_length(source_event_id) BETWEEN 1 AND 192),
  source_sequence     bigint CHECK (source_sequence IS NULL OR source_sequence >= 0),
  event_type          text NOT NULL CHECK (char_length(event_type) BETWEEN 1 AND 64),
  source_entity_kind  text CHECK (
                        source_entity_kind IS NULL OR
                        source_entity_kind IN ('position', 'pending_order', 'deal', 'order')
                      ),
  source_entity_id    text,
  payload             jsonb NOT NULL,
  status              text NOT NULL DEFAULT 'pending' CHECK (
                        status IN (
                          'pending', 'processing', 'processed', 'retry',
                          'dead_letter', 'ignored'
                        )
                      ),
  attempt_count       integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at        timestamptz NOT NULL DEFAULT now(),
  lease_owner         uuid,
  lease_expires_at    timestamptz,
  occurred_at         timestamptz NOT NULL,
  received_at         timestamptz NOT NULL DEFAULT now(),
  processed_at        timestamptz,
  last_error          text,
  UNIQUE (user_id, group_id, id),
  UNIQUE (user_id, group_id, source_account_id, source_event_id),
  FOREIGN KEY (user_id, group_id)
    REFERENCES execution_copy_groups(user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, source_account_id)
    REFERENCES execution_accounts(user_id, id) ON DELETE CASCADE,
  CHECK (jsonb_typeof(payload) = 'object'),
  CHECK (
    (source_entity_kind IS NULL AND source_entity_id IS NULL) OR
    (source_entity_kind IS NOT NULL AND source_entity_id IS NOT NULL)
  ),
  CHECK (
    (lease_owner IS NULL AND lease_expires_at IS NULL) OR
    (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
  )
);
CREATE UNIQUE INDEX execution_copy_inbox_sequence_unique
  ON execution_copy_lifecycle_inbox (
    user_id, group_id, source_account_id, source_sequence
  ) WHERE source_sequence IS NOT NULL;
CREATE INDEX execution_copy_inbox_work_idx
  ON execution_copy_lifecycle_inbox (
    status, available_at, lease_expires_at, occurred_at, id
  )
  WHERE status IN ('pending', 'retry', 'processing');
CREATE INDEX execution_copy_inbox_group_time_idx
  ON execution_copy_lifecycle_inbox (user_id, group_id, occurred_at DESC);

CREATE TABLE execution_copy_work_items (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id                 uuid NOT NULL,
  target_account_id        text NOT NULL,
  inbox_event_id           uuid NOT NULL,
  operation                text NOT NULL CHECK (operation IN (
                             'open_market', 'place_pending', 'modify_position',
                             'modify_pending', 'partial_close', 'close_position',
                             'cancel_pending', 'reconcile'
                           )),
  idempotency_key          text NOT NULL CHECK (
                             char_length(idempotency_key) BETWEEN 1 AND 192
                           ),
  expected_link_revision   bigint CHECK (
                             expected_link_revision IS NULL OR expected_link_revision >= 0
                           ),
  payload                  jsonb NOT NULL,
  status                   text NOT NULL DEFAULT 'pending' CHECK (status IN (
                             'pending', 'leased', 'retry', 'succeeded',
                             'dead_letter', 'superseded'
                           )),
  attempt_count            integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at             timestamptz NOT NULL DEFAULT now(),
  lease_owner              uuid,
  lease_expires_at         timestamptz,
  last_error               text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  completed_at             timestamptz,
  UNIQUE (user_id, group_id, id),
  UNIQUE (user_id, group_id, target_account_id, idempotency_key),
  FOREIGN KEY (user_id, group_id, target_account_id)
    REFERENCES execution_copy_targets(user_id, group_id, account_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, group_id, inbox_event_id)
    REFERENCES execution_copy_lifecycle_inbox(user_id, group_id, id) ON DELETE CASCADE,
  CHECK (jsonb_typeof(payload) = 'object'),
  CHECK (
    (lease_owner IS NULL AND lease_expires_at IS NULL) OR
    (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
  )
);
CREATE INDEX execution_copy_work_claim_idx
  ON execution_copy_work_items (
    status, available_at, lease_expires_at, created_at, id
  )
  WHERE status IN ('pending', 'retry', 'leased');
CREATE INDEX execution_copy_work_target_idx
  ON execution_copy_work_items (
    user_id, group_id, target_account_id, status, created_at DESC
  );

CREATE TABLE execution_copy_command_outbox (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id              uuid NOT NULL,
  target_account_id     text NOT NULL,
  work_item_id          uuid NOT NULL,
  target_command_id     text,
  idempotency_key       text NOT NULL CHECK (
                          char_length(idempotency_key) BETWEEN 1 AND 192
                        ),
  command_type          text NOT NULL CHECK (char_length(command_type) BETWEEN 1 AND 64),
  command_payload       jsonb NOT NULL,
  status                text NOT NULL DEFAULT 'pending' CHECK (status IN (
                          'pending', 'publishing', 'published', 'acknowledged',
                          'retry', 'dead_letter'
                        )),
  attempt_count         integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at          timestamptz NOT NULL DEFAULT now(),
  lease_owner           uuid,
  lease_expires_at      timestamptz,
  last_error            text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  published_at          timestamptz,
  acknowledged_at       timestamptz,
  UNIQUE (user_id, group_id, id),
  UNIQUE (user_id, work_item_id),
  UNIQUE (user_id, idempotency_key),
  FOREIGN KEY (user_id, group_id, target_account_id)
    REFERENCES execution_copy_targets(user_id, group_id, account_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, group_id, work_item_id)
    REFERENCES execution_copy_work_items(user_id, group_id, id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, target_command_id)
    REFERENCES execution_target_commands(user_id, id) ON DELETE RESTRICT,
  CHECK (jsonb_typeof(command_payload) = 'object'),
  CHECK (
    (lease_owner IS NULL AND lease_expires_at IS NULL) OR
    (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
  )
);
CREATE INDEX execution_copy_outbox_publish_idx
  ON execution_copy_command_outbox (
    status, available_at, lease_expires_at, created_at, id
  )
  WHERE status IN ('pending', 'publishing', 'retry');
CREATE INDEX execution_copy_outbox_target_idx
  ON execution_copy_command_outbox (
    user_id, group_id, target_account_id, status, created_at DESC
  );
CREATE INDEX execution_copy_outbox_target_command_idx
  ON execution_copy_command_outbox (user_id, target_command_id)
  WHERE target_command_id IS NOT NULL;

-- A source entity can fan into multiple target legs (partial fills/hedging),
-- while netting accounts may leave target_entity_id unresolved until a broker
-- transaction or reconciliation snapshot establishes the durable mapping.
CREATE TABLE execution_copy_links (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id              uuid NOT NULL,
  source_account_id     text NOT NULL,
  target_account_id     text NOT NULL,
  source_entity_kind    text NOT NULL CHECK (
                          source_entity_kind IN ('position', 'pending_order')
                        ),
  source_entity_id      text NOT NULL,
  target_leg            integer NOT NULL DEFAULT 0 CHECK (target_leg >= 0),
  target_entity_kind    text CHECK (
                          target_entity_kind IS NULL OR
                          target_entity_kind IN ('position', 'pending_order')
                        ),
  target_entity_id      text,
  lifecycle_status      text NOT NULL DEFAULT 'pending' CHECK (
                          lifecycle_status IN (
                            'pending', 'active', 'closing', 'closed',
                            'cancelled', 'orphaned', 'error'
                          )
                        ),
  source_quantity       numeric CHECK (source_quantity IS NULL OR source_quantity >= 0),
  target_quantity       numeric CHECK (target_quantity IS NULL OR target_quantity >= 0),
  last_source_event_id  text,
  last_target_event_id  text,
  revision              bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  metadata              jsonb NOT NULL DEFAULT '{}'::jsonb,
  opened_at             timestamptz,
  closed_at             timestamptz,
  last_reconciled_at    timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, group_id, id),
  UNIQUE (
    user_id, group_id, target_account_id,
    source_entity_kind, source_entity_id, target_leg
  ),
  FOREIGN KEY (user_id, group_id)
    REFERENCES execution_copy_groups(user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, source_account_id)
    REFERENCES execution_accounts(user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, group_id, target_account_id)
    REFERENCES execution_copy_targets(user_id, group_id, account_id) ON DELETE CASCADE,
  CHECK (jsonb_typeof(metadata) = 'object'),
  CHECK (
    (target_entity_kind IS NULL AND target_entity_id IS NULL) OR
    (target_entity_kind IS NOT NULL AND target_entity_id IS NOT NULL)
  )
);
CREATE INDEX execution_copy_links_target_active_idx
  ON execution_copy_links (
    user_id, group_id, target_account_id, target_entity_kind, target_entity_id
  ) WHERE target_entity_id IS NOT NULL AND lifecycle_status NOT IN ('closed', 'cancelled');
CREATE INDEX execution_copy_links_source_idx
  ON execution_copy_links (
    user_id, group_id, source_entity_kind, source_entity_id, lifecycle_status
  );
CREATE INDEX execution_copy_links_target_idx
  ON execution_copy_links (
    user_id, target_account_id, target_entity_kind, target_entity_id
  ) WHERE target_entity_id IS NOT NULL;

CREATE TABLE execution_copy_reconciliation_runs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id           uuid NOT NULL,
  trigger_kind       text NOT NULL CHECK (
                       trigger_kind IN ('scheduled', 'manual', 'startup', 'event_gap')
                     ),
  status             text NOT NULL DEFAULT 'queued' CHECK (
                       status IN ('queued', 'running', 'succeeded', 'degraded', 'failed')
                     ),
  group_revision     bigint NOT NULL CHECK (group_revision > 0),
  source_observed_at timestamptz,
  checked_count      integer NOT NULL DEFAULT 0 CHECK (checked_count >= 0),
  mismatch_count     integer NOT NULL DEFAULT 0 CHECK (mismatch_count >= 0),
  repaired_count     integer NOT NULL DEFAULT 0 CHECK (repaired_count >= 0),
  lease_owner        uuid,
  lease_expires_at   timestamptz,
  started_at         timestamptz,
  completed_at       timestamptz,
  error_message      text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, group_id, id),
  FOREIGN KEY (user_id, group_id)
    REFERENCES execution_copy_groups(user_id, id) ON DELETE CASCADE,
  CHECK (
    (lease_owner IS NULL AND lease_expires_at IS NULL) OR
    (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
  )
);
CREATE INDEX execution_copy_reconcile_claim_idx
  ON execution_copy_reconciliation_runs (status, lease_expires_at, created_at, id)
  WHERE status IN ('queued', 'running');
CREATE INDEX execution_copy_reconcile_group_idx
  ON execution_copy_reconciliation_runs (user_id, group_id, created_at DESC);

CREATE TABLE execution_copy_reconciliation_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reconciliation_id   uuid NOT NULL,
  group_id            uuid NOT NULL,
  target_account_id   text,
  link_id             uuid,
  discrepancy_type    text NOT NULL CHECK (char_length(discrepancy_type) BETWEEN 1 AND 64),
  status              text NOT NULL DEFAULT 'open' CHECK (
                        status IN ('open', 'resolving', 'resolved', 'ignored', 'error')
                      ),
  expected_state      jsonb NOT NULL DEFAULT '{}'::jsonb,
  actual_state        jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolution_action   text,
  resolved_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, group_id, id),
  FOREIGN KEY (user_id, group_id, reconciliation_id)
    REFERENCES execution_copy_reconciliation_runs(user_id, group_id, id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, group_id)
    REFERENCES execution_copy_groups(user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, group_id, target_account_id)
    REFERENCES execution_copy_targets(user_id, group_id, account_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, group_id, link_id)
    REFERENCES execution_copy_links(user_id, group_id, id) ON DELETE CASCADE,
  CHECK (jsonb_typeof(expected_state) = 'object'),
  CHECK (jsonb_typeof(actual_state) = 'object')
);
CREATE INDEX execution_copy_reconcile_item_open_idx
  ON execution_copy_reconciliation_items (user_id, group_id, status, created_at DESC)
  WHERE status IN ('open', 'resolving', 'error');

CREATE TABLE execution_copy_errors (
  id                  bigserial PRIMARY KEY,
  user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id            uuid NOT NULL,
  target_account_id   text,
  inbox_event_id      uuid,
  work_item_id        uuid,
  outbox_id           uuid,
  reconciliation_id   uuid,
  error_code          text NOT NULL CHECK (char_length(error_code) BETWEEN 1 AND 64),
  message             text NOT NULL,
  context             jsonb NOT NULL DEFAULT '{}'::jsonb,
  retryable           boolean NOT NULL DEFAULT false,
  resolved_at         timestamptz,
  occurred_at         timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (user_id, group_id)
    REFERENCES execution_copy_groups(user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, group_id, target_account_id)
    REFERENCES execution_copy_targets(user_id, group_id, account_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, group_id, inbox_event_id)
    REFERENCES execution_copy_lifecycle_inbox(user_id, group_id, id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, group_id, work_item_id)
    REFERENCES execution_copy_work_items(user_id, group_id, id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, group_id, outbox_id)
    REFERENCES execution_copy_command_outbox(user_id, group_id, id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, group_id, reconciliation_id)
    REFERENCES execution_copy_reconciliation_runs(user_id, group_id, id) ON DELETE CASCADE,
  CHECK (jsonb_typeof(context) = 'object')
);
CREATE INDEX execution_copy_errors_group_time_idx
  ON execution_copy_errors (user_id, group_id, occurred_at DESC);
CREATE INDEX execution_copy_errors_unresolved_idx
  ON execution_copy_errors (user_id, group_id, occurred_at DESC)
  WHERE resolved_at IS NULL;
