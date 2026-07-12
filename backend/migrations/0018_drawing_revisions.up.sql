-- Phase 5: optimistic drawing revisions and delete tombstones.
ALTER TABLE drawings
  ADD COLUMN revision bigint NOT NULL DEFAULT 1,
  ADD COLUMN client_revision bigint NOT NULL DEFAULT 0,
  ADD COLUMN deleted_at timestamptz;

CREATE INDEX idx_drawings_tombstones
  ON drawings(user_id, updated_at)
  WHERE deleted_at IS NOT NULL;
