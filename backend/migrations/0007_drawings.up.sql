-- Phase 7: chart drawings and reusable drawing style templates.
-- Drawings are high-write-volume objects, so the API syncs them by client_id
-- and stores the frontend payload verbatim in jsonb. The backend scopes and
-- deduplicates rows but never interprets geometry or style fields.

CREATE TABLE drawings (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol     text NOT NULL,
  tool_type  text NOT NULL,
  payload    jsonb NOT NULL,
  locked     boolean NOT NULL DEFAULT false,
  hidden     boolean NOT NULL DEFAULT false,
  client_id  text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_drawings_user_symbol ON drawings(user_id, symbol);
CREATE UNIQUE INDEX idx_drawings_client ON drawings(user_id, client_id)
  WHERE client_id IS NOT NULL;

CREATE TRIGGER trg_drawings_set_updated_at BEFORE UPDATE ON drawings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE drawing_templates (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       text NOT NULL,
  family     text NOT NULL,
  style      jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name, family)
);

CREATE INDEX idx_drawing_templates_user ON drawing_templates(user_id);

CREATE TRIGGER trg_drawing_templates_set_updated_at BEFORE UPDATE ON drawing_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
