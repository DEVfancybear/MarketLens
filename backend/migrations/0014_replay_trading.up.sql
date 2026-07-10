CREATE TYPE replay_order_side AS ENUM ('buy', 'sell');
CREATE TYPE replay_order_type AS ENUM ('market', 'limit', 'stop', 'stop_limit');
CREATE TYPE replay_order_status AS ENUM
  ('pending', 'partially_filled', 'filled', 'cancelled', 'rejected');

CREATE TABLE replay_accounts (
  session_id       uuid PRIMARY KEY REFERENCES replay_sessions(id) ON DELETE CASCADE,
  base_currency    text NOT NULL DEFAULT 'USD' CHECK (length(base_currency) = 3),
  starting_equity  numeric(24,8) NOT NULL CHECK (starting_equity > 0),
  balance          numeric(24,8) NOT NULL,
  equity           numeric(24,8) NOT NULL,
  commission_model jsonb NOT NULL DEFAULT '{}',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE replay_orders (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       uuid NOT NULL REFERENCES replay_sessions(id) ON DELETE CASCADE,
  track_id         uuid NOT NULL REFERENCES replay_tracks(id) ON DELETE CASCADE,
  client_order_id  text NOT NULL CHECK (length(client_order_id) BETWEEN 1 AND 200),
  side             replay_order_side NOT NULL,
  order_type       replay_order_type NOT NULL,
  status           replay_order_status NOT NULL DEFAULT 'pending',
  quantity         numeric(28,10) NOT NULL CHECK (quantity > 0),
  filled_quantity  numeric(28,10) NOT NULL DEFAULT 0 CHECK (filled_quantity >= 0),
  limit_price      numeric(24,10),
  stop_price       numeric(24,10),
  take_profit      numeric(24,10),
  stop_loss        numeric(24,10),
  submitted_at     timestamptz NOT NULL,
  updated_at_sim   timestamptz NOT NULL,
  reject_reason    text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, client_order_id),
  CHECK (filled_quantity <= quantity),
  CHECK (order_type <> 'limit' OR limit_price IS NOT NULL),
  CHECK (order_type <> 'stop' OR stop_price IS NOT NULL),
  CHECK (order_type <> 'stop_limit' OR (limit_price IS NOT NULL AND stop_price IS NOT NULL))
);
CREATE INDEX idx_replay_orders_session_status
  ON replay_orders(session_id, status, submitted_at, id);

CREATE TABLE replay_fills (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id     uuid NOT NULL REFERENCES replay_sessions(id) ON DELETE CASCADE,
  order_id       uuid NOT NULL REFERENCES replay_orders(id) ON DELETE CASCADE,
  track_id       uuid NOT NULL REFERENCES replay_tracks(id) ON DELETE CASCADE,
  dataset_seq    bigint NOT NULL CHECK (dataset_seq >= 0),
  simulated_at   timestamptz NOT NULL,
  price          numeric(24,10) NOT NULL CHECK (price > 0),
  quantity       numeric(28,10) NOT NULL CHECK (quantity > 0),
  commission     numeric(24,8) NOT NULL DEFAULT 0 CHECK (commission >= 0),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, dataset_seq)
);
CREATE INDEX idx_replay_fills_session_time
  ON replay_fills(session_id, simulated_at, id);

CREATE TABLE replay_positions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       uuid NOT NULL REFERENCES replay_sessions(id) ON DELETE CASCADE,
  track_id         uuid NOT NULL REFERENCES replay_tracks(id) ON DELETE CASCADE,
  symbol           text NOT NULL,
  net_quantity     numeric(28,10) NOT NULL DEFAULT 0,
  average_price    numeric(24,10) NOT NULL DEFAULT 0,
  realized_pnl     numeric(24,8) NOT NULL DEFAULT 0,
  unrealized_pnl   numeric(24,8) NOT NULL DEFAULT 0,
  stop_loss        numeric(24,10),
  take_profit      numeric(24,10),
  updated_at_sim   timestamptz NOT NULL,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, track_id, symbol)
);

CREATE TABLE replay_equity_points (
  session_id    uuid NOT NULL REFERENCES replay_sessions(id) ON DELETE CASCADE,
  event_seq     bigint NOT NULL CHECK (event_seq >= 0),
  simulated_at  timestamptz NOT NULL,
  balance       numeric(24,8) NOT NULL,
  equity        numeric(24,8) NOT NULL,
  drawdown      numeric(24,8) NOT NULL DEFAULT 0 CHECK (drawdown >= 0),
  PRIMARY KEY (session_id, event_seq)
);

CREATE TRIGGER trg_replay_accounts_set_updated_at BEFORE UPDATE ON replay_accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_replay_orders_set_updated_at BEFORE UPDATE ON replay_orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_replay_positions_set_updated_at BEFORE UPDATE ON replay_positions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
