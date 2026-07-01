import type { Alert } from "@/store/alertStore";

export interface ExternalNotificationCapabilities {
  telegram: { configured: boolean; enabled: boolean };
  discord: { configured: boolean; enabled: boolean };
}

interface ExternalSendResponse {
  error?: string;
  results?: Array<{ ok: boolean; channel: string; error?: string }>;
}

export async function getExternalNotificationCapabilities(): Promise<ExternalNotificationCapabilities> {
  const res = await fetch("/api/notifications/capabilities", {
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Notification capabilities failed (${res.status})`);
  }
  return (await res.json()) as ExternalNotificationCapabilities;
}

export async function sendExternalAlert(payload: {
  alert: Alert;
  triggerPrice: number;
  channels: { telegram?: boolean; discord?: boolean };
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch("/api/notifications/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channels: payload.channels,
        message: {
          alertId: payload.alert.id,
          symbol: payload.alert.symbol,
          condition: payload.alert.condition,
          targetPrice: payload.alert.price,
          triggerPrice: payload.triggerPrice,
          note: payload.alert.note,
          triggeredAt: Date.now(),
          source: "browser-open",
        },
      }),
    });
    const body = (await res.json().catch(() => null)) as
      | ExternalSendResponse
      | null;
    if (!res.ok || body?.results?.some((result) => !result.ok)) {
      const failed = body?.results?.find((result) => !result.ok);
      return {
        ok: false,
        error: failed?.error ?? ("error" in (body ?? {}) ? body?.error : undefined) ?? `HTTP ${res.status}`,
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
