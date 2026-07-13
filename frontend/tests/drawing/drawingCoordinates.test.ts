import assert from "node:assert/strict";
import { test } from "node:test";

import type { Candle } from "../../src/types";
import {
  candleIndexAtOrBefore,
  extrapolateTimeCoordinate,
  fromLocalDateTimeInput,
  nearestCandleIndex,
  resolveCandleBarIntervalSeconds,
  timeAtCandleIndex,
  toLocalDateTimeInput,
  updateDrawingPoint,
} from "../../src/components/chart/drawing/coordinates/drawingCoordinates";

const candles: Candle[] = [
  { time: 100, open: 1, high: 2, low: 0, close: 1, volume: 1 },
  { time: 200, open: 1, high: 2, low: 0, close: 1, volume: 1 },
  { time: 300, open: 1, high: 2, low: 0, close: 1, volume: 1 },
];

test("coordinate updates clone all points and replace only the requested finite fields", () => {
  const original = [{ time: 10, price: 20 }, { time: 30, price: 40 }];
  const next = updateDrawingPoint(original, 1, { time: 35, price: 45 });
  assert.deepEqual(next, [{ time: 10, price: 20 }, { time: 35, price: 45 }]);
  assert.notEqual(next, original);
  assert.notEqual(next[0], original[0]);
  assert.deepEqual(updateDrawingPoint(original, 0, { price: Number.NaN }), original);
});

test("bar-index conversion uses nearest binary lookup and clamps edits", () => {
  assert.equal(nearestCandleIndex(candles, 249), 1);
  assert.equal(nearestCandleIndex(candles, 250), 1);
  assert.equal(nearestCandleIndex(candles, 251), 2);
  assert.equal(timeAtCandleIndex(candles, -4), 100);
  assert.equal(timeAtCandleIndex(candles, 1.6), 300);
  assert.equal(timeAtCandleIndex(candles, 99), 300);
  assert.equal(nearestCandleIndex([], 1), null);
  assert.equal(candleIndexAtOrBefore(candles, 50), 0);
  assert.equal(candleIndexAtOrBefore(candles, 100), 0);
  assert.equal(candleIndexAtOrBefore(candles, 299), 1);
  assert.equal(candleIndexAtOrBefore(candles, 300), 2);
  assert.equal(candleIndexAtOrBefore([], 300), null);
});

test("local datetime conversion round-trips to minute precision", () => {
  const timestamp = 1_704_067_260;
  const input = toLocalDateTimeInput(timestamp);
  const roundTrip = fromLocalDateTimeInput(input);
  assert.ok(roundTrip != null);
  assert.equal(Math.floor(roundTrip! / 60), Math.floor(timestamp / 60));
  assert.equal(fromLocalDateTimeInput("invalid"), null);
});

test("future projection keeps a 20-bar width across a session gap", () => {
  const fifteenMinutes = 15 * 60;
  const fridayClose = 1_704_412_800;
  const mondayOpen = fridayClose + 3 * 24 * 60 * 60;

  const projected = extrapolateTimeCoordinate({
    time: mondayOpen + 20 * fifteenMinutes,
    anchorTime: mondayOpen,
    anchorX: 120,
    referenceTime: fridayClose,
    referenceX: 110,
    indexSpan: 1,
    barIntervalSeconds: fifteenMinutes,
  });

  assert.equal(projected, 320);
});

test("future projection falls back to observed candle spacing without a timeframe", () => {
  assert.equal(extrapolateTimeCoordinate({
    time: 1_300,
    anchorTime: 1_200,
    anchorX: 30,
    referenceTime: 1_100,
    referenceX: 20,
    indexSpan: 1,
  }), 40);
});

test("bar interval uses median cadence without mistaking a session gap", () => {
  const fifteenMinutes = 900;
  const withWeekend = [
    { time: 1_000 },
    { time: 1_900 },
    { time: 2_800 },
    { time: 175_600 },
    { time: 176_500 },
    { time: 177_400 },
  ];
  assert.equal(
    resolveCandleBarIntervalSeconds(withWeekend, fifteenMinutes),
    fifteenMinutes,
  );

  const minuteFixture = Array.from({ length: 8 }, (_, index) => ({
    time: 10_000 + index * 60,
  }));
  assert.equal(
    resolveCandleBarIntervalSeconds(minuteFixture, fifteenMinutes),
    60,
  );
  assert.equal(
    resolveCandleBarIntervalSeconds([{ time: 1_000 }, { time: 99_000 }], fifteenMinutes),
    fifteenMinutes,
  );
});
