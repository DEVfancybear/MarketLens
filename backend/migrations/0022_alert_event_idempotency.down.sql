DROP INDEX IF EXISTS idx_alert_events_trigger_attempt;

ALTER TABLE alert_events
  DROP COLUMN IF EXISTS arming_revision;
