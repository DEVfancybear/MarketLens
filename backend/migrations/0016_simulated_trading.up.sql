CREATE TYPE order_type AS ENUM ('market', 'limit', 'stop');
CREATE TYPE position_status AS ENUM ('pending', 'open', 'closed', 'cancelled');

CREATE TABLE sim_accounts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            text NOT NULL DEFAULT 'Default' CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  starting_equity numeric(20,8) NOT NULL DEFAULT 10000 CHECK (starting_equity > 0),
  currency        text NOT NULL DEFAULT 'USD' CHECK (length(btrim(currency)) BETWEEN 3 AND 12),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_sim_accounts_user ON sim_accounts(user_id, updated_at DESC);

CREATE TABLE sim_positions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     uuid NOT NULL REFERENCES sim_accounts(id) ON DELETE CASCADE,
  symbol         text NOT NULL CHECK (length(btrim(symbol)) BETWEEN 1 AND 80),
  side           trade_side NOT NULL,
  type           order_type NOT NULL,
  status         position_status NOT NULL DEFAULT 'pending',
  entry          numeric(20,8) NOT NULL CHECK (entry > 0),
  quantity       numeric(20,8) NOT NULL CHECK (quantity > 0),
  remaining      numeric(20,8) NOT NULL CHECK (remaining >= 0),
  stop_loss      numeric(20,8),
  take_profit    numeric(20,8),
  risk_pct       numeric(20,8),
  risk_amount    numeric(20,8) NOT NULL DEFAULT 0 CHECK (risk_amount >= 0),
  realized_pnl   numeric(20,8) NOT NULL DEFAULT 0,
  unrealized_pnl numeric(20,8) NOT NULL DEFAULT 0,
  fills          jsonb NOT NULL DEFAULT '[]',
  notes          text,
  client_id      text NOT NULL,
  open_time      timestamptz,
  close_time     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, client_id)
);
CREATE INDEX idx_sim_positions_account ON sim_positions(account_id, updated_at DESC);
CREATE INDEX idx_sim_positions_status ON sim_positions(account_id, status, updated_at DESC);

CREATE TRIGGER trg_sim_accounts_set_updated_at BEFORE UPDATE ON sim_accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_sim_positions_set_updated_at BEFORE UPDATE ON sim_positions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Phase 11 allowed this future FK column to be populated without validation.
-- Preserve deployability if a development client wrote a stale reference.
UPDATE journal_entries j SET position_id = NULL
WHERE position_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM sim_positions p WHERE p.id = j.position_id);

ALTER TABLE journal_entries
  ADD CONSTRAINT journal_entries_position_id_fkey
  FOREIGN KEY (position_id) REFERENCES sim_positions(id) ON DELETE SET NULL;
