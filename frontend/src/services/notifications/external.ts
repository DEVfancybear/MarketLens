import type { Alert } from "@/store/alertStore";
import { deliverIntegrationAlert, getIntegrationSettings } from "@/services/api/resources/integrationsApi";

export interface ExternalNotificationCapabilities {
  telegram: { configured: boolean; enabled: boolean };
  discord: { configured: boolean; enabled: boolean };
}

export async function getExternalNotificationCapabilities(): Promise<ExternalNotificationCapabilities> {
  const settings = await getIntegrationSettings();
  return {
    telegram: { configured: settings.telegram.botTokenConfigured && Boolean(settings.telegram.chatId), enabled: settings.telegram.enabled },
    discord: { configured: settings.discord.webhookConfigured, enabled: settings.discord.enabled },
  };
}

export async function sendExternalAlert(payload: {
  alert: Alert;
  triggerPrice: number;
  targetPrice: number;
  channels: { telegram?: boolean; discord?: boolean };
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const body = await deliverIntegrationAlert({
      channels: payload.channels,
      message: {
        alertId: payload.alert.id,
        symbol: payload.alert.symbol,
        condition: payload.alert.condition,
        targetPrice: payload.targetPrice,
        triggerPrice: payload.triggerPrice,
        note: payload.alert.note,
        triggeredAt: Date.now(),
        source: "browser-open",
      },
    });
    if (body?.results?.some((result) => !result.ok)) {
      const failed = body?.results?.find((result) => !result.ok);
      return {
        ok: false,
        error: failed?.error ?? "External delivery failed",
      };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "External alert send failed.",
    };
  }
}
