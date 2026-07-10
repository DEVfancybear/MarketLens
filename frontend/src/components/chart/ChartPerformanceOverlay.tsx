"use client";

import { useEffect, useState } from "react";
import {
  exposeChartPerformanceProbe,
  getChartPerformanceSnapshot,
  isChartPerformanceProbeEnabled,
  startChartPerformanceObservers,
} from "@/services/chartPerformanceProbe";

export function ChartPerformanceOverlay() {
  const [enabled, setEnabled] = useState(false);
  const [, setRevision] = useState(0);

  useEffect(() => {
    const active = isChartPerformanceProbeEnabled();
    setEnabled(active);
    if (!active) return;
    exposeChartPerformanceProbe();
    const stop = startChartPerformanceObservers();
    const refresh = window.setInterval(() => setRevision((value) => value + 1), 500);
    return () => {
      window.clearInterval(refresh);
      stop();
    };
  }, []);

  if (!enabled) return null;
  const snapshot = getChartPerformanceSnapshot();
  const frames = snapshot.metrics["frame.interval"];
  const setData = snapshot.counters["series.candle.setData.calls"] ?? 0;
  const updates = snapshot.counters["series.candle.update.calls"] ?? 0;
  const indicatorMs = snapshot.metrics["indicator.compute"]?.totalMs ?? 0;

  return (
    <div className="pointer-events-none absolute right-2 top-2 z-[80] rounded border border-white/20 bg-black/80 px-2 py-1 font-mono text-[10px] leading-4 text-white">
      <div>chart perf · {Math.round(snapshot.elapsedMs / 1000)}s</div>
      <div>frame last/max {frames?.lastMs.toFixed(1) ?? "-"}/{frames?.maxMs.toFixed(1) ?? "-"}ms</div>
      <div>candle set/update {setData}/{updates}</div>
      <div>indicator CPU {indicatorMs.toFixed(1)}ms</div>
      <div>window.__chartPerformanceProbe.exportJson()</div>
    </div>
  );
}
