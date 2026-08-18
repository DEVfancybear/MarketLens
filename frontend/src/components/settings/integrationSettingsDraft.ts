import type {
  IntegrationSettings,
  IntegrationSettingsWrite,
} from "@/services/api/resources/integrationsApi";

/** Must remain above mobile workspace sheets (z-index 1000). */
export const APP_SETTINGS_OVERLAY_STACK_CLASS = "z-1400";

export type IntegrationDraftField =
  | "telegram.chatId"
  | "telegram.botToken"
  | "telegram.enabled"
  | "discord.webhookUrl"
  | "discord.enabled";

export function createEmptyIntegrationDraft(): IntegrationSettingsWrite {
  return {
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
