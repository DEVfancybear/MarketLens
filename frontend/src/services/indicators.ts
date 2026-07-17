/**
 * Indicator runtime boundary.
 *
 * Built-in formulas are owned by the Go indicator runtime. The browser keeps
 * only the instance defaults and projects the API's IndicatorResult into the
 * chart. This intentionally gives future indicators the same request/result
 * contract instead of adding another client-side calculator.
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
