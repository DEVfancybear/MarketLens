import type { IChartApi } from 'lightweight-charts';

/**
 * Module-level handle to the main chart instance so toolbar actions
 * (screenshot, fit-content) can reach it without prop drilling.
 */
let mainChart: IChartApi | null = null;

export function setMainChart(chart: IChartApi | null) {
  mainChart = chart;
}

export function getMainChart(): IChartApi | null {
  return mainChart;
}

/**
 * Reset the chart viewport to its default (TradingView "Reset chart view"):
 * restores default bar spacing + scroll position and re-enables price autoscale.
 */
export function resetChartView(): boolean {
  if (!mainChart) return false;
  mainChart.timeScale().resetTimeScale();
  mainChart.timeScale().scrollToRealTime();
  mainChart.priceScale("right").applyOptions({ autoScale: true });
  return true;
}

/**
 * Capture the chart as a PNG blob — TradingView-style, i.e. WITH every overlay.
 *
 * `IChartApi.takeScreenshot()` only renders lightweight-charts' own canvases
 * (candles, grid, axes, native price lines). The drawing tools, long/short
 * positions and SMC overlays live on separate `<canvas>` elements stacked over
 * the chart, so we composite each of those onto the base screenshot at its
 * on-screen position, scaled to the screenshot's pixel resolution.
 */
export async function captureChart(): Promise<Blob | null> {
  if (!mainChart) return null;
  const shot = mainChart.takeScreenshot();
  try {
    const chartEl = mainChart.chartElement();
    const g = shot.getContext("2d");
    if (g && chartEl) {
      // The overlay canvases (drawings, positions, SMC) are siblings of the
      // lightweight-charts element, NOT inside it: `chartElement()` returns LWC's
      // own `div.tv-lightweight-charts`, whose parent is the createChart()
      // container — the overlays live one level higher. Walk up ancestors until
      // we reach a scope that actually contains non-LWC canvases.
      let scope: HTMLElement | null = chartEl.parentElement;
      let overlays: HTMLCanvasElement[] = [];
      while (scope) {
        overlays = Array.from(scope.querySelectorAll("canvas")).filter(
          (cv) => !chartEl.contains(cv) && cv.width > 0 && cv.height > 0,
        );
        if (overlays.length > 0) break;
        scope = scope.parentElement;
      }
      const base = chartEl.getBoundingClientRect();
      const scaleX = base.width ? shot.width / base.width : 1;
      const scaleY = base.height ? shot.height / base.height : 1;
      // Draw in ascending z-index so stacking order matches what the user sees.
      overlays
        .map((cv) => ({ cv, z: Number(getComputedStyle(cv).zIndex) || 0 }))
        .sort((a, b) => a.z - b.z)
        .forEach(({ cv }) => {
          const r = cv.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return;
          g.drawImage(
            cv,
            (r.left - base.left) * scaleX,
            (r.top - base.top) * scaleY,
            r.width * scaleX,
            r.height * scaleY,
          );
        });
    }
  } catch {
    /* If compositing fails for any reason, fall back to the chart-only shot. */
  }
  return new Promise((resolve) => {
    try {
      shot.toBlob((b) => resolve(b), "image/png");
    } catch {
      // toBlob can throw (e.g. a tainted canvas after compositing). Retry with a
      // clean chart-only screenshot so the user still gets a usable image.
      try {
        mainChart!
          .takeScreenshot()
          .toBlob((b) => resolve(b), "image/png");
      } catch {
        resolve(null);
      }
    }
  });
}
