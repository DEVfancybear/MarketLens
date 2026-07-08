-- Persist the full TradingView-style watchlist layout.
-- Phase 6 originally stored only named lists plus a flat ordered symbol list.
-- The frontend now needs the backend to own the active list, list sharing flag,
-- section dividers, and symbol/section ordering so watchlist state no longer
-- depends on browser localStorage.

ALTER TABLE watchlists
  ADD COLUMN IF NOT EXISTS shared boolean NOT NULL DEFAULT false;

CREATE TABLE watchlist_sections (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  watchlist_id uuid NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE,
  title        text NOT NULL,
  symbol_index integer NOT NULL DEFAULT 0,
  position     integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_watchlist_sections_list ON watchlist_sections(watchlist_id);

CREATE TRIGGER trg_watchlist_sections_set_updated_at BEFORE UPDATE ON watchlist_sections
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE watchlist_preferences (
  user_id             uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  active_watchlist_id uuid REFERENCES watchlists(id) ON DELETE SET NULL,
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_watchlist_preferences_set_updated_at BEFORE UPDATE ON watchlist_preferences
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
