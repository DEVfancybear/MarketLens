import test from "node:test";
import assert from "node:assert/strict";
import {
  indicatorPointsInViewport,
  resolveCandleViewport,
} from "../../src/services/candleViewport";
import type { Candle } from "../../src/types";

test("candle viewport clamps and adds asymmetric overscan", () => {
  const viewport = resolveCandleViewport(5_000, { from: 4_800, to: 4_900 });
  assert.deepEqual(viewport?.visible, { first: 4_800, last: 4_900 });
  assert.deepEqual(viewport?.overscan, { first: 4_598, last: 4_999 });
});

test("candle viewport retains its window inside hysteresis", () => {
  const first = resolveCandleViewport(5_000, { from: 2_000, to: 2_100 });
  const next = resolveCandleViewport(5_000, { from: 2_010, to: 2_110 }, first);
  assert.deepEqual(next?.overscan, first?.overscan);
  assert.equal(next?.revision, first?.revision);
  assert.equal(next?.direction, "right");
});

test("candle viewport biases a shifted window toward history", () => {
  const first = resolveCandleViewport(5_000, { from: 3_000, to: 3_100 });
  const shifted = resolveCandleViewport(5_000, { from: 2_500, to: 2_600 }, first);
  assert.equal(shifted?.direction, "left");
  assert.ok((shifted?.overscan.first ?? 5_000) <= 2_100);
});

test("indicator projection slices by candle timestamps", () => {
  const candles = Array.from({ length: 20 }, (_, index): Candle => ({
    time: 1_000 + index * 60,
    open: 1,
    high: 2,
    low: 0,
    close: 1,
    volume: 1,
  }));
  const points = candles.map((candle) => ({ time: candle.time, value: candle.close }));
  const viewport = {
    visible: { first: 8, last: 10 },
    overscan: { first: 5, last: 13 },
    direction: "idle" as const,
    revision: 1,
  };
  assert.deepEqual(
    indicatorPointsInViewport(points, candles, viewport).map((point) => point.time),
    candles.slice(5, 14).map((candle) => candle.time),
  );
});
