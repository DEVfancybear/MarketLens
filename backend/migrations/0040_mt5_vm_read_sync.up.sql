-- Phase 4a: normalized read synchronization for the managed MT5 VM connector.
--
-- These tables hold only normalized, non-secret observations. No login, password,
-- vault reference, terminal path or MT5-native payload is stored here. Decimal
-- trading values are numeric in PostgreSQL and are serialized as strings at every
-- API boundary, per plan section 6.
--
-- Every table carries the same sync envelope (worker_id, lease_generation,
-- worker_session_generation, sync_sequence, observed_at, recorded_at) so a write
-- can be fenced against a stale worker or a replayed snapshot before it lands.

-- Per-account, per-family high-water mark and last outcome.
--
-- This table is what makes invariant 8 ("empty is not unknown") expressible: a
-- portfolio with zero rows means something completely different depending on
-- whether the last snapshot was `complete` or `partial`/`failed`. Without this
-- row a reader cannot tell an genuinely empty account from a broken one.
CREATE TABLE execution_mt5_vm_sync_state (
  user_id                    uuid NOT NULL,
  account_id                 text NOT NULL,
  family                     text NOT NULL CHECK (
                               family IN ('account', 'positions', 'pending_orders', 'instruments')
                             ),
  sync_sequence              bigint NOT NULL DEFAULT 0 CHECK (sync_sequence >= 0),
  last_result                text NOT NULL DEFAULT 'partial' CHECK (
                               last_result IN ('complete', 'partial', 'failed')
                             ),
  last_error_code            text CHECK (
                               last_error_code IS NULL OR
                               last_error_code ~ '^[A-Z][A-Z0-9_]{0,63}$'
                             ),
  observed_at                timestamptz,
  last_complete_sync_at      timestamptz,
  worker_id                  text REFERENCES execution_mt5_vm_workers(worker_id)
                               ON DELETE SET NULL,
  lease_generation           bigint NOT NULL DEFAULT 0 CHECK (lease_generation >= 0),
  worker_session_generation  bigint NOT NULL DEFAULT 0 CHECK (worker_session_generation >= 0),
  recorded_at                timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, family),
  FOREIGN KEY (user_id, account_id)
    REFERENCES execution_mt5_vm_accounts (user_id, account_id) ON DELETE CASCADE
);

-- Normalized account state. One row per connected account.
CREATE TABLE execution_mt5_vm_account_state (
  user_id                    uuid NOT NULL,
  account_id                 text PRIMARY KEY,
  currency                   text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  leverage                   integer CHECK (leverage IS NULL OR leverage > 0),
  balance                    numeric(24, 8) NOT NULL,
  equity                     numeric(24, 8) NOT NULL,
  margin                     numeric(24, 8) NOT NULL CHECK (margin >= 0),
  free_margin                numeric(24, 8) NOT NULL,
  margin_level               numeric(24, 8) CHECK (margin_level IS NULL OR margin_level >= 0),
  margin_mode                text NOT NULL CHECK (
                               margin_mode IN ('netting', 'exchange', 'hedging')
                             ),
  account_mode               text NOT NULL CHECK (
                               account_mode IN ('demo', 'contest', 'real')
                             ),
  trade_allowed              boolean NOT NULL,
  -- Identity evidence for invariant 7. Only a masked suffix is ever stored; the
  -- full login stays out of PostgreSQL exactly as in execution_mt5_vm_accounts.
  observed_server            text NOT NULL CHECK (char_length(observed_server) BETWEEN 1 AND 128),
  observed_login_suffix      text CHECK (
                               observed_login_suffix IS NULL OR
                               observed_login_suffix ~ '^[0-9]{1,4}$'
                             ),
  worker_id                  text REFERENCES execution_mt5_vm_workers(worker_id)
                               ON DELETE SET NULL,
  lease_generation           bigint NOT NULL CHECK (lease_generation > 0),
  worker_session_generation  bigint NOT NULL CHECK (worker_session_generation > 0),
  sync_sequence              bigint NOT NULL CHECK (sync_sequence > 0),
  observed_at                timestamptz NOT NULL,
  recorded_at                timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (user_id, account_id)
    REFERENCES execution_mt5_vm_accounts (user_id, account_id) ON DELETE CASCADE
);

-- Open positions. Broker tickets stay opaque strings (plan section 6).
CREATE TABLE execution_mt5_vm_positions (
  user_id                    uuid NOT NULL,
  account_id                 text NOT NULL,
  broker_ticket              text NOT NULL CHECK (
                               char_length(broker_ticket) BETWEEN 1 AND 64 AND
                               broker_ticket ~ '^[A-Za-z0-9_-]+$'
                             ),
  symbol                     text NOT NULL CHECK (char_length(symbol) BETWEEN 1 AND 64),
  side                       text NOT NULL CHECK (side IN ('buy', 'sell')),
  volume                     numeric(24, 8) NOT NULL CHECK (volume > 0),
  open_price                 numeric(24, 8) NOT NULL CHECK (open_price > 0),
  current_price              numeric(24, 8) CHECK (current_price IS NULL OR current_price > 0),
  stop_loss                  numeric(24, 8) CHECK (stop_loss IS NULL OR stop_loss >= 0),
  take_profit                numeric(24, 8) CHECK (take_profit IS NULL OR take_profit >= 0),
  swap                       numeric(24, 8),
  profit                     numeric(24, 8),
  magic                      bigint,
  opened_at                  timestamptz,
  worker_id                  text REFERENCES execution_mt5_vm_workers(worker_id)
                               ON DELETE SET NULL,
  lease_generation           bigint NOT NULL CHECK (lease_generation > 0),
  worker_session_generation  bigint NOT NULL CHECK (worker_session_generation > 0),
  sync_sequence              bigint NOT NULL CHECK (sync_sequence > 0),
  observed_at                timestamptz NOT NULL,
  recorded_at                timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, broker_ticket),
  FOREIGN KEY (user_id, account_id)
    REFERENCES execution_mt5_vm_accounts (user_id, account_id) ON DELETE CASCADE
);
CREATE INDEX execution_mt5_vm_positions_owner_idx
  ON execution_mt5_vm_positions (user_id, account_id, symbol);

