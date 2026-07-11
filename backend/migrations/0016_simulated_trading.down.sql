ALTER TABLE journal_entries DROP CONSTRAINT IF EXISTS journal_entries_position_id_fkey;
DROP TRIGGER IF EXISTS trg_sim_positions_set_updated_at ON sim_positions;
DROP TRIGGER IF EXISTS trg_sim_accounts_set_updated_at ON sim_accounts;
DROP TABLE IF EXISTS sim_positions;
DROP TABLE IF EXISTS sim_accounts;
DROP TYPE IF EXISTS position_status;
DROP TYPE IF EXISTS order_type;
