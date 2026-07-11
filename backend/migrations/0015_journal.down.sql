DROP TRIGGER IF EXISTS trg_journal_entries_set_updated_at ON journal_entries;
DROP TRIGGER IF EXISTS trg_screenshots_enqueue_blob_delete ON screenshots;
DROP FUNCTION IF EXISTS enqueue_screenshot_blob_deletion();
DROP TABLE IF EXISTS object_deletion_queue;
DROP TABLE IF EXISTS screenshots;
DROP TABLE IF EXISTS journal_entries;
DROP TYPE IF EXISTS screenshot_phase;
DROP TYPE IF EXISTS trade_side;
