WITH expired AS (
  UPDATE execution_target_commands
  SET status = 'failed',
      reject_code = 'DEFERRED_DELIVERY_DISABLED',
      reject_message = 'Offline copy waiting was disabled by rollback',
      terminal_ack_at = now(),
      lease_owner = NULL,
      lease_expires_at = NULL,
      updated_at = now()
  WHERE status = 'waiting'
  RETURNING user_id, parent_command_id
)
UPDATE execution_commands parent
SET status = 'partially_rejected',
    updated_at = now()
WHERE (parent.user_id, parent.id) IN (
  SELECT DISTINCT user_id, parent_command_id
  FROM expired
);

DROP INDEX IF EXISTS execution_target_commands_waiting_deadline_idx;

ALTER TABLE execution_target_commands
  DROP CONSTRAINT execution_target_commands_waiting_deadline_check;

ALTER TABLE execution_target_commands
  DROP COLUMN deliver_by;

ALTER TABLE execution_target_commands
  DROP CONSTRAINT execution_target_commands_status_check;

ALTER TABLE execution_target_commands
  ADD CONSTRAINT execution_target_commands_status_check
  CHECK (status IN (
    'ready', 'rejected', 'queued', 'submitted',
    'accepted', 'partially_filled', 'filled',
    'cancelled', 'failed', 'unknown'
  ));
