CREATE TYPE trade_side AS ENUM ('long', 'short');
CREATE TYPE screenshot_phase AS ENUM ('before', 'after-entry', 'after-exit');

CREATE TABLE journal_entries (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol       text NOT NULL CHECK (length(btrim(symbol)) BETWEEN 1 AND 80),
  side         trade_side NOT NULL,
  entry_time   timestamptz NOT NULL,
  exit_time    timestamptz,
  entry_price  numeric(20,8) NOT NULL CHECK (entry_price > 0),
  exit_price   numeric(20,8) CHECK (exit_price > 0),
  quantity     numeric(20,8) NOT NULL CHECK (quantity > 0),
  pnl          numeric(20,8),
  rr           numeric(20,8),
  risk_amount  numeric(20,8) CHECK (risk_amount >= 0),
  notes        text,
  tags         text[] NOT NULL DEFAULT '{}',
  -- Phase 13's sim_positions table is not present yet. Add its FK in that phase.
  position_id  uuid,
  client_id    text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, client_id)
);
CREATE INDEX idx_journal_user ON journal_entries(user_id, entry_time DESC, id DESC);
CREATE INDEX idx_journal_symbol ON journal_entries(user_id, symbol);
CREATE INDEX idx_journal_tags ON journal_entries USING gin (tags);

CREATE TABLE screenshots (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  journal_entry_id  uuid NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  phase             screenshot_phase NOT NULL,
  storage_key       text NOT NULL UNIQUE,
  thumbnail_key     text,
  width             integer CHECK (width IS NULL OR width > 0),
  height            integer CHECK (height IS NULL OR height > 0),
  size_bytes        bigint CHECK (size_bytes IS NULL OR size_bytes >= 0),
  content_type      text NOT NULL DEFAULT 'image/png',
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_screenshots_user ON screenshots(user_id);
CREATE INDEX idx_screenshots_entry ON screenshots(journal_entry_id, created_at, id);

-- Durable hand-off for a future blob cleanup worker. The trigger also covers
-- account deletion and FK cascades, not only explicit screenshot API deletes.
CREATE TABLE object_deletion_queue (
  id           bigserial PRIMARY KEY,
  storage_key  text NOT NULL UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  attempts     integer NOT NULL DEFAULT 0,
  last_error   text
);

CREATE FUNCTION enqueue_screenshot_blob_deletion() RETURNS trigger AS $$
BEGIN
  INSERT INTO object_deletion_queue (storage_key)
  VALUES (OLD.storage_key)
  ON CONFLICT (storage_key) DO NOTHING;
  IF OLD.thumbnail_key IS NOT NULL THEN
    INSERT INTO object_deletion_queue (storage_key)
    VALUES (OLD.thumbnail_key)
    ON CONFLICT (storage_key) DO NOTHING;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_screenshots_enqueue_blob_delete
BEFORE DELETE ON screenshots
FOR EACH ROW EXECUTE FUNCTION enqueue_screenshot_blob_deletion();

CREATE TRIGGER trg_journal_entries_set_updated_at BEFORE UPDATE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
