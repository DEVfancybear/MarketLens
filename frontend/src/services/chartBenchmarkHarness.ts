import type { IChartApi, Logical } from "lightweight-charts";
import {
  getChartPerformanceSnapshot,
  incrementChartPerformanceCounter,
  resetChartPerformanceProbe,
} from "@/services/chartPerformanceProbe";

export interface ChartBenchmarkOptions {
  panFrames?: number;
  zoomFrames?: number;
  replayBars?: number;
}

const nextFrame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));

declare global {
  interface Window {
    __chartBenchmark?: {
      run: (options?: ChartBenchmarkOptions) => Promise<ReturnType<typeof getChartPerformanceSnapshot>>;
    };
  }
}

export function installChartBenchmarkHarness(
  chart: IChartApi,
  candleCount: () => number,
) {
  if (process.env.NODE_ENV === "production") return () => {};
  window.__chartBenchmark = {
    run: async (options = {}) => {
      const totalCandles = candleCount();
      const panFrames = options.panFrames ?? 120;
      const zoomFrames = options.zoomFrames ?? 90;
      const replayBars = Math.min(options.replayBars ?? 300, totalCandles);
      resetChartPerformanceProbe();
      incrementChartPerformanceCounter("benchmark.candles", totalCandles);

      const end = Math.max(1, totalCandles - 1);
      const baseSpan = Math.min(180, end);
      for (let frame = 0; frame < panFrames; frame += 1) {
        const offset = Math.round(Math.sin((frame / panFrames) * Math.PI * 4) * baseSpan);
        const to = Math.max(baseSpan, Math.min(end, end - baseSpan + offset));
        chart.timeScale().setVisibleLogicalRange({
          from: (to - baseSpan) as Logical,
          to: to as Logical,
        });
        await nextFrame();
      }

      for (let frame = 0; frame < zoomFrames; frame += 1) {
        const phase = (frame / zoomFrames) * Math.PI * 2;
        const span = Math.max(30, Math.round(baseSpan * (1 + 0.55 * Math.sin(phase))));
        chart.timeScale().setVisibleLogicalRange({
          from: Math.max(0, end - span) as Logical,
          to: end as Logical,
        });
        await nextFrame();
      }

      if (replayBars > 0) {
        const start = totalCandles - replayBars;
        for (let count = start; count <= totalCandles; count += 1) {
          window.dispatchEvent(new CustomEvent("chart-benchmark-replay", { detail: { count } }));
          await nextFrame();
        }
      }
      await nextFrame();
      return getChartPerformanceSnapshot();
    },
  };
  return () => {
    delete window.__chartBenchmark;
  };
}
