DROP TABLE IF EXISTS watchlist_preferences;
DROP TABLE IF EXISTS watchlist_sections;

ALTER TABLE watchlists
  DROP COLUMN IF EXISTS shared;
