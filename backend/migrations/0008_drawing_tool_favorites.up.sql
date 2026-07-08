-- Phase 7 follow-up: TradingView-style drawing tool favorites.
-- This stores the ordered star list from the drawing flyouts/floating toolbar
-- (`tv:favTools` in the old frontend localStorage model) per authenticated user.

CREATE TABLE drawing_tool_favorites (
  user_id    uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  tools      jsonb NOT NULL DEFAULT '[]',
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_drawing_tool_favorites_array CHECK (jsonb_typeof(tools) = 'array')
);

CREATE TRIGGER trg_drawing_tool_favorites_set_updated_at BEFORE UPDATE ON drawing_tool_favorites
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
