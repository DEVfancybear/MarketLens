ALTER TABLE execution_target_commands
  DROP CONSTRAINT execution_target_commands_status_check;

ALTER TABLE execution_target_commands
  ADD CONSTRAINT execution_target_commands_status_check
  CHECK (status IN (
    'waiting', 'ready', 'rejected', 'queued', 'submitted',
    'accepted', 'partially_filled', 'filled',
    'cancelled', 'failed', 'unknown'
  ));

ALTER TABLE execution_target_commands
  ADD COLUMN deliver_by timestamptz;

ALTER TABLE execution_target_commands
  ADD CONSTRAINT execution_target_commands_waiting_deadline_check
  CHECK (status <> 'waiting' OR deliver_by IS NOT NULL);

CREATE INDEX execution_target_commands_waiting_deadline_idx
  ON execution_target_commands (deliver_by)
  WHERE status = 'waiting';
