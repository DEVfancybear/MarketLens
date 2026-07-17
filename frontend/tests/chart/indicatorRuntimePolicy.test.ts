import assert from "node:assert/strict";
import { test } from "node:test";

import {
  indicatorRuntimeCacheKey,
  indicatorRuntimeScopeKey,
  stableIndicatorRuntimeJSON,
} from "../../src/services/indicatorRuntimePolicy";
import type { Candle, IndicatorConfig } from "../../src/types";

const candlesA: Candle[] = [
  { time: 1000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 },
  { time: 1060, open: 1.5, high: 2.1, low: 1.3, close: 1.8, volume: 11 },
];

const candlesB: Candle[] = [
  { time: 1000, open: 2, high: 3, low: 1.5, close: 2.5, volume: 20 },
  { time: 1060, open: 2.5, high: 3.1, low: 2.3, close: 2.8, volume: 21 },
];

const indicator: IndicatorConfig = {
  id: "runtime-instance",
  type: "catalog-or-script-key",
  visible: true,
  requiresHistoryContext: true,
  inputValues: { period: 10 },
};

test("common runtime cache is content-sensitive for every indicator definition", () => {
  const context = { symbol: "EURUSD", timeframe: "15m" as const };
  assert.notEqual(
    indicatorRuntimeCacheKey(indicator, candlesA, context),
    indicatorRuntimeCacheKey(indicator, candlesB, context),
  );
  assert.equal(
    indicatorRuntimeCacheKey(indicator, candlesA, context),
    indicatorRuntimeCacheKey(indicator, [...candlesA], context),
  );
});

test("latest runtime fallback is scoped by symbol, timeframe, and dynamic config", () => {
  assert.notEqual(
    indicatorRuntimeScopeKey(indicator, { symbol: "EURUSD", timeframe: "15m" }),
    indicatorRuntimeScopeKey(indicator, { symbol: "GBPUSD", timeframe: "15m" }),
  );
  assert.notEqual(
    indicatorRuntimeScopeKey(indicator, { symbol: "EURUSD", timeframe: "15m" }),
    indicatorRuntimeScopeKey(
      { ...indicator, inputValues: { period: 20 } },
      { symbol: "EURUSD", timeframe: "15m" },
    ),
  );
});

test("runtime config serialization is stable across property insertion order", () => {
  assert.equal(
    stableIndicatorRuntimeJSON({ style: { color: "#fff", width: 2 }, period: 10 }),
    stableIndicatorRuntimeJSON({ period: 10, style: { width: 2, color: "#fff" } }),
  );
});
