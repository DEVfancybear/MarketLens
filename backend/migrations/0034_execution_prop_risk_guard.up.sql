-- Versioned, broker-neutral prop-firm protection profiles assigned per account.
-- Rules/actions are immutable snapshots of a system preset or a custom profile,
-- so adding another prop firm does not require changing the evaluator schema.

CREATE TABLE execution_prop_risk_assignments (
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id       text NOT NULL,
  enabled          boolean NOT NULL DEFAULT false,
  profile_id       text NOT NULL CHECK (
                     profile_id ~ '^[a-z0-9][a-z0-9_-]{2,63}$'
                   ),
  profile_version  integer NOT NULL CHECK (profile_version > 0),
  provider_code    text NOT NULL CHECK (
                     provider_code ~ '^[a-z0-9][a-z0-9_-]{1,31}$'
                   ),
  program_code     text NOT NULL CHECK (
                     program_code ~ '^[a-z0-9][a-z0-9_-]{1,63}$'
                   ),
  display_name     text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 120),
  timezone         text NOT NULL CHECK (char_length(timezone) BETWEEN 1 AND 64),
  initial_balance  numeric NOT NULL CHECK (initial_balance > 0),
  rules            jsonb NOT NULL,
  actions          jsonb NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, account_id),
  FOREIGN KEY (user_id, account_id)
    REFERENCES execution_accounts(user_id, id) ON DELETE CASCADE,
  CHECK (jsonb_typeof(rules) = 'object'),
  CHECK (jsonb_typeof(actions) = 'object')
);

CREATE TABLE execution_prop_risk_daily_state (
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id         text NOT NULL,
  trading_day        date NOT NULL,
  day_start_balance  numeric NOT NULL CHECK (day_start_balance > 0),
  last_balance       numeric NOT NULL,
  last_equity        numeric NOT NULL,
  min_equity         numeric NOT NULL,
  status             text NOT NULL CHECK (status IN (
                       'protected', 'warning', 'locked', 'breached'
                     )),
  reason             text,
  locked              boolean NOT NULL DEFAULT false,
  evaluation         jsonb NOT NULL,
  evaluated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, account_id, trading_day),
  FOREIGN KEY (user_id, account_id)
    REFERENCES execution_prop_risk_assignments(user_id, account_id)
    ON DELETE CASCADE,
  CHECK (jsonb_typeof(evaluation) = 'object')
);

CREATE INDEX execution_prop_risk_state_account_time_idx
  ON execution_prop_risk_daily_state (user_id, account_id, evaluated_at DESC);
