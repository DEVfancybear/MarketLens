import type { Alert } from "@/store/alertStore";
import type { ServerPushAlert } from "@/types/pushAlerts";
import { normalizeAlertSymbol } from "../alertSymbols";
import { sanitizePushAlertForStorage } from "../pushAlertSanitizer";

export type PushAlertSnapshotResult =
  | { ok: true; alerts: ServerPushAlert[] }
  | { ok: false; error: string };

/**
 * Build a full replacement snapshot. One malformed row rejects the complete
 * write so a partial browser payload can never prune valid server-side alerts.
 */
export function buildPushAlertSnapshot(
  alerts: readonly Alert[],
): PushAlertSnapshotResult {
  const sanitizedAlerts = alerts.map((alert) =>
    sanitizePushAlertForStorage({
      id: alert.id,
      symbol: normalizeAlertSymbol(alert.symbol),
      condition: alert.condition,
      price: alert.price,
      note: alert.note,
      recurring: alert.recurring,
      updatedAt: Math.round((alert.updatedAt ?? alert.createdAt) * 1000),
      armingRevision: alert.armingRevision,
      lastTriggeredAt:
        alert.triggeredAt === undefined
          ? undefined
          : Math.round(alert.triggeredAt * 1000),
      triggerPrice: alert.triggerPrice,
      targetPrice: alert.evaluatedTargetPrice,
      triggerEvidence: alert.triggerEvidence,
      push: alert.push,
      telegram: alert.telegram,
      discord: alert.discord,
      technicalTarget: alert.technicalTarget,
    }),
  );
  const invalidAlertIndex = sanitizedAlerts.findIndex((alert) => !alert);
  if (invalidAlertIndex >= 0) {
    const invalidAlert = alerts[invalidAlertIndex];
    return {
      ok: false,
      error:
        `Alert ${invalidAlert?.id || invalidAlertIndex + 1} is invalid; ` +
        "the server snapshot was not changed.",
    };
  }
  return { ok: true, alerts: sanitizedAlerts as ServerPushAlert[] };
}
