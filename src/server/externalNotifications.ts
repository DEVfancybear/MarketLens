import type { PushAlertCondition } from "@/types/pushAlerts";

export type ExternalAlertChannel = "telegram" | "discord";
export type ExternalAlertSource = "browser-open" | "closed-browser-worker" | "test";

export interface ExternalAlertMessage {
  alertId: string;
  symbol: string;
  condition: PushAlertCondition;
  targetPrice: number;
  triggerPrice: number;
  note?: string;
  triggeredAt: number;
  source: ExternalAlertSource;
}

export interface ExternalChannelStatus {
  configured: boolean;
  enabled: boolean;
}

export interface ExternalCapabilities {
  telegram: ExternalChannelStatus;
  discord: ExternalChannelStatus;
}

export interface ExternalDeliveryResult {
  channel: ExternalAlertChannel;
  ok: boolean;
  error?: string;
}

const CONDITION_TEXT: Record<PushAlertCondition, string> = {
  above: "above",
  below: "below",
  crossUp: "crossed up",
  crossDown: "crossed down",
};

function envEnabled(name: string): boolean {
  return process.env[name] === "true";
}

function timeoutMs(): number {
  const value = Number(process.env.ALERT_WEBHOOK_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : 5000;
}

export function externalNotificationCapabilities(): ExternalCapabilities {
  const telegramConfigured = Boolean(
    process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID,
  );
  const discordConfigured = Boolean(process.env.DISCORD_WEBHOOK_URL);
  return {
    telegram: {
      configured: telegramConfigured,
      enabled: telegramConfigured && envEnabled("TELEGRAM_ALERTS_ENABLED"),
    },
    discord: {
      configured: discordConfigured,
      enabled: discordConfigured && envEnabled("DISCORD_ALERTS_ENABLED"),
    },
  };
}

export function formatExternalAlertMessage(message: ExternalAlertMessage): string {
  const lines = [
    "Trading alert triggered",
    `${message.symbol} ${CONDITION_TEXT[message.condition]} ${message.targetPrice}`,
    `Trigger price: ${message.triggerPrice}`,
    `Time: ${new Date(message.triggeredAt).toISOString()}`,
  ];
  if (message.note) lines.push(`Note: ${message.note}`);
  if (message.source !== "test") lines.push(`Source: ${message.source}`);
  return lines.join("\n");
}

function sanitizeError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message.slice(0, 240);
  return fallback;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs());
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function sendTelegram(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) throw new Error("Telegram alerts are not configured.");

  const res = await fetchWithTimeout(
    `https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
      }),
      cache: "no-store",
    },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as
      | { description?: string }
      | null;
    throw new Error(body?.description ?? `Telegram request failed (${res.status})`);
  }
}

async function sendDiscord(text: string): Promise<void> {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) throw new Error("Discord alerts are not configured.");

  const res = await fetchWithTimeout(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content: text,
      allowed_mentions: { parse: [] },
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Discord request failed (${res.status})`);
  }
}

export async function sendExternalAlertNotifications(
  message: ExternalAlertMessage,
  channels: Partial<Record<ExternalAlertChannel, boolean>>,
): Promise<ExternalDeliveryResult[]> {
  const capabilities = externalNotificationCapabilities();
  const text = formatExternalAlertMessage(message);
  const jobs: Array<Promise<ExternalDeliveryResult>> = [];

  if (channels.telegram && capabilities.telegram.enabled) {
    jobs.push(
      sendTelegram(text)
        .then(() => ({ channel: "telegram" as const, ok: true }))
        .catch((error) => ({
          channel: "telegram" as const,
          ok: false,
          error: sanitizeError(error, "Telegram send failed."),
        })),
    );
  }

  if (channels.discord && capabilities.discord.enabled) {
    jobs.push(
      sendDiscord(text)
        .then(() => ({ channel: "discord" as const, ok: true }))
        .catch((error) => ({
          channel: "discord" as const,
          ok: false,
          error: sanitizeError(error, "Discord send failed."),
        })),
    );
  }

  return Promise.all(jobs);
}
