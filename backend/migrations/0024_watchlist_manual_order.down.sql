UPDATE watchlists
SET sort_key = 'symbol'
WHERE sort_key = 'manual';

ALTER TABLE watchlists
  DROP CONSTRAINT IF EXISTS chk_watchlists_sort_key;

ALTER TABLE watchlists
  ADD CONSTRAINT chk_watchlists_sort_key
    CHECK (sort_key IN ('symbol', 'price', 'change', 'changeAbs', 'volume'));