-- Working (pending) orders.
CREATE TABLE execution_mt5_vm_pending_orders (
  user_id                    uuid NOT NULL,
  account_id                 text NOT NULL,
  broker_ticket              text NOT NULL CHECK (
                               char_length(broker_ticket) BETWEEN 1 AND 64 AND
                               broker_ticket ~ '^[A-Za-z0-9_-]+$'
                             ),
  symbol                     text NOT NULL CHECK (char_length(symbol) BETWEEN 1 AND 64),
  order_type                 text NOT NULL CHECK (
                               order_type IN (
                                 'buy_limit', 'sell_limit', 'buy_stop', 'sell_stop',
                                 'buy_stop_limit', 'sell_stop_limit'
                               )
                             ),
  volume_current             numeric(24, 8) NOT NULL CHECK (volume_current > 0),
  volume_initial             numeric(24, 8) CHECK (volume_initial IS NULL OR volume_initial > 0),
  price_open                 numeric(24, 8) NOT NULL CHECK (price_open > 0),
  price_stop_limit           numeric(24, 8) CHECK (price_stop_limit IS NULL OR price_stop_limit > 0),
  stop_loss                  numeric(24, 8) CHECK (stop_loss IS NULL OR stop_loss >= 0),
  take_profit                numeric(24, 8) CHECK (take_profit IS NULL OR take_profit >= 0),
  time_in_force              text CHECK (
                               time_in_force IS NULL OR
                               time_in_force IN ('gtc', 'day', 'specified', 'specified_day')
                             ),
  magic                      bigint,
  placed_at                  timestamptz,
  expires_at                 timestamptz,
  worker_id                  text REFERENCES execution_mt5_vm_workers(worker_id)
                               ON DELETE SET NULL,
  lease_generation           bigint NOT NULL CHECK (lease_generation > 0),
  worker_session_generation  bigint NOT NULL CHECK (worker_session_generation > 0),
  sync_sequence              bigint NOT NULL CHECK (sync_sequence > 0),
  observed_at                timestamptz NOT NULL,
  recorded_at                timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, broker_ticket),
  FOREIGN KEY (user_id, account_id)
    REFERENCES execution_mt5_vm_accounts (user_id, account_id) ON DELETE CASCADE
);
CREATE INDEX execution_mt5_vm_pending_orders_owner_idx
  ON execution_mt5_vm_pending_orders (user_id, account_id, symbol);

-- Trading specifications per symbol, as observed on this account's terminal.
-- These are per-account because suffixes and permissions differ per broker
-- server; they are not a global instrument catalogue.
CREATE TABLE execution_mt5_vm_instruments (
  user_id                    uuid NOT NULL,
  account_id                 text NOT NULL,
  symbol                     text NOT NULL CHECK (char_length(symbol) BETWEEN 1 AND 64),
  digits                     integer NOT NULL CHECK (digits BETWEEN 0 AND 12),
  point                      numeric(24, 12) NOT NULL CHECK (point > 0),
  tick_size                  numeric(24, 12) CHECK (tick_size IS NULL OR tick_size > 0),
  tick_value                 numeric(24, 12) CHECK (tick_value IS NULL OR tick_value >= 0),
  contract_size              numeric(24, 8) CHECK (contract_size IS NULL OR contract_size > 0),
  volume_min                 numeric(24, 8) NOT NULL CHECK (volume_min > 0),
  volume_max                 numeric(24, 8) NOT NULL CHECK (volume_max > 0),
  volume_step                numeric(24, 8) NOT NULL CHECK (volume_step > 0),
  stops_level                integer CHECK (stops_level IS NULL OR stops_level >= 0),
  freeze_level               integer CHECK (freeze_level IS NULL OR freeze_level >= 0),
  -- Normalized names only; MT5 enums stop inside the Python adapter.
  filling_modes              text[] NOT NULL DEFAULT '{}',
  trade_mode                 text NOT NULL CHECK (
                               trade_mode IN (
                                 'disabled', 'long_only', 'short_only', 'close_only', 'full'
                               )
                             ),
  worker_id                  text REFERENCES execution_mt5_vm_workers(worker_id)
                               ON DELETE SET NULL,
  lease_generation           bigint NOT NULL CHECK (lease_generation > 0),
  worker_session_generation  bigint NOT NULL CHECK (worker_session_generation > 0),
  sync_sequence              bigint NOT NULL CHECK (sync_sequence > 0),
  observed_at                timestamptz NOT NULL,
  recorded_at                timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, symbol),
  CHECK (volume_max >= volume_min),
  CHECK (filling_modes <@ ARRAY['fok', 'ioc', 'return', 'boc']::text[]),
  FOREIGN KEY (user_id, account_id)
    REFERENCES execution_mt5_vm_accounts (user_id, account_id) ON DELETE CASCADE
);
CREATE INDEX execution_mt5_vm_instruments_owner_idx
  ON execution_mt5_vm_instruments (user_id, account_id);
