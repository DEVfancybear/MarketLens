DROP TRIGGER IF EXISTS trg_execution_mt5_vm_commands_set_updated_at
  ON execution_mt5_vm_control_commands;
DROP TRIGGER IF EXISTS trg_execution_mt5_vm_accounts_set_updated_at
  ON execution_mt5_vm_accounts;
DROP TRIGGER IF EXISTS trg_execution_mt5_vm_workers_set_updated_at
  ON execution_mt5_vm_workers;

DROP TABLE IF EXISTS execution_mt5_vm_control_commands;
DROP TABLE IF EXISTS execution_mt5_vm_account_leases;
DROP TABLE IF EXISTS execution_mt5_vm_accounts;
DROP TABLE IF EXISTS execution_mt5_vm_workers;

ALTER TABLE execution_accounts
  DROP COLUMN IF EXISTS connector_kind;
