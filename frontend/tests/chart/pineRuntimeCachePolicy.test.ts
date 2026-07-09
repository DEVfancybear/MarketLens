import assert from "node:assert/strict";
import { test } from "node:test";

import {
  pineRuntimeCacheKey,
  pineIndicatorScopeKey,
} from "../../src/services/pineRuntimeCachePolicy";
import type { Candle, IndicatorConfig } from "../../src/types";

const candlesA: Candle[] = [
  { time: 1000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 },
  { time: 1060, open: 1.5, high: 2.1, low: 1.3, close: 1.8, volume: 11 },
];

const candlesB: Candle[] = [
  { time: 1000, open: 2, high: 3, low: 1.5, close: 2.5, volume: 20 },
  { time: 1060, open: 2.5, high: 3.1, low: 2.3, close: 2.8, volume: 21 },
];

const securityIndicator: IndicatorConfig = {
  id: "adr",
  type: "CUSTOM",
  length: 0,
  color: "#ef5350",
  visible: true,
  sourceCode: `
indicator("ADR", overlay=true)
adr = request.security(syminfo.tickerid, "D", ta.sma(high - low, 10)[1])
plot(adr)
`,
};

test("request.security scripts keep a stable cache key across same-window OHLC refreshes", () => {
  const ctx = { symbol: "EURUSD", timeframe: "15m" as const };

  assert.equal(
    pineRuntimeCacheKey(securityIndicator, candlesA, ctx),
    pineRuntimeCacheKey(securityIndicator, candlesB, ctx),
  );
});

test("non-security scripts stay content-sensitive", () => {
  const cfg: IndicatorConfig = {
    ...securityIndicator,
    id: "plain",
    sourceCode: `indicator("Plain"); plot(close)`,
  };
  const ctx = { symbol: "EURUSD", timeframe: "15m" as const };

  assert.notEqual(
    pineRuntimeCacheKey(cfg, candlesA, ctx),
    pineRuntimeCacheKey(cfg, candlesB, ctx),
  );
});

test("latest custom Pine fallback is scoped by symbol and timeframe", () => {
  assert.notEqual(
    pineIndicatorScopeKey(securityIndicator, { symbol: "EURUSD", timeframe: "15m" }),
    pineIndicatorScopeKey(securityIndicator, { symbol: "GBPUSD", timeframe: "15m" }),
  );
  assert.notEqual(
    pineIndicatorScopeKey(securityIndicator, { symbol: "EURUSD", timeframe: "15m" }),
    pineIndicatorScopeKey(securityIndicator, { symbol: "EURUSD", timeframe: "5m" }),
  );
});
