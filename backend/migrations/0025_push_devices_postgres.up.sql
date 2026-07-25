ALTER TABLE push_tokens
  ADD COLUMN delivery_token text,
  ADD COLUMN notification_time_zone text NOT NULL DEFAULT 'UTC',
  ADD COLUMN alerts jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN settings_push boolean NOT NULL DEFAULT false,
  ADD COLUMN settings_telegram boolean NOT NULL DEFAULT false,
  ADD COLUMN settings_discord boolean NOT NULL DEFAULT false,
  ADD COLUMN last_prices jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN alert_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN state_version bigint NOT NULL DEFAULT 1,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE push_tokens
  ADD CONSTRAINT push_tokens_delivery_token_length
    CHECK (delivery_token IS NULL OR char_length(delivery_token) <= 16384),
  ADD CONSTRAINT push_tokens_notification_time_zone_length
    CHECK (char_length(notification_time_zone) BETWEEN 1 AND 80),
  ADD CONSTRAINT push_tokens_alerts_array
    CHECK (jsonb_typeof(alerts) = 'array'),
  ADD CONSTRAINT push_tokens_last_prices_object
    CHECK (jsonb_typeof(last_prices) = 'object'),
  ADD CONSTRAINT push_tokens_alert_state_object
    CHECK (jsonb_typeof(alert_state) = 'object'),
  ADD CONSTRAINT push_tokens_state_version_positive
    CHECK (state_version > 0);

CREATE INDEX idx_push_tokens_worker_active
  ON push_tokens (updated_at, id)
  WHERE settings_push
     OR settings_telegram
     OR settings_discord
     OR alerts <> '[]'::jsonb
     OR alert_state <> '{}'::jsonb;
