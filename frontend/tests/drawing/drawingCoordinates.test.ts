import assert from "node:assert/strict";
import { test } from "node:test";

import type { Candle } from "../../src/types";
import {
  fromLocalDateTimeInput,
  nearestCandleIndex,
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
});

test("local datetime conversion round-trips to minute precision", () => {
  const timestamp = 1_704_067_260;
  const input = toLocalDateTimeInput(timestamp);
  const roundTrip = fromLocalDateTimeInput(input);
  assert.ok(roundTrip != null);
  assert.equal(Math.floor(roundTrip! / 60), Math.floor(timestamp / 60));
  assert.equal(fromLocalDateTimeInput("invalid"), null);
});
