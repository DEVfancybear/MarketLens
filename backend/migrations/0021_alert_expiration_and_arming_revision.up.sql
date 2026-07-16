ALTER TYPE alert_status ADD VALUE IF NOT EXISTS 'expired';

ALTER TABLE alerts
  ADD COLUMN arming_revision bigint NOT NULL DEFAULT 1
  CHECK (arming_revision > 0);
