ALTER TABLE alert_events
  ADD COLUMN arming_revision bigint;

CREATE UNIQUE INDEX idx_alert_events_trigger_attempt
  ON alert_events(alert_id, arming_revision, triggered_at)
  WHERE alert_id IS NOT NULL AND arming_revision IS NOT NULL;
