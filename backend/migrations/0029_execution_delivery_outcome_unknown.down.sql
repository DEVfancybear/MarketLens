WITH reverted AS (
  UPDATE execution_target_commands
  SET status = 'failed',
      reject_code = 'DELIVERY_EXPIRED',
      reject_message =
        'EA did not acknowledge the command before its delivery deadline',
      terminal_ack_at = now(),
      updated_at = now()
  WHERE status = 'unknown'
    AND reject_code = 'DELIVERY_OUTCOME_UNKNOWN'
    AND first_delivered_at IS NOT NULL
  RETURNING user_id, parent_command_id
)
UPDATE execution_commands parent
SET status = CASE
      WHEN EXISTS (
        SELECT 1
        FROM execution_target_commands target
        WHERE target.user_id = parent.user_id
          AND target.parent_command_id = parent.id
          AND target.terminal_ack_at IS NULL
      ) THEN 'submitted'
      ELSE 'partially_rejected'
    END,
    updated_at = now()
WHERE (parent.user_id, parent.id) IN (
  SELECT DISTINCT user_id, parent_command_id
  FROM reverted
);
