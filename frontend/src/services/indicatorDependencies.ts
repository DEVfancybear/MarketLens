import type { IndicatorConfig } from "@/types";

export type IndicatorDependency =
  | { kind: "finite"; warmupBars: number }
  | { kind: "recursive"; warmupBars: number; checkpointInterval: number }
  | { kind: "session"; boundary: "utc-day" }
  | { kind: "full-history"; reason: "daily-aggregation" | "unknown-custom-code" };

const RECURSIVE_CHECKPOINT_INTERVAL = 256;

export function indicatorDependencyFor(cfg: IndicatorConfig): IndicatorDependency {
  switch (cfg.type) {
    case "SMA":
      return { kind: "finite", warmupBars: Math.max(0, cfg.length - 1) };
    case "EMA":
      return {
        kind: "recursive",
        warmupBars: Math.max(0, cfg.length - 1),
        checkpointInterval: RECURSIVE_CHECKPOINT_INTERVAL,
      };
    case "RSI":
      return {
        kind: "recursive",
        warmupBars: cfg.length,
        checkpointInterval: RECURSIVE_CHECKPOINT_INTERVAL,
      };
    case "MACD":
      return {
        kind: "recursive",
        warmupBars: 0,
        checkpointInterval: RECURSIVE_CHECKPOINT_INTERVAL,
      };
    case "VWAP":
      return { kind: "session", boundary: "utc-day" };
    case "ADR":
      return { kind: "full-history", reason: "daily-aggregation" };
    case "CUSTOM":
      return { kind: "full-history", reason: "unknown-custom-code" };
  }
}
