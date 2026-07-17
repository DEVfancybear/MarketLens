/**
 * Indicator runtime boundary.
 *
 * Built-ins and user scripts are both Pine source compiled by the Go runtime.
 * The browser keeps only instance defaults and projects IndicatorResult into
 * the chart; it never owns a formula or fallback calculator.
 */
import type {
  BuiltInIndicatorType,
  Candle,
  IndicatorConfig,
  IndicatorResult,
} from "@/types";
import type { PineCompileContext } from "@/services/pineRuntimeCache";
import { getCachedPineIndicatorResult } from "@/services/pineRuntimeCache";
import {
  getCachedIndicatorRuntimeResult,
} from "@/services/indicatorRuntimeCache";

export function computeIndicator(
  config: IndicatorConfig,
  candles: Candle[],
  ctx?: PineCompileContext,
): IndicatorResult {
  if (config.type === "CUSTOM") {
    return getCachedPineIndicatorResult(config, candles, ctx) ?? {
      id: config.id,
      series: [],
    };
  }
  return getCachedIndicatorRuntimeResult(config, candles, ctx) ?? {
    id: config.id,
    series: [],
  };
}

/** Sensible instance defaults; calculation remains backend-owned. */
export function defaultIndicator(
  type: BuiltInIndicatorType,
  id: string,
): IndicatorConfig {
  switch (type) {
    case "SMA":
      return { id, type, length: 50, color: "#2962ff", visible: true };
    case "EMA":
      return { id, type, length: 21, color: "#ff6d00", visible: true };
    case "VWAP":
      return { id, type, length: 0, color: "#ab47bc", visible: true };
    case "RSI":
      return {
        id,
        type,
        length: 14,
        color: "#26a69a",
        visible: true,
        separatePane: true,
      };
    case "MACD":
      return {
        id,
        type,
        length: 12,
        length3: 26,
        length2: 9,
        color: "#2962ff",
        color2: "#ff9800",
        visible: true,
        separatePane: true,
      };
    case "ADR":
      return {
        id,
        type,
        length: 14,
        color: "#26a69a",
        color2: "#ef5350",
        visible: true,
      };
    case "FVG":
      return {
        id,
        type,
        length: 0,
        color: "#089981",
        color2: "#f23645",
        visible: true,
        inputValues: {
          thresholdPer: 0,
          auto: false,
          showLast: 0,
          mitigationLevels: false,
          timeframe: "",
          extend: 20,
          dynamic: false,
          showDash: false,
          dashLoc: "Top Right",
          textSize: "Small",
        },
      };
    case "SWING_SR":
      return {
        id,
        type,
        length: 25,
        length2: 25,
        color: "#ef5350",
        color2: "#26c6da",
        visible: true,
        inputValues: { highSource: "high", lowSource: "low" },
        styleValues: {
          "builtin:primary.lineStyle": 1,
          "builtin:secondary.lineStyle": 1,
        },
      };
  }
}
