DROP TRIGGER IF EXISTS trg_drawing_templates_set_updated_at ON drawing_templates;
DROP TABLE IF EXISTS drawing_templates;

DROP TRIGGER IF EXISTS trg_drawings_set_updated_at ON drawings;
DROP INDEX IF EXISTS idx_drawings_client;
DROP TABLE IF EXISTS drawings;
