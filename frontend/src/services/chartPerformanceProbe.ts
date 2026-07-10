export type ChartProbeDetail = Record<string, string | number | boolean | null>;

export interface ChartProbeMetric {
  count: number;
  totalMs: number;
  maxMs: number;
  lastMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
}

export interface ChartProbeSnapshot {
  startedAt: string;
  elapsedMs: number;
  counters: Record<string, number>;
  metrics: Record<string, ChartProbeMetric>;
  samples: Array<{ name: string; durationMs: number; atMs: number; detail?: ChartProbeDetail }>;
  heap?: { usedBytes: number; totalBytes: number; limitBytes: number };
  environment?: {
    userAgent: string;
    viewport: string;
    devicePixelRatio: number;
    hardwareConcurrency: number;
  };
}

const DEV = process.env.NODE_ENV !== "production";
const MAX_SAMPLES = 500;
let startedAtEpoch = Date.now();
let startedAt = typeof performance !== "undefined" ? performance.now() : 0;
const counters = new Map<string, number>();
const metrics = new Map<string, ChartProbeMetric>();
const durations = new Map<string, number[]>();
const samples: ChartProbeSnapshot["samples"] = [];
const listeners = new Set<() => void>();
let enabledCache: boolean | null = null;
let sequence = 0;
let observerCleanup: (() => void) | null = null;

function notify() {
  listeners.forEach((listener) => listener());
}

export function isChartPerformanceProbeEnabled(): boolean {
  if (!DEV || typeof window === "undefined") return false;
  if (enabledCache != null) return enabledCache;
  const params = new URLSearchParams(window.location.search);
  enabledCache =
    params.get("chartPerf") === "1" ||
    window.localStorage.getItem("chartPerf") === "1";
  return enabledCache;
}

export function incrementChartPerformanceCounter(name: string, amount = 1) {
  if (!isChartPerformanceProbeEnabled()) return;
  counters.set(name, (counters.get(name) ?? 0) + amount);
  notify();
}

export function recordChartPerformanceDuration(
  name: string,
  durationMs: number,
  detail?: ChartProbeDetail,
) {
  if (!isChartPerformanceProbeEnabled()) return;
  const current = metrics.get(name) ?? {
    count: 0,
    totalMs: 0,
    maxMs: 0,
    lastMs: 0,
    p50Ms: 0,
    p95Ms: 0,
    p99Ms: 0,
  };
  current.count += 1;
  current.totalMs += durationMs;
  current.maxMs = Math.max(current.maxMs, durationMs);
  current.lastMs = durationMs;
  metrics.set(name, current);
  const values = durations.get(name) ?? [];
  values.push(durationMs);
  if (values.length > 1_000) values.shift();
  durations.set(name, values);
  samples.push({ name, durationMs, atMs: performance.now() - startedAt, detail });
  if (samples.length > MAX_SAMPLES) samples.splice(0, samples.length - MAX_SAMPLES);
  notify();
}

export function beginChartPerformanceMeasure(name: string, detail?: ChartProbeDetail) {
  if (!isChartPerformanceProbeEnabled()) return () => 0;
  const id = `${name}:${sequence++}`;
  const startMark = `${id}:start`;
  const endMark = `${id}:end`;
  performance.mark(startMark);
  return () => {
    performance.mark(endMark);
    const measure = performance.measure(name, startMark, endMark);
    performance.clearMarks(startMark);
    performance.clearMarks(endMark);
    performance.clearMeasures(name);
    recordChartPerformanceDuration(name, measure.duration, detail);
    return measure.duration;
  };
}

export function measureChartPerformance<T>(
  name: string,
  operation: () => T,
  detail?: ChartProbeDetail,
): T {
  const end = beginChartPerformanceMeasure(name, detail);
  try {
    return operation();
  } finally {
    end();
  }
}

