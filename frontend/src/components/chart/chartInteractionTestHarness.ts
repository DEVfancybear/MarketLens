import type { IChartApi, IRange, Time } from "lightweight-charts";
import type { ChartViewportController } from "./chartViewportController";
import { measureChartPaneMetrics } from "./chartPaneMetrics";

export interface ChartInteractionSnapshot {
  candleCount: number;
  firstCandleTime: number | null;
  lastCrosshairTime: number | null;
  paneBoxes: Array<{ x: number; y: number; width: number; height: number }>;
  paneMetrics: ReturnType<typeof measureChartPaneMetrics>;
  visibleTimeRange: IRange<Time> | null;
  viewport: ReturnType<ChartViewportController["snapshot"]>;
  barSpacing: number;
  priceScaleRanges: Array<IRange<number> | null>;
  priceScaleAutoScale: boolean[];
}

declare global {
  interface Window {
    __chartInteractionTest?: {
      snapshot: () => ChartInteractionSnapshot;
      prependHistory: (count: number) => void;
      setBarSpacing: (barSpacing: number) => void;
    };
  }
}

/** Development-only semantic surface used by Playwright interaction tests. */
export function installChartInteractionTestHarness({
  chart,
  viewport,
  candleCount,
  firstCandleTime,
  lastCrosshairTime,
}: {
  chart: IChartApi;
  viewport: ChartViewportController;
  candleCount: () => number;
  firstCandleTime: () => number | null;
  lastCrosshairTime: () => number | null;
}) {
  if (process.env.NODE_ENV === "production") return () => {};
  window.__chartInteractionTest = {
    snapshot: () => ({
      candleCount: candleCount(),
      firstCandleTime: firstCandleTime(),
      lastCrosshairTime: lastCrosshairTime(),
      paneBoxes: chart.panes().map((pane) => {
        const rect = pane.getHTMLElement()?.getBoundingClientRect();
        return rect
          ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
          : { x: 0, y: 0, width: 0, height: 0 };
      }),
      paneMetrics: measureChartPaneMetrics(chart),
      visibleTimeRange: chart.timeScale().getVisibleRange(),
      viewport: viewport.snapshot(),
      barSpacing: chart.timeScale().options().barSpacing,
      priceScaleRanges: chart.panes().map((_pane, index) =>
        chart.priceScale("right", index).getVisibleRange()
      ),
      priceScaleAutoScale: chart.panes().map((_pane, index) =>
        chart.priceScale("right", index).options().autoScale
      ),
    }),
    prependHistory: (count) => {
      window.dispatchEvent(new CustomEvent("chart-benchmark-prepend", {
        detail: { count },
      }));
    },
    setBarSpacing: (barSpacing) => {
      if (!Number.isFinite(barSpacing) || barSpacing <= 0) return;
      chart.timeScale().applyOptions({ barSpacing });
    },
  };
  return () => {
    delete window.__chartInteractionTest;
  };
}
