import type { IChartApi } from "lightweight-charts";

type RemovableChart = Pick<IChartApi, "remove">;

/**
 * Lightweight Charts paints through requestAnimationFrame. React can run an
 * effect cleanup re-entrantly while that paint callback is still on the stack
 * (notably during Fast Refresh and responsive shell swaps). Removing the chart
 * synchronously in that situation disposes its canvas bindings before the
 * in-flight paint reaches the time axis and throws `Object is disposed`.
 *
 * A microtask keeps teardown effectively immediate while guaranteeing that the
 * current chart/API call stack has completely unwound first.
 */
export function removeChartAfterCurrentStack(chart: RemovableChart): void {
  queueMicrotask(() => chart.remove());
}
