ALTER TABLE watchlists
  DROP CONSTRAINT IF EXISTS chk_watchlists_sort_dir,
  DROP CONSTRAINT IF EXISTS chk_watchlists_sort_key;

ALTER TABLE watchlists
  DROP COLUMN IF EXISTS sort_dir,
  DROP COLUMN IF EXISTS sort_key;
