import type { Drawing } from "../../../../types";

export type DrawingBulkScope =
  | { kind: "object"; drawingId: string }
  | { kind: "selected" }
  | { kind: "group"; groupId: string }
  | { kind: "all" };

export type DrawingBulkProperty = "visible" | "locked";

export function resolveDrawingBulkTargets(
  drawings: readonly Drawing[],
  selectedIds: ReadonlySet<string>,
  scope: DrawingBulkScope,
): Drawing[] {
  switch (scope.kind) {
    case "object":
      return drawings.filter((drawing) => drawing.id === scope.drawingId);
    case "selected":
      return drawings.filter((drawing) => selectedIds.has(drawing.id));
    case "group":
      return drawings.filter((drawing) => drawing.group?.id === scope.groupId);
    case "all":
      return [...drawings];
  }
}

/** Mixed sets converge to the active state; a second invocation toggles all off. */
export function nextDrawingBulkPropertyValue(
  drawings: readonly Drawing[],
  property: DrawingBulkProperty,
): boolean {
  if (drawings.length === 0) return false;
  if (property === "locked") return !drawings.every((drawing) => drawing.locked === true);
  return drawings.every((drawing) => drawing.visible === false);
}

export function drawingBulkActionLabel(
  property: DrawingBulkProperty,
  value: boolean,
): string {
  if (property === "locked") return value ? "Lock Drawings" : "Unlock Drawings";
  return value ? "Show Drawings" : "Hide Drawings";
}
