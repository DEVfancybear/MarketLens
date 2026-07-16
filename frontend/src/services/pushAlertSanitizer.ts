import type { ServerPushAlert } from "../types/pushAlerts";
import {
  sanitizeTechnicalAlertEvidence,
  sanitizeTechnicalAlertTarget,
} from "./dynamicAlertTargets";

/** Fail-closed sanitizer shared by push sync and persisted push-device reads. */
export function sanitizePushAlertForStorage(value: unknown): ServerPushAlert | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const alert = value as Partial<ServerPushAlert>;
  if (!alert.id || !alert.symbol) return null;
  if (typeof alert.price !== "number" || !Number.isFinite(alert.price) || alert.price <= 0) {
    return null;
  }
  if (
    alert.condition !== "above" &&
    alert.condition !== "below" &&
    alert.condition !== "crossUp" &&
    alert.condition !== "crossDown"
  ) {
    return null;
  }
  const sanitized: ServerPushAlert = {
    id: String(alert.id),
    symbol: String(alert.symbol).toUpperCase(),
    condition: alert.condition,
    price: alert.price,
    recurring: Boolean(alert.recurring),
    updatedAt: typeof alert.updatedAt === "number" && Number.isFinite(alert.updatedAt)
      ? alert.updatedAt
      : Date.now(),
    armingRevision:
      typeof alert.armingRevision === "number" && Number.isFinite(alert.armingRevision)
        ? Math.max(1, Math.trunc(alert.armingRevision))
        : typeof alert.updatedAt === "number" && Number.isFinite(alert.updatedAt)
          ? Math.max(1, Math.trunc(alert.updatedAt))
          : Date.now(),
    push: Boolean(alert.push),
    telegram: Boolean(alert.telegram),
    discord: Boolean(alert.discord),
  };
  if (alert.note) sanitized.note = String(alert.note).slice(0, 240);
  if (typeof alert.lastTriggeredAt === "number" && Number.isFinite(alert.lastTriggeredAt)) {
    sanitized.lastTriggeredAt = alert.lastTriggeredAt;
  }
  if (typeof alert.triggerPrice === "number" && Number.isFinite(alert.triggerPrice)) {
    sanitized.triggerPrice = alert.triggerPrice;
  }
  if (typeof alert.targetPrice === "number" && Number.isFinite(alert.targetPrice)) {
    sanitized.targetPrice = alert.targetPrice;
  }
  const triggerEvidence = sanitizeTechnicalAlertEvidence(alert.triggerEvidence);
  if (triggerEvidence) sanitized.triggerEvidence = triggerEvidence;
  const technicalTarget = sanitizeTechnicalAlertTarget(alert.technicalTarget);
  // A supplied but malformed geometry must never degrade into a legacy scalar
  // alert at the creation-time preview price.
  if (alert.technicalTarget !== undefined && !technicalTarget) return null;
  if (technicalTarget) sanitized.technicalTarget = technicalTarget;
  return sanitized;
}
