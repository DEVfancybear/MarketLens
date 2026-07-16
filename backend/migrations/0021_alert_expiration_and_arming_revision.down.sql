-- PostgreSQL enums do not support DROP VALUE. Convert expired rows before an
-- application rollback, but deliberately retain the harmless enum label rather
-- than rebuilding alert_status and every dependent column/index in place.
UPDATE alerts SET status = 'active'::alert_status WHERE status::text = 'expired';

ALTER TABLE alerts
  DROP COLUMN IF EXISTS arming_revision;