export function measureChartSeriesWrite<T>(
  series: "candle" | "indicator" | "pane-anchor",
  kind: "setData" | "update",
  points: number,
  operation: () => T,
): T {
  incrementChartPerformanceCounter(`series.${series}.${kind}.calls`);
  incrementChartPerformanceCounter(`series.${series}.${kind}.points`, points);
  return measureChartPerformance(`series.${series}.${kind}`, operation, { points });
}

export function getChartPerformanceSnapshot(): ChartProbeSnapshot {
  const memory = (performance as Performance & {
    memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number };
  }).memory;
  return {
    startedAt: new Date(startedAtEpoch).toISOString(),
    elapsedMs: typeof performance === "undefined" ? 0 : performance.now() - startedAt,
    counters: Object.fromEntries(counters),
    metrics: Object.fromEntries([...metrics].map(([name, metric]) => {
      const sorted = [...(durations.get(name) ?? [])].sort((a, b) => a - b);
      const percentile = (ratio: number) =>
        sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))] ?? 0;
      return [name, {
        ...metric,
        p50Ms: percentile(0.5),
        p95Ms: percentile(0.95),
        p99Ms: percentile(0.99),
      }];
    })),
    samples: samples.map((sample) => ({ ...sample })),
    ...(memory
      ? {
          heap: {
            usedBytes: memory.usedJSHeapSize,
            totalBytes: memory.totalJSHeapSize,
            limitBytes: memory.jsHeapSizeLimit,
          },
        }
      : {}),
    ...(typeof navigator !== "undefined"
      ? {
          environment: {
            userAgent: navigator.userAgent,
            viewport: `${window.innerWidth}x${window.innerHeight}`,
            devicePixelRatio: window.devicePixelRatio,
            hardwareConcurrency: navigator.hardwareConcurrency,
          },
        }
      : {}),
  };
}

export function resetChartPerformanceProbe() {
  counters.clear();
  metrics.clear();
  durations.clear();
  samples.length = 0;
  startedAtEpoch = Date.now();
  startedAt = typeof performance !== "undefined" ? performance.now() : 0;
  notify();
}

export function subscribeChartPerformanceProbe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function startChartPerformanceObservers() {
  if (!isChartPerformanceProbeEnabled() || observerCleanup) return observerCleanup ?? (() => {});
  let frame = requestAnimationFrame(function sampleFrame(now) {
    const previous = now;
    frame = requestAnimationFrame(function nextFrame(next) {
      const interval = next - previous;
      recordChartPerformanceDuration("frame.interval", interval);
      if (interval > 16.7) incrementChartPerformanceCounter("frame.over16_7ms");
      if (interval > 25) incrementChartPerformanceCounter("frame.missed-vsync");
      if (interval > 33.4) incrementChartPerformanceCounter("frame.over33_4ms");
      sampleFrame(next);
    });
  });
  let longTaskObserver: PerformanceObserver | null = null;
  if (typeof PerformanceObserver !== "undefined") {
    try {
      longTaskObserver = new PerformanceObserver((list) => {
        list.getEntries().forEach((entry) =>
          recordChartPerformanceDuration("main.long-task", entry.duration),
        );
      });
      longTaskObserver.observe({ entryTypes: ["longtask"] });
    } catch {
      longTaskObserver = null;
    }
  }
  observerCleanup = () => {
    cancelAnimationFrame(frame);
    longTaskObserver?.disconnect();
    observerCleanup = null;
  };
  return observerCleanup;
}

declare global {
  interface Window {
    __chartPerformanceProbe?: {
      snapshot: typeof getChartPerformanceSnapshot;
      reset: typeof resetChartPerformanceProbe;
      exportJson: () => string;
    };
  }
}

export function exposeChartPerformanceProbe() {
  if (!isChartPerformanceProbeEnabled()) return;
  window.__chartPerformanceProbe = {
    snapshot: getChartPerformanceSnapshot,
    reset: resetChartPerformanceProbe,
    exportJson: () => JSON.stringify(getChartPerformanceSnapshot(), null, 2),
  };
}
