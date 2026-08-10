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

test("live-tail viewport jitter stays inside clamped-edge hysteresis", () => {
  const first = resolveCandleViewport(903, {
    from: 873.3748453055417,
    to: 912.9998453055417,
  });
  assert.deepEqual(first?.visible, { first: 873, last: 902 });
  assert.equal(first?.overscan.last, 902);

  const shiftedLeft = resolveCandleViewport(903, {
    from: 871.3748453055417,
    to: 910.9998453055417,
  }, first);
  const shiftedRight = resolveCandleViewport(903, {
    from: 872.3748453055417,
    to: 911.9998453055417,
  }, shiftedLeft);

  assert.deepEqual(shiftedLeft?.overscan, first?.overscan);
  assert.deepEqual(shiftedRight?.overscan, first?.overscan);
  assert.equal(shiftedLeft?.revision, first?.revision);
  assert.equal(shiftedRight?.revision, first?.revision);
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

test("indicator projection keeps future object points when the viewport reaches the live tail", () => {
  const candles = Array.from({ length: 20 }, (_, index): Candle => ({
    time: 1_000 + index * 60,
    open: 1,
    high: 2,
    low: 0,
    close: 1,
    volume: 1,
  }));
  const points = [
    ...candles.map((candle) => ({ time: candle.time, value: candle.close })),
    { time: candles.at(-1)!.time + 60, value: 2 },
    { time: candles.at(-1)!.time + 12 * 60, value: 2 },
  ];
  const viewport = {
    visible: { first: 16, last: 19 },
    overscan: { first: 12, last: 19 },
    direction: "right" as const,
    revision: 1,
  };

  assert.deepEqual(
    indicatorPointsInViewport(points, candles, viewport).map((point) => point.time),
    points.slice(12).map((point) => point.time),
  );
});

test("indicator projection still clips future object points away from the live tail", () => {
  const candles = Array.from({ length: 20 }, (_, index): Candle => ({
    time: 1_000 + index * 60,
    open: 1,
    high: 2,
    low: 0,
    close: 1,
    volume: 1,
  }));
  const points = [
    ...candles.map((candle) => ({ time: candle.time, value: candle.close })),
    { time: candles.at(-1)!.time + 12 * 60, value: 2 },
  ];
  const viewport = {
    visible: { first: 5, last: 7 },
    overscan: { first: 3, last: 10 },
    direction: "idle" as const,
    revision: 1,
  };

  assert.deepEqual(
    indicatorPointsInViewport(points, candles, viewport).map((point) => point.time),
    candles.slice(3, 11).map((candle) => candle.time),
  );
});

test("indicator projection keeps a sparse segment anchor inside the viewport", () => {
  const candles = Array.from({ length: 20 }, (_, index): Candle => ({
    time: 1_000 + index * 60,
    open: 1,
    high: 2,
    low: 0,
    close: 1,
    volume: 1,
  }));
  const points = [
    { time: candles[2].time, value: 2 },
    { time: candles[18].time, value: 2 },
  ];
  const viewport = {
    visible: { first: 10, last: 12 },
    overscan: { first: 8, last: 14 },
    direction: "idle" as const,
    revision: 1,
  };
  assert.deepEqual(
    indicatorPointsInViewport(points, candles, viewport).map((point) => point.time),
    [candles[2].time, candles[18].time],
  );
});

test("indicator projection does not read past points when the viewport misses the data", () => {
  const candles = Array.from({ length: 20 }, (_, index): Candle => ({
    time: 1_000 + index * 60,
    open: 1,
    high: 2,
    low: 0,
    close: 1,
    volume: 1,
  }));
  const points = [
    { time: candles[2].time, value: 2 },
    { time: candles[4].time, value: 2 },
  ];
  const viewport = {
    visible: { first: 10, last: 12 },
    overscan: { first: 8, last: 14 },
    direction: "idle" as const,
    revision: 1,
  };

  assert.deepEqual(indicatorPointsInViewport(points, candles, viewport), []);
});
