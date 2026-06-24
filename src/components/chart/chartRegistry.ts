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

/** Capture the chart as a PNG blob. */
export async function captureChart(): Promise<Blob | null> {
  if (!mainChart) return null;
  const canvas = mainChart.takeScreenshot();
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
}
