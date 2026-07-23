import type { DrawingAlertSnapshot } from "@/components/chart/drawing/alerts/drawingAlertCapabilities";
import type { AlertCondition } from "@/store/alertStore";

export const ALERT_CONDITIONS = new Set<AlertCondition>([
  "above",
  "below",
  "crossUp",
  "crossDown",
]);

export function isAlertCondition(value: unknown): value is AlertCondition {
  return typeof value === "string" && ALERT_CONDITIONS.has(value as AlertCondition);
}

export function sanitizeAlertNote(value: unknown, maxLength = 500): string | undefined {
  if (typeof value !== "string") return undefined;
  const note = value.trim();
  if (!note) return undefined;
  return [...note].slice(0, maxLength).join("");
}

export function sanitizeAlertSource(
  value: unknown,
): DrawingAlertSnapshot | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const source = value as Record<string, unknown>;
  if (source.kind !== "drawing") return undefined;
  const drawingId =
    typeof source.drawingId === "string" ? source.drawingId.trim() : "";
  const drawingTool =
    typeof source.drawingTool === "string" ? source.drawingTool.trim() : "";
  const targetId =
    typeof source.targetId === "string" ? source.targetId.trim() : "";
  const targetLabel =
    typeof source.targetLabel === "string" ? source.targetLabel.trim() : "";
  const snapshotAt =
    typeof source.snapshotAt === "number" ? source.snapshotAt : Number.NaN;
  if (
    !drawingId ||
    !drawingTool ||
    !targetId ||
    !targetLabel ||
    !Number.isFinite(snapshotAt) ||
    snapshotAt <= 0
  ) {
    return undefined;
  }
  return {
    kind: "drawing",
    drawingId,
    drawingTool: drawingTool as DrawingAlertSnapshot["drawingTool"],
    targetId,
    targetLabel,
    snapshotAt,
  };
}
