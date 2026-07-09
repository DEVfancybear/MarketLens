DROP TRIGGER IF EXISTS trg_indicator_presets_set_updated_at ON indicator_presets;
DROP INDEX IF EXISTS idx_indicator_presets_client;
DROP INDEX IF EXISTS idx_indicator_presets_user;
DROP TABLE IF EXISTS indicator_presets;

DROP TRIGGER IF EXISTS trg_pine_scripts_set_updated_at ON pine_scripts;
DROP INDEX IF EXISTS idx_pine_scripts_client;
DROP INDEX IF EXISTS idx_pine_scripts_user;
DROP TABLE IF EXISTS pine_scripts;
