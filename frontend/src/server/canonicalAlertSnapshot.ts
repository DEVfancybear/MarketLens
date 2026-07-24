import { sanitizePushAlertForStorage } from "../services/pushAlertSanitizer";
import type { ServerPushAlert } from "../types/pushAlerts";

interface CanonicalAlertSnapshotOptions {
  apiBase?: string;
  workerSecret?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

interface BackendAlertChannels {
  push?: unknown;
  telegram?: unknown;
  discord?: unknown;
}

interface BackendWorkerAlert {
  id?: unknown;
  clientId?: unknown;
  symbol?: unknown;
  condition?: unknown;
  price?: unknown;
  note?: unknown;
  status?: unknown;
  enabled?: unknown;
  recurring?: unknown;
  channels?: unknown;
  triggerPrice?: unknown;
  triggeredAt?: unknown;
  updatedAt?: unknown;
  armingRevision?: unknown;
  technicalTarget?: unknown;
}

function backendBase(configured?: string): string {
  return (configured?.trim() || "http://localhost:8080").replace(/\/+$/, "");
}

function timestampMillis(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) return undefined;
    return value >= 100_000_000_000 ? value : value * 1000;
  }
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function decodeBackendAlert(value: unknown): ServerPushAlert | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as BackendWorkerAlert;
  if (row.status !== "active" || row.enabled !== true) return null;
  if (typeof row.recurring !== "boolean") return null;
  if (
    !row.channels ||
    typeof row.channels !== "object" ||
    Array.isArray(row.channels)
  ) {
    return null;
  }
  const channels = row.channels as BackendAlertChannels;
  if (
    typeof channels.push !== "boolean" ||
    typeof channels.telegram !== "boolean" ||
    typeof channels.discord !== "boolean"
  ) {
    return null;
  }
  const id =
    typeof row.clientId === "string" && row.clientId.trim()
      ? row.clientId.trim()
      : typeof row.id === "string"
        ? row.id.trim()
        : "";
  const updatedAt = timestampMillis(row.updatedAt);
  if (!id || updatedAt === undefined) return null;
  const lastTriggeredAt = timestampMillis(row.triggeredAt);
  const triggerPrice =
    typeof row.triggerPrice === "number" &&
    Number.isFinite(row.triggerPrice) &&
    row.triggerPrice > 0
      ? row.triggerPrice
      : undefined;
  if (
    (row.triggeredAt !== undefined && lastTriggeredAt === undefined) ||
    (row.triggerPrice !== undefined && triggerPrice === undefined) ||
    (lastTriggeredAt === undefined) !== (triggerPrice === undefined)
  ) {
    return null;
  }

  return sanitizePushAlertForStorage({
    id,
    symbol: row.symbol,
    condition: row.condition,
    price: row.price,
    note: row.note,
    recurring: row.recurring,
    updatedAt,
    armingRevision: row.armingRevision,
    lastTriggeredAt,
    triggerPrice,
    push: channels.push,
    telegram: channels.telegram,
    discord: channels.discord,
    technicalTarget: row.technicalTarget,
  });
}

/**
 * Returns PostgreSQL's active alert definitions for a signed owner. The
 * browser snapshot remains only a temporary fallback during backend outages.
 */
export async function fetchCanonicalActiveAlerts(
  deliveryToken: string | undefined,
  options: CanonicalAlertSnapshotOptions = {},
): Promise<ServerPushAlert[]> {
  const token = deliveryToken?.trim();
  const workerSecret =
    options.workerSecret ?? process.env.PUSH_WORKER_SECRET ?? "";
  if (!token) throw new Error("Missing signed alert delivery token.");
  if (!workerSecret.trim()) {
    throw new Error("PUSH_WORKER_SECRET is not configured.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 8_000);
  try {
    const response = await (options.fetchImpl ?? fetch)(
      `${backendBase(
        options.apiBase ?? process.env.NEXT_PUBLIC_API_BASE_URL,
      )}/api/v1/alerts/worker-snapshot`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-push-worker-secret": workerSecret,
        },
        body: JSON.stringify({ deliveryToken: token }),
        cache: "no-store",
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      throw new Error(
        `Canonical alert snapshot failed (${response.status} ${response.statusText}).`,
      );
    }
    const payload = (await response.json().catch(() => null)) as {
      ok?: unknown;
      alerts?: unknown;
    } | null;
    if (!payload || payload.ok !== true || !Array.isArray(payload.alerts)) {
      throw new Error("Backend returned an invalid alert snapshot.");
    }
    const alerts = payload.alerts.map(decodeBackendAlert);
    if (alerts.some((alert) => alert === null)) {
      throw new Error("Backend returned an invalid alert.");
    }
    return alerts as ServerPushAlert[];
  } finally {
    clearTimeout(timeout);
  }
}
