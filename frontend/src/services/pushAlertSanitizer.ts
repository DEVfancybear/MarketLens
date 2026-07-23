import type { ServerPushAlert } from "../types/pushAlerts";
import {
  sanitizeTechnicalAlertEvidence,
  sanitizeTechnicalAlertTarget,
} from "./dynamicAlertTargets";
import { normalizeAlertSymbol } from "./alertSymbols";

/** Fail-closed sanitizer shared by push sync and persisted push-device reads. */
export function sanitizePushAlertForStorage(value: unknown): ServerPushAlert | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const alert = value as Partial<ServerPushAlert>;
  if (
    typeof alert.id !== "string" ||
    typeof alert.symbol !== "string" ||
    !alert.id.trim() ||
    !alert.symbol.trim()
  ) {
    return null;
  }
  const id = alert.id.trim();
  const symbol = normalizeAlertSymbol(alert.symbol);
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
  const updatedAt =
    alert.updatedAt === undefined
      ? Date.now()
      : typeof alert.updatedAt === "number" &&
          Number.isFinite(alert.updatedAt) &&
          alert.updatedAt > 0
        ? alert.updatedAt
        : undefined;
  if (updatedAt === undefined) return null;
  const armingRevision =
    alert.armingRevision === undefined
      ? Math.max(1, Math.trunc(updatedAt))
      : typeof alert.armingRevision === "number" &&
          Number.isFinite(alert.armingRevision) &&
          alert.armingRevision > 0
        ? Math.max(1, Math.trunc(alert.armingRevision))
        : undefined;
  if (armingRevision === undefined) return null;
  const sanitized: ServerPushAlert = {
    id,
    symbol,
    condition: alert.condition,
    price: alert.price,
    recurring: Boolean(alert.recurring),
    updatedAt,
    armingRevision,
    push: Boolean(alert.push),
    telegram: Boolean(alert.telegram),
    discord: Boolean(alert.discord),
  };
  if (alert.note !== undefined) {
    if (typeof alert.note !== "string") return null;
    const note = [...alert.note.trim()].slice(0, 240).join("");
    if (note) sanitized.note = note;
  }
  if (alert.lastTriggeredAt !== undefined) {
    if (
      typeof alert.lastTriggeredAt !== "number" ||
      !Number.isFinite(alert.lastTriggeredAt) ||
      alert.lastTriggeredAt <= 0
    ) {
      return null;
    }
    sanitized.lastTriggeredAt = alert.lastTriggeredAt;
  }
  if (alert.triggerPrice !== undefined) {
    if (
      typeof alert.triggerPrice !== "number" ||
      !Number.isFinite(alert.triggerPrice) ||
      alert.triggerPrice <= 0
    ) {
      return null;
    }
    sanitized.triggerPrice = alert.triggerPrice;
  }
  if (alert.targetPrice !== undefined) {
    if (
      typeof alert.targetPrice !== "number" ||
      !Number.isFinite(alert.targetPrice) ||
      alert.targetPrice <= 0
    ) {
      return null;
    }
    sanitized.targetPrice = alert.targetPrice;
  }
  const triggerEvidence = sanitizeTechnicalAlertEvidence(alert.triggerEvidence);
  if (alert.triggerEvidence !== undefined && !triggerEvidence) return null;
  if (triggerEvidence) sanitized.triggerEvidence = triggerEvidence;
  const technicalTarget = sanitizeTechnicalAlertTarget(alert.technicalTarget);
  // A supplied but malformed geometry must never degrade into a legacy scalar
  // alert at the creation-time preview price.
  if (alert.technicalTarget !== undefined && !technicalTarget) return null;
  if (technicalTarget) sanitized.technicalTarget = technicalTarget;
  return sanitized;
}
