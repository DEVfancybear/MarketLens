DROP INDEX IF EXISTS idx_drawings_tombstones;

ALTER TABLE drawings
  DROP COLUMN IF EXISTS deleted_at,
  DROP COLUMN IF EXISTS client_revision,
  DROP COLUMN IF EXISTS revision;
