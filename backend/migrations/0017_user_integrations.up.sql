CREATE TABLE user_integrations (
  user_id                  uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  mt5_login                text NOT NULL DEFAULT '',
  mt5_server               text NOT NULL DEFAULT '',
  mt5_password_cipher      bytea,
  telegram_chat_id         text NOT NULL DEFAULT '',
  telegram_bot_cipher      bytea,
  telegram_enabled         boolean NOT NULL DEFAULT false,
  discord_webhook_cipher   bytea,
  discord_enabled          boolean NOT NULL DEFAULT false,
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_user_integrations_set_updated_at BEFORE UPDATE ON user_integrations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
