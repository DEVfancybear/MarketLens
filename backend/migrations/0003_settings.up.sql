-- User workspace/preferences (DATABASE.md section 6).
-- Phase 5 owns user_settings and creates layouts early so later resource
-- phases can store/load full chart snapshots without another settings migration.

CREATE TABLE user_settings (
  user_id       uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  ui            jsonb NOT NULL DEFAULT '{}',
  smc           jsonb NOT NULL DEFAULT '{}',
  chart         jsonb NOT NULL DEFAULT '{}',
  notifications jsonb NOT NULL DEFAULT '{}',
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_user_settings_set_updated_at BEFORE UPDATE ON user_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE layouts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       text NOT NULL,
  symbol     text,
  timeframe  text,
  state      jsonb NOT NULL DEFAULT '{}',
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_layouts_user ON layouts(user_id);
CREATE UNIQUE INDEX idx_layouts_default_per_user ON layouts(user_id)
  WHERE is_default;

CREATE TRIGGER trg_layouts_set_updated_at BEFORE UPDATE ON layouts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
