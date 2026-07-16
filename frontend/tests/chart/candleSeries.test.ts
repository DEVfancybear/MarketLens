import assert from "node:assert/strict";
import test from "node:test";
import {
  findRecentCandleGap,
  hasDiscontinuousHistoryTail,
  mergeHistoryWithLiveCandles,
  normalizeMarketCandleSeries,
  resolveRealtimeSeriesUpdatePlan,
  upsertMarketCandleIntoSeries,
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

test("history backfill preserves live candles outside the fetched window", () => {
  const live = [
    candle(60),
    candle(120),
    candle(300),
    { ...candle(360, 366), closed: false },
  ];
  const backfill = [candle(180), candle(240), candle(300, 301)];

  const result = mergeHistoryWithLiveCandles(backfill, live);

  assert.deepEqual(
    result.map((item) => [item.time, item.close, item.closed]),
    [
      [60, 60, true],
      [120, 120, true],
      [180, 180, true],
      [240, 240, true],
      [300, 301, true],
      [360, 366, false],
    ],
  );
});

test("realtime upsert repairs delayed candles inside the visible window", () => {
  const a = candle(60, 60);
  const c = candle(180, 180);
  const delayed = candle(120, 120);

  const result = upsertMarketCandleIntoSeries([a, c], delayed);

  assert.deepEqual(
    result.map((item) => item.time),
    [60, 120, 180],
  );
  assert.equal(result[0], a);
  assert.equal(result[2], c);
});

test("realtime upsert replaces delayed corrections by timestamp", () => {
  const a = candle(60, 60);
  const stale = candle(120, 120);
  const c = candle(180, 180);
  const correction = { ...candle(120, 125), closed: true };

  const result = upsertMarketCandleIntoSeries([a, stale, c], correction);

  assert.deepEqual(
    result.map((item) => [item.time, item.close]),
    [
      [60, 60],
      [120, 125],
      [180, 180],
    ],
  );
  assert.equal(result[0], a);
  assert.equal(result[2], c);
});

test("realtime upsert keeps the max candle window bounded", () => {
  const result = upsertMarketCandleIntoSeries(
    [candle(60), candle(180)],
    candle(120),
    2,
  );

  assert.deepEqual(
    result.map((item) => item.time),
    [120, 180],
  );
});

test("detects recent short candle gaps for REST backfill", () => {
  const result = findRecentCandleGap(
    [candle(60), candle(120), candle(300)],
    60,
  );

  assert.deepEqual(result, {
    afterTime: 120,
    beforeTime: 300,
    missingBars: 2,
  });
});

test("ignores large session gaps so markets with closures do not loop backfill", () => {
  const result = findRecentCandleGap(
    [candle(60), candle(120), candle(60 * 60 * 48)],
    60,
    50,
  );

  assert.equal(result, null);
});

test("detects a small refresh page disconnected from a stale history tail", () => {
  assert.equal(
    hasDiscontinuousHistoryTail(
      [candle(60), candle(120)],
      [candle(300), candle(360)],
      60,
    ),
    true,
  );
});

test("accepts overlapping and directly adjacent history refresh pages", () => {
  const current = [candle(60), candle(120), candle(180)];

  assert.equal(
    hasDiscontinuousHistoryTail(current, [candle(120), candle(180)], 60),
    false,
  );
  assert.equal(
    hasDiscontinuousHistoryTail(current, [candle(240), candle(300)], 60),
    false,
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
