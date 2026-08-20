-- Phase 4b: normalized historical orders/deals and bounded coverage.
-- No broker-native payloads or credentials are persisted.

CREATE TABLE execution_mt5_vm_history_orders (
  user_id uuid NOT NULL,
  account_id text NOT NULL,
  broker_ticket text NOT NULL CHECK (char_length(broker_ticket) BETWEEN 1 AND 64 AND broker_ticket ~ '^[A-Za-z0-9_-]+$'),
  position_ticket text CHECK (position_ticket IS NULL OR (char_length(position_ticket) BETWEEN 1 AND 64 AND position_ticket ~ '^[A-Za-z0-9_-]+$')),
  symbol text NOT NULL CHECK (char_length(symbol) BETWEEN 1 AND 64),
  order_type text NOT NULL CHECK (order_type IN ('buy','sell','buy_limit','sell_limit','buy_stop','sell_stop','buy_stop_limit','sell_stop_limit')),
  state text NOT NULL CHECK (state IN ('started','placed','canceled','filled','rejected','expired','partial','request_added','request_modified','request_canceled')),
  volume_initial numeric(24,8) NOT NULL CHECK (volume_initial > 0),
  volume_current numeric(24,8) NOT NULL CHECK (volume_current >= 0),
  price_open numeric(24,8) NOT NULL CHECK (price_open > 0),
  price_current numeric(24,8) CHECK (price_current IS NULL OR price_current > 0),
  stop_loss numeric(24,8) CHECK (stop_loss IS NULL OR stop_loss >= 0),
  take_profit numeric(24,8) CHECK (take_profit IS NULL OR take_profit >= 0),
  placed_at timestamptz,
  done_at timestamptz,
  magic bigint,
  worker_id text REFERENCES execution_mt5_vm_workers(worker_id) ON DELETE SET NULL,
  lease_generation bigint NOT NULL CHECK (lease_generation > 0),
  worker_session_generation bigint NOT NULL CHECK (worker_session_generation > 0),
  sync_sequence bigint NOT NULL CHECK (sync_sequence > 0),
  observed_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, broker_ticket),
  FOREIGN KEY (user_id, account_id) REFERENCES execution_mt5_vm_accounts(user_id, account_id) ON DELETE CASCADE
);
CREATE INDEX execution_mt5_vm_history_orders_read_idx
  ON execution_mt5_vm_history_orders(user_id, account_id, COALESCE(done_at, placed_at), broker_ticket);

CREATE TABLE execution_mt5_vm_deals (
  user_id uuid NOT NULL,
  account_id text NOT NULL,
  broker_ticket text NOT NULL CHECK (char_length(broker_ticket) BETWEEN 1 AND 64 AND broker_ticket ~ '^[A-Za-z0-9_-]+$'),
  order_ticket text CHECK (order_ticket IS NULL OR (char_length(order_ticket) BETWEEN 1 AND 64 AND order_ticket ~ '^[A-Za-z0-9_-]+$')),
  position_ticket text CHECK (position_ticket IS NULL OR (char_length(position_ticket) BETWEEN 1 AND 64 AND position_ticket ~ '^[A-Za-z0-9_-]+$')),
  symbol text CHECK (symbol IS NULL OR char_length(symbol) BETWEEN 1 AND 64),
  deal_type text NOT NULL CHECK (deal_type IN ('buy','sell','balance','credit','charge','correction','bonus','commission','commission_daily','commission_monthly','commission_agent_daily','commission_agent_monthly','interest','buy_canceled','sell_canceled','dividend','dividend_franked','tax')),
  entry text NOT NULL CHECK (entry IN ('in','out','inout','out_by')),
  volume numeric(24,8) NOT NULL CHECK (volume >= 0),
  price numeric(24,8) NOT NULL CHECK (price >= 0),
  commission numeric(24,8),
  swap numeric(24,8),
  profit numeric(24,8),
  fee numeric(24,8),
  occurred_at timestamptz NOT NULL,
  magic bigint,
  worker_id text REFERENCES execution_mt5_vm_workers(worker_id) ON DELETE SET NULL,
  lease_generation bigint NOT NULL CHECK (lease_generation > 0),
  worker_session_generation bigint NOT NULL CHECK (worker_session_generation > 0),
  sync_sequence bigint NOT NULL CHECK (sync_sequence > 0),
  observed_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, broker_ticket),
  FOREIGN KEY (user_id, account_id) REFERENCES execution_mt5_vm_accounts(user_id, account_id) ON DELETE CASCADE
);
CREATE INDEX execution_mt5_vm_deals_read_idx
  ON execution_mt5_vm_deals(user_id, account_id, occurred_at, broker_ticket);

CREATE TABLE execution_mt5_vm_history_coverage (
  user_id uuid NOT NULL,
  account_id text NOT NULL,
  family text NOT NULL CHECK (family IN ('orders_history','deals')),
  requested_from timestamptz NOT NULL,
  requested_to timestamptz NOT NULL,
  covered_through timestamptz,
  last_result text NOT NULL CHECK (last_result IN ('complete','partial','failed')),
  last_error_code text CHECK (last_error_code IS NULL OR last_error_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  cursor text CHECK (cursor IS NULL OR char_length(cursor) BETWEEN 1 AND 256),
  worker_id text REFERENCES execution_mt5_vm_workers(worker_id) ON DELETE SET NULL,
  lease_generation bigint NOT NULL CHECK (lease_generation > 0),
  worker_session_generation bigint NOT NULL CHECK (worker_session_generation > 0),
  sync_sequence bigint NOT NULL CHECK (sync_sequence > 0),
  observed_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, family),
  CHECK (requested_to > requested_from),
  CHECK (covered_through IS NULL OR (covered_through >= requested_from AND covered_through <= requested_to)),
  FOREIGN KEY (user_id, account_id) REFERENCES execution_mt5_vm_accounts(user_id, account_id) ON DELETE CASCADE
);
