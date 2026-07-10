CREATE TYPE alert_condition AS ENUM ('above', 'below', 'crossUp', 'crossDown');
CREATE TYPE alert_status AS ENUM ('active', 'triggered');

CREATE TABLE alerts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id     text,
  symbol        text NOT NULL,
  condition     alert_condition NOT NULL,
  price         numeric(20,8) NOT NULL CHECK (price > 0),
  note          text,
  status        alert_status NOT NULL DEFAULT 'active',
  enabled       boolean NOT NULL DEFAULT true,
  locked        boolean NOT NULL DEFAULT false,
  recurring     boolean NOT NULL DEFAULT false,
  sound         boolean NOT NULL DEFAULT true,
  browser       boolean NOT NULL DEFAULT false,
  push          boolean NOT NULL DEFAULT false,
  telegram      boolean NOT NULL DEFAULT false,
  discord       boolean NOT NULL DEFAULT false,
  trigger_price numeric(20,8),
  triggered_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_alerts_user ON alerts(user_id, created_at DESC);
CREATE INDEX idx_alerts_active_symbol ON alerts(symbol)
  WHERE status = 'active' AND enabled;
CREATE UNIQUE INDEX idx_alerts_client ON alerts(user_id, client_id)
  WHERE client_id IS NOT NULL;

CREATE TABLE alert_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id      uuid REFERENCES alerts(id) ON DELETE SET NULL,
  alert_ref     text NOT NULL,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol        text NOT NULL,
  condition     alert_condition NOT NULL,
  target_price  numeric(20,8) NOT NULL,
  trigger_price numeric(20,8) NOT NULL,
  triggered_at  timestamptz NOT NULL DEFAULT now(),
  delivered     boolean NOT NULL DEFAULT false
);

CREATE INDEX idx_alert_events_alert ON alert_events(alert_id, triggered_at DESC);
CREATE INDEX idx_alert_events_ref ON alert_events(user_id, alert_ref, triggered_at DESC);
CREATE INDEX idx_alert_events_user ON alert_events(user_id, triggered_at DESC);
