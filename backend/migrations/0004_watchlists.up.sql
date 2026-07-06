-- Watchlists + their symbols (DATABASE.md §7.1). The frontend's single
-- localStorage `watchlist` array becomes the user's "Default" list; the schema
-- supports several named lists.

CREATE TABLE watchlists (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       text NOT NULL DEFAULT 'Default',
  position   integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_watchlists_user ON watchlists(user_id);

CREATE TRIGGER trg_watchlists_set_updated_at BEFORE UPDATE ON watchlists
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE watchlist_symbols (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  watchlist_id uuid NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE,
  symbol       text NOT NULL,
  position     integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (watchlist_id, symbol)
);
CREATE INDEX idx_watchlist_symbols_list ON watchlist_symbols(watchlist_id);
