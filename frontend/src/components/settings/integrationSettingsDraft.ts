import type {
  IntegrationSettings,
  IntegrationSettingsWrite,
} from "@/services/api/resources/integrationsApi";

/** Must remain above mobile workspace sheets (z-index 1000). */
export const APP_SETTINGS_OVERLAY_STACK_CLASS = "z-[1400]";

export type IntegrationDraftField =
  | "mt5.login"
  | "mt5.server"
  | "mt5.password"
  | "telegram.chatId"
  | "telegram.botToken"
  | "telegram.enabled"
  | "discord.webhookUrl"
  | "discord.enabled";

export function createEmptyIntegrationDraft(): IntegrationSettingsWrite {
  return {
    mt5: { login: "", server: "", password: "", clearPassword: false },
    telegram: {
      chatId: "",
      botToken: "",
      enabled: false,
      clearBotToken: false,
    },
    discord: { webhookUrl: "", enabled: false, clearWebhook: false },
  };
}

/**
 * Apply a late settings response without overwriting fields that the user has
 * already edited while the request was in flight.
 */
export function mergeLoadedIntegrationSettings(
  current: IntegrationSettingsWrite,
  loaded: IntegrationSettings,
  dirtyFields: ReadonlySet<IntegrationDraftField>,
): IntegrationSettingsWrite {
  return {
    mt5: {
      login: dirtyFields.has("mt5.login") ? current.mt5.login : loaded.mt5.login,
      server: dirtyFields.has("mt5.server") ? current.mt5.server : loaded.mt5.server,
      password: dirtyFields.has("mt5.password") ? current.mt5.password : "",
      clearPassword: dirtyFields.has("mt5.password")
        ? current.mt5.clearPassword
        : false,
    },
    telegram: {
      chatId: dirtyFields.has("telegram.chatId")
        ? current.telegram.chatId
        : loaded.telegram.chatId,
      botToken: dirtyFields.has("telegram.botToken")
        ? current.telegram.botToken
        : "",
      enabled: dirtyFields.has("telegram.enabled")
        ? current.telegram.enabled
        : loaded.telegram.enabled,
      clearBotToken: dirtyFields.has("telegram.botToken")
        ? current.telegram.clearBotToken
        : false,
    },
    discord: {
      webhookUrl: dirtyFields.has("discord.webhookUrl")
        ? current.discord.webhookUrl
        : "",
      enabled: dirtyFields.has("discord.enabled")
        ? current.discord.enabled
        : loaded.discord.enabled,
      clearWebhook: dirtyFields.has("discord.webhookUrl")
        ? current.discord.clearWebhook
        : false,
    },
  };
}
