import type { IChartApi } from "lightweight-charts";

export interface ChartPaneMetrics {
  paneCount: number;
  plotAreaWidths: number[];
  widthDrift: number;
  timeScaleWidth: number;
}

/** Measure native pane plot widths after autoscale, resize, or pane changes. */
export function measureChartPaneMetrics(chart: IChartApi): ChartPaneMetrics {
  const plotAreaWidths = chart.panes().map((pane) =>
    pane.getHTMLElement()?.getBoundingClientRect().width ?? 0
  );
  const finite = plotAreaWidths.filter((width) => Number.isFinite(width) && width > 0);
  const widthDrift = finite.length > 1
    ? Math.max(...finite) - Math.min(...finite)
    : 0;
  return {
    paneCount: plotAreaWidths.length,
    plotAreaWidths,
    widthDrift,
    timeScaleWidth: chart.timeScale().width(),
  };
}
