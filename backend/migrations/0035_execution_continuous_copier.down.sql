DROP TABLE IF EXISTS execution_copy_errors;
DROP TABLE IF EXISTS execution_copy_reconciliation_items;
DROP TABLE IF EXISTS execution_copy_reconciliation_runs;
DROP TABLE IF EXISTS execution_copy_command_outbox;
DROP TABLE IF EXISTS execution_copy_work_items;
DROP TABLE IF EXISTS execution_copy_links;
DROP TABLE IF EXISTS execution_copy_lifecycle_inbox;

DROP INDEX IF EXISTS execution_copy_targets_runtime_idx;
DROP INDEX IF EXISTS execution_copy_groups_runtime_idx;

-- Fixed-quantity policy did not exist before this migration. Convert any such
-- rows to the safest legacy representation before restoring the old check;
-- otherwise the rollback would fail while adding that constraint.
UPDATE execution_copy_targets
SET allocation_mode = 'same_quantity',
    multiplier = 1,
    risk_basis_points = NULL,
    fixed_quantity = NULL,
    enabled = false
WHERE allocation_mode = 'fixed_quantity';

ALTER TABLE execution_copy_targets
  ALTER COLUMN enabled SET DEFAULT true,
  DROP CONSTRAINT IF EXISTS execution_copy_targets_owner_key,
  DROP CONSTRAINT IF EXISTS execution_copy_targets_fixed_quantity_check,
  DROP CONSTRAINT IF EXISTS execution_copy_targets_symbol_mapping_check,
  DROP CONSTRAINT IF EXISTS execution_copy_targets_configuration_check,
  DROP CONSTRAINT IF EXISTS execution_copy_targets_revision_check,
  DROP CONSTRAINT IF EXISTS execution_copy_targets_allocation_mode_check,
  DROP COLUMN IF EXISTS last_reconciled_at,
  DROP COLUMN IF EXISTS last_error_at,
  DROP COLUMN IF EXISTS status_message,
  DROP COLUMN IF EXISTS symbol_mapping,
  DROP COLUMN IF EXISTS configuration,
  DROP COLUMN IF EXISTS runtime_status,
  DROP COLUMN IF EXISTS applied_revision,
  DROP COLUMN IF EXISTS revision,
  DROP COLUMN IF EXISTS allocation_unit,
  DROP COLUMN IF EXISTS fixed_quantity;

ALTER TABLE execution_copy_targets
  ADD CONSTRAINT execution_copy_targets_allocation_mode_check CHECK (
    allocation_mode IN (
      'same_quantity', 'multiplier', 'equity_proportional', 'risk_percent'
    )
  );

ALTER TABLE execution_copy_groups
  ALTER COLUMN enabled SET DEFAULT true,
  DROP CONSTRAINT IF EXISTS execution_copy_groups_configuration_check,
  DROP CONSTRAINT IF EXISTS execution_copy_groups_revision_check,
  DROP COLUMN IF EXISTS last_reconciled_at,
  DROP COLUMN IF EXISTS last_event_at,
  DROP COLUMN IF EXISTS status_message,
  DROP COLUMN IF EXISTS configuration,
  DROP COLUMN IF EXISTS runtime_status,
  DROP COLUMN IF EXISTS applied_revision,
  DROP COLUMN IF EXISTS revision;
