export interface PaneLegendRect {
  top: number;
  height: number;
}

export interface PaneLegendMeasurement {
  id: string;
  rect: PaneLegendRect;
}

export const PANE_LEGEND_TOP_INSET = 4;

/**
 * Convert native Lightweight Charts pane rectangles into chart-local legend
 * offsets. Invalid or not-yet-laid-out panes are omitted so legends never
 * flash at the main chart origin while the native pane tree is settling.
 */
export function resolvePaneLegendTops(
  chartRect: PaneLegendRect,
  panes: readonly PaneLegendMeasurement[],
): Record<string, number> {
  if (
    !Number.isFinite(chartRect.top) ||
    !Number.isFinite(chartRect.height) ||
    chartRect.height <= 0
  ) {
    return {};
  }
  const maximumTop = Math.max(0, chartRect.height - PANE_LEGEND_TOP_INSET);
  return Object.fromEntries(
    panes.flatMap(({ id, rect }) => {
      if (
        !id ||
        !Number.isFinite(rect.top) ||
        !Number.isFinite(rect.height) ||
        rect.height <= 0
      ) {
        return [];
      }
      const localTop = rect.top - chartRect.top + PANE_LEGEND_TOP_INSET;
      if (!Number.isFinite(localTop)) return [];
      return [[id, Math.min(maximumTop, Math.max(0, localTop))] as const];
    }),
  );
}

export function paneLegendTopsEqual(
  left: Readonly<Record<string, number>>,
  right: Readonly<Record<string, number>>,
): boolean {
  const leftEntries = Object.entries(left);
  const rightKeys = Object.keys(right);
  return leftEntries.length === rightKeys.length &&
    leftEntries.every(([id, top]) => right[id] === top);
}
