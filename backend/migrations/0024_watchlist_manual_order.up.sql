-- A manual/custom sort mode makes persisted symbol positions the visible order.
-- Drag/drop writes this mode together with the full layout transaction.

ALTER TABLE watchlists
  DROP CONSTRAINT IF EXISTS chk_watchlists_sort_key;

ALTER TABLE watchlists
  ADD CONSTRAINT chk_watchlists_sort_key
    CHECK (sort_key IN ('manual', 'symbol', 'price', 'change', 'changeAbs', 'volume'));
