DROP INDEX IF EXISTS idx_push_tokens_worker_active;

ALTER TABLE push_tokens
  DROP CONSTRAINT IF EXISTS push_tokens_state_version_positive,
  DROP CONSTRAINT IF EXISTS push_tokens_alert_state_object,
  DROP CONSTRAINT IF EXISTS push_tokens_last_prices_object,
  DROP CONSTRAINT IF EXISTS push_tokens_alerts_array,
  DROP CONSTRAINT IF EXISTS push_tokens_notification_time_zone_length,
  DROP CONSTRAINT IF EXISTS push_tokens_delivery_token_length,
  DROP COLUMN IF EXISTS updated_at,
  DROP COLUMN IF EXISTS state_version,
  DROP COLUMN IF EXISTS alert_state,
  DROP COLUMN IF EXISTS last_prices,
  DROP COLUMN IF EXISTS settings_discord,
  DROP COLUMN IF EXISTS settings_telegram,
  DROP COLUMN IF EXISTS settings_push,
  DROP COLUMN IF EXISTS alerts,
  DROP COLUMN IF EXISTS notification_time_zone,
  DROP COLUMN IF EXISTS delivery_token;
