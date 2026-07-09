-- Phase 8: TradingView-style indicator presets.
-- Pine script source persistence is Phase 9, but the FK target must exist
-- before indicator_presets can reference custom script rows.

CREATE TABLE IF NOT EXISTS pine_scripts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  source_code text NOT NULL,
  favorite    boolean NOT NULL DEFAULT false,
  meta        jsonb NOT NULL DEFAULT '{}',
  client_id   text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pine_scripts_user ON pine_scripts(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pine_scripts_client ON pine_scripts(user_id, client_id)
  WHERE client_id IS NOT NULL;

CREATE TRIGGER trg_pine_scripts_set_updated_at BEFORE UPDATE ON pine_scripts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE indicator_presets (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  indicator_type text NOT NULL,
  script_id      uuid REFERENCES pine_scripts(id) ON DELETE SET NULL,
  config         jsonb NOT NULL DEFAULT '{}',
  visible        boolean NOT NULL DEFAULT true,
  position       integer NOT NULL DEFAULT 0,
  client_id      text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_indicator_presets_user ON indicator_presets(user_id);
CREATE UNIQUE INDEX idx_indicator_presets_client ON indicator_presets(user_id, client_id)
  WHERE client_id IS NOT NULL;

CREATE TRIGGER trg_indicator_presets_set_updated_at BEFORE UPDATE ON indicator_presets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
