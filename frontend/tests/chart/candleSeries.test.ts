import assert from "node:assert/strict";
import test from "node:test";
import {
  mergeHistoryWithLiveCandles,
  normalizeMarketCandleSeries,
  resolveRealtimeSeriesUpdatePlan,
} from "../../src/services/market-data/candleSeries";
import type { MarketCandle } from "../../src/types";

function candle(time: number, close = time): MarketCandle {
  return {
    time,
    open: close - 1,
    high: close + 1,
    low: close - 2,
    close,
    volume: 10,
    closed: true,
  };
}

test("normalizes candle order, duplicates, and invalid OHLC bounds", () => {
  const result = normalizeMarketCandleSeries([
    { ...candle(120, 10), high: 8, low: 12 },
    candle(60, 9),
    candle(120, 11),
  ]);

  assert.deepEqual(
    result.map((item) => [item.time, item.open, item.high, item.low, item.close]),
    [
      [60, 8, 10, 7, 9],
      [120, 10, 12, 9, 11],
    ],
  );
});

test("history load keeps newer live candles instead of overwriting them", () => {
  const history = [candle(60), candle(120), candle(180)];
  const live = [
    candle(120, 121),
    { ...candle(180, 188), closed: false },
    { ...candle(240, 244), closed: false },
  ];

  const result = mergeHistoryWithLiveCandles(history, live);

  assert.deepEqual(
    result.map((item) => [item.time, item.close, item.closed]),
    [
      [60, 60, true],
      [120, 120, true],
      [180, 188, false],
      [240, 244, false],
    ],
  );
});

test("series update plan uses realtime update only when the prefix is unchanged", () => {
  const a = candle(60);
  const b = candle(120);
  const c = candle(180);

  assert.equal(
    resolveRealtimeSeriesUpdatePlan([a, b], [a, { ...b, close: 130 }], true),
    "update-latest",
  );
  assert.equal(
    resolveRealtimeSeriesUpdatePlan([a, b], [a, b, c], true),
    "append",
  );
  assert.equal(
    resolveRealtimeSeriesUpdatePlan(
      [a, b],
      [candle(60), { ...b, close: 130 }],
      true,
    ),
    "replace",
  );
});

test("series update plan replaces data after theme/context changes", () => {
  const a = candle(60);
  const b = candle(120);

  assert.equal(
    resolveRealtimeSeriesUpdatePlan([a, b], [a, { ...b, close: 130 }], false),
    "replace",
  );
});
