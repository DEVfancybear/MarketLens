export type ChartOptimizationMode = "auto" | "optimized" | "legacy";

export interface ChartOptimizationRolloutInput {
  queryMode?: string | null;
  storedMode?: string | null;
  environmentMode?: string | null;
  candleCount: number;
  hardwareConcurrency?: number;
  deviceMemoryGb?: number;
}

export interface ChartOptimizationDecision {
  requestedMode: ChartOptimizationMode;
  effectiveMode: "optimized" | "legacy";
  source: "query" | "storage" | "environment" | "default";
  reason: "explicit" | "large-history" | "capable-device" | "small-or-limited-device";
  derivedData: boolean;
  chunkRepository: boolean;
}

const STORAGE_KEY = "chartOptimization";
let runtimePreference: Omit<ChartOptimizationRolloutInput, "candleCount"> | null = null;

function parseMode(value: string | null | undefined): ChartOptimizationMode | null {
  return value === "auto" || value === "optimized" || value === "legacy"
    ? value
    : null;
}

export function resolveChartOptimizationDecision(
  input: ChartOptimizationRolloutInput,
): ChartOptimizationDecision {
  const queryMode = parseMode(input.queryMode);
  const storedMode = parseMode(input.storedMode);
  const environmentMode = parseMode(input.environmentMode);
  const requestedMode = queryMode ?? storedMode ?? environmentMode ?? "auto";
  const source = queryMode
    ? "query"
    : storedMode
      ? "storage"
      : environmentMode
        ? "environment"
        : "default";

  if (requestedMode !== "auto") {
    const optimized = requestedMode === "optimized";
    return {
      requestedMode,
      effectiveMode: optimized ? "optimized" : "legacy",
      source,
      reason: "explicit",
      derivedData: optimized,
      chunkRepository: optimized,
    };
  }

  const candleCount = Math.max(0, input.candleCount);
  const hardwareConcurrency = input.hardwareConcurrency ?? 4;
  const deviceMemoryGb = input.deviceMemoryGb ?? 4;
  const largeHistory = candleCount >= 5_000;
  const capableDevice = hardwareConcurrency >= 4 && deviceMemoryGb >= 4;
  const optimized = largeHistory || (candleCount >= 900 && capableDevice);
  return {
    requestedMode,
    effectiveMode: optimized ? "optimized" : "legacy",
    source,
    reason: largeHistory
      ? "large-history"
      : optimized
        ? "capable-device"
        : "small-or-limited-device",
    derivedData: optimized,
    chunkRepository: optimized,
  };
}

function runtimeRolloutPreference() {
  if (runtimePreference) return runtimePreference;
  const nav = typeof navigator === "undefined"
    ? undefined
    : navigator as Navigator & { deviceMemory?: number };
  runtimePreference = {
    queryMode: typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get("chartOptimization"),
    storedMode: typeof window === "undefined"
      ? null
      : window.localStorage.getItem(STORAGE_KEY),
    environmentMode: process.env.NEXT_PUBLIC_CHART_OPTIMIZATION_MODE,
    hardwareConcurrency: nav?.hardwareConcurrency,
    deviceMemoryGb: nav?.deviceMemory,
  };
  return runtimePreference;
}

export function getChartOptimizationDecision(candleCount: number) {
  return resolveChartOptimizationDecision({
    ...runtimeRolloutPreference(),
    candleCount,
  });
}

export const CHART_OPTIMIZATION_STORAGE_KEY = STORAGE_KEY;
