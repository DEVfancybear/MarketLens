import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canUseLatestIndicatorRuntimeResult,
  indicatorRuntimeCacheKey,
  indicatorRuntimeScopeKey,
  normalizeReplayCutoff,
  replayCutoffFromVisibleThrough,
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

test("runtime scope includes Pine market metadata", () => {
  const base = { symbol: "BTCUSD", timeframe: "15m" as const };
  assert.notEqual(
    indicatorRuntimeScopeKey(indicator, {
      ...base,
      symbolType: "crypto",
      mintick: 0.1,
      timezone: "UTC",
    }),
    indicatorRuntimeScopeKey(indicator, {
      ...base,
      symbolType: "forex",
      mintick: 0.00001,
      timezone: "UTC",
    }),
  );
});

test("replay visibleThrough is normalized to safe UNIX seconds", () => {
  const visibleThrough = "2026-07-17T19:00:00.999Z";
  assert.equal(
    replayCutoffFromVisibleThrough(visibleThrough),
    Math.floor(Date.parse(visibleThrough) / 1000),
  );
  assert.equal(replayCutoffFromVisibleThrough("not-a-timestamp"), undefined);
  assert.equal(replayCutoffFromVisibleThrough(1_700_000_000_000), undefined);
  assert.equal(normalizeReplayCutoff(1_700_000_000_000), undefined);
  assert.equal(normalizeReplayCutoff(Number.NaN), undefined);
  assert.equal(normalizeReplayCutoff(0), undefined);
});

test("runtime keys isolate live and replay sessions while exact keys include cutoff", () => {
  const live = { symbol: "EURUSD", timeframe: "15m" as const };
  const replayAt100 = { ...live, replaySessionId: "session-a", replayCutoff: 1_000 };
  const replayAt200 = { ...live, replaySessionId: "session-a", replayCutoff: 2_000 };
  const anotherSession = { ...live, replaySessionId: "session-b", replayCutoff: 1_000 };

  assert.equal(
    indicatorRuntimeScopeKey(indicator, replayAt100),
    indicatorRuntimeScopeKey(indicator, replayAt200),
  );
  assert.notEqual(
    indicatorRuntimeCacheKey(indicator, candlesA, replayAt100),
    indicatorRuntimeCacheKey(indicator, candlesA, replayAt200),
  );
  assert.notEqual(
    indicatorRuntimeScopeKey(indicator, replayAt100),
    indicatorRuntimeScopeKey(indicator, anotherSession),
  );
  assert.notEqual(
    indicatorRuntimeScopeKey(indicator, live),
    indicatorRuntimeScopeKey(indicator, replayAt100),
  );
});

test("latest runtime fallback is causal across replay navigation", () => {
  const replayAt100 = { replaySessionId: "session-a", replayCutoff: 1_000 };
  const replayAt200 = { replaySessionId: "session-a", replayCutoff: 2_000 };

  assert.equal(canUseLatestIndicatorRuntimeResult(replayAt200, replayAt100), true);
  assert.equal(canUseLatestIndicatorRuntimeResult(replayAt100, replayAt200), false);
  assert.equal(
    canUseLatestIndicatorRuntimeResult(replayAt200, {
      replaySessionId: "session-b",
      replayCutoff: 1_000,
    }),
    false,
  );
  assert.equal(canUseLatestIndicatorRuntimeResult({}, replayAt100), false);
  assert.equal(canUseLatestIndicatorRuntimeResult(replayAt100, {}), false);
  assert.equal(canUseLatestIndicatorRuntimeResult({}, {}), true);
  assert.equal(
    canUseLatestIndicatorRuntimeResult(
      { replaySessionId: "session-a" },
      { replaySessionId: "session-a" },
    ),
    false,
  );
});

test("runtime config serialization is stable across property insertion order", () => {
  assert.equal(
    stableIndicatorRuntimeJSON({ style: { color: "#fff", width: 2 }, period: 10 }),
    stableIndicatorRuntimeJSON({ period: 10, style: { width: 2, color: "#fff" } }),
  );
});
