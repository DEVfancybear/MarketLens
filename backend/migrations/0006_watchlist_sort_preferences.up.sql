-- Persist each watchlist's TradingView-style Sort by selection.
-- The frontend keeps a live optimistic cache, but the backend is the source of
-- truth for every watchlist action so refreshes and new sessions restore the
-- selected sort mode.

ALTER TABLE watchlists
  ADD COLUMN IF NOT EXISTS sort_key text NOT NULL DEFAULT 'symbol',
  ADD COLUMN IF NOT EXISTS sort_dir text NOT NULL DEFAULT 'asc';

ALTER TABLE watchlists
  ADD CONSTRAINT chk_watchlists_sort_key
    CHECK (sort_key IN ('symbol', 'price', 'change', 'changeAbs', 'volume')),
  ADD CONSTRAINT chk_watchlists_sort_dir
    CHECK (sort_dir IN ('asc', 'desc'));
