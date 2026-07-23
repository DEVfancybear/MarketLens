import type { Drawing } from "../../../../types";

export type DrawingBulkScope =
  | { kind: "object"; drawingId: string }
  | { kind: "selected" }
  | { kind: "group"; groupId: string }
  | { kind: "all" };

export type DrawingBulkProperty = "visible" | "locked";

export type DrawingBulkPatch =
  | Partial<Drawing>
  | ((drawing: Drawing) => Partial<Drawing> | null);

export interface DrawingBulkPatchChange {
  id: string;
  newProps: Partial<Drawing>;
  oldProps: Partial<Drawing>;
}

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

/**
 * Builds reversible per-object changes for a bulk style action. A patch factory
 * can skip incompatible drawings (for example, fill colour on a line tool),
 * while old values are retained so the whole action can be undone in one step.
 */
export function buildDrawingBulkPatchChanges(
  drawings: readonly Drawing[],
  patch: DrawingBulkPatch,
): DrawingBulkPatchChange[] {
  const patchFactory = typeof patch === "function" ? patch : () => patch;

  return drawings.flatMap((drawing) => {
    const newProps = patchFactory(drawing);
    if (!newProps) return [];

    const keys = Object.keys(newProps) as Array<keyof Drawing>;
    if (
      keys.length === 0 ||
      keys.every((key) => Object.is(drawing[key], newProps[key]))
    ) return [];

    const oldProps = Object.fromEntries(
      keys.map((key) => [key, drawing[key]]),
    ) as Partial<Drawing>;
    return [{ id: drawing.id, newProps, oldProps }];
  });
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
