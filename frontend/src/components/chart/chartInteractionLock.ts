import type {
  HandleScaleOptions,
  HandleScrollOptions,
  IChartApi,
} from "lightweight-charts";

interface ChartInteractionState {
  owners: Set<string>;
  restore: {
    handleScroll: HandleScrollOptions | boolean;
    handleScale: HandleScaleOptions | boolean;
  } | null;
}

const chartLocks = new WeakMap<IChartApi, ChartInteractionState>();

function currentGestureOptions(chart: IChartApi): NonNullable<ChartInteractionState["restore"]> {
  const options = chart.options();
  return {
    handleScroll: typeof options.handleScroll === "boolean"
      ? options.handleScroll
      : { ...options.handleScroll },
    handleScale: typeof options.handleScale === "boolean"
      ? options.handleScale
      : { ...options.handleScale },
  };
}

/**
 * Coordinate chart gesture ownership across drawing, alert, and Replay layers.
 * Releasing one overlay cannot re-enable pan/zoom while another still owns it.
 */
export function setChartInteractionLocked(
  chart: IChartApi,
  owner: string,
  locked: boolean,
): void {
  let state = chartLocks.get(chart);
  if (!state) {
    state = { owners: new Set<string>(), restore: null };
    chartLocks.set(chart, state);
  }

  if (locked) {
    if (state.owners.has(owner)) return;
    if (state.owners.size === 0) {
      state.restore = currentGestureOptions(chart);
      chart.applyOptions({ handleScroll: false, handleScale: false });
    }
    state.owners.add(owner);
    return;
  }

  if (!state.owners.delete(owner) || state.owners.size > 0) return;
  const restore = state.restore;
  state.restore = null;
  if (restore) chart.applyOptions(restore);
}

export function chartInteractionLockCount(chart: IChartApi): number {
  return chartLocks.get(chart)?.owners.size ?? 0;
}
