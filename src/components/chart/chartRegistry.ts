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

/** Capture the chart as a PNG blob. */
export async function captureChart(): Promise<Blob | null> {
  if (!mainChart) return null;
  const canvas = mainChart.takeScreenshot();
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
}
