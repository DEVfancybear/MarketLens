-- Public indicator store.
-- Published scripts are readable without auth so every visitor can add public
-- indicators to their chart. Only the owner can publish/update a row through
-- the authenticated pine-scripts route.

CREATE TABLE public_pine_scripts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  script_id   uuid NOT NULL REFERENCES pine_scripts(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  source_code text NOT NULL,
  meta        jsonb NOT NULL DEFAULT '{}',
  boosts      integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (script_id)
);

CREATE INDEX idx_public_pine_scripts_user ON public_pine_scripts(user_id);
CREATE INDEX idx_public_pine_scripts_updated ON public_pine_scripts(updated_at DESC);

CREATE TRIGGER trg_public_pine_scripts_set_updated_at BEFORE UPDATE ON public_pine_scripts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
