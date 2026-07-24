import type { Drawing, DrawingSyncBinding, DrawingSyncMode } from "../../../../types";

/**
 * New objects belong to the pane where they were created unless the user
 * explicitly opts into one of the synchronization scopes.
 */
export const DEFAULT_DRAWING_SYNC_MODE: DrawingSyncMode = "chart-only";
export const DRAWING_SYNC_MODE_VERSION = 2;
export const DEFAULT_DRAWING_CHART_ID = "main";
export const DEFAULT_DRAWING_LAYOUT_ID = "workspace";

export interface DrawingSyncContext {
  symbol: string;
  layoutId: string;
  chartId: string;
}

export function normalizeDrawingSyncMode(value: unknown): DrawingSyncMode {
  return value === "chart-only" || value === "layout-symbol" || value === "global"
    ? value
    : DEFAULT_DRAWING_SYNC_MODE;
}

/** Migrates the former implicit global default without changing versioned choices. */
export function resolveDrawingSyncModeSetting(
  value: unknown,
  version: unknown,
): { mode: DrawingSyncMode; needsMigration: boolean } {
  const mode = normalizeDrawingSyncMode(value);
  const needsMigration = Number(version) !== DRAWING_SYNC_MODE_VERSION;
  return {
    mode: needsMigration && mode === "global" ? DEFAULT_DRAWING_SYNC_MODE : mode,
    needsMigration,
  };
}

export function drawingSyncBinding(
  mode: DrawingSyncMode,
  context: DrawingSyncContext,
): DrawingSyncBinding {
  if (mode === "global") return { mode, symbol: context.symbol };
  if (mode === "layout-symbol") {
    return { mode, symbol: context.symbol, layoutId: context.layoutId };
  }
  return {
    mode,
    symbol: context.symbol,
    layoutId: context.layoutId,
    chartId: context.chartId,
  };
}

export function drawingSyncMode(drawing: Pick<Drawing, "sync">): DrawingSyncMode {
  return normalizeDrawingSyncMode(drawing.sync?.mode);
}

export function drawingBelongsToSyncContext(
  drawing: Pick<Drawing, "sync">,
  context: DrawingSyncContext,
): boolean {
  const binding = drawing.sync;
  if (!binding) return true;
  if (binding.symbol !== context.symbol) return false;
  if (binding.mode === "global") return true;
  if (binding.layoutId !== context.layoutId) return false;
  return binding.mode === "layout-symbol" || binding.chartId === context.chartId;
}

export function selectDrawingsForSyncContext(
  registry: readonly Drawing[],
  context: DrawingSyncContext,
): Drawing[] {
  return registry.filter((drawing) => drawingBelongsToSyncContext(drawing, context));
}

/** Rebinds layout/chart scoped objects when a layout is saved as a new identity. */
export function rebindDrawingsToSyncContext(
  drawings: readonly Drawing[],
  context: DrawingSyncContext,
): Drawing[] {
  return drawings.map((drawing) => {
    const mode = drawingSyncMode(drawing);
    return mode === "global"
      ? drawing
      : { ...drawing, sync: drawingSyncBinding(mode, context) };
  });
}

/** Replaces only the active context slice and preserves drawings owned by other layouts/charts. */
export function mergeDrawingSyncRegistry(
  registry: readonly Drawing[],
  activeDrawings: readonly Drawing[],
  context: DrawingSyncContext,
): Drawing[] {
  const activeIds = new Set(activeDrawings.map((drawing) => drawing.id));
  const preserved = registry.filter(
    (drawing) =>
      !activeIds.has(drawing.id) && !drawingBelongsToSyncContext(drawing, context),
  );
  return [...preserved, ...activeDrawings];
}

export function canGroupDrawingsBySyncMode(drawings: readonly Drawing[]): boolean {
  if (drawings.length < 2) return false;
  const mode = drawingSyncMode(drawings[0]);
  return drawings.every((drawing) => drawingSyncMode(drawing) === mode);
}

export const DRAWING_SYNC_MODE_OPTIONS: readonly {
  id: DrawingSyncMode;
  label: string;
  description: string;
}[] = [
  { id: "chart-only", label: "No sync", description: "Only this chart" },
  { id: "layout-symbol", label: "Sync in layout", description: "Same symbol in this layout" },
  { id: "global", label: "Sync globally", description: "Same symbol in every layout" },
];
