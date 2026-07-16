import assert from "node:assert/strict";
import { test } from "node:test";

import type { Candle } from "../../src/types";
import {
  effectiveMagnetMode,
  snapPointToIndicator,
  snapPointToOhlc,
  snapPointWithMagnetSources,
} from "../../src/components/chart/drawing/interaction/OhlcMagnetSnap";

const candles: Candle[] = [
  { time: 100, open: 10, high: 15, low: 8, close: 12, volume: 1 },
  { time: 200, open: 20, high: 24, low: 18, close: 22, volume: 1 },
];
const toX = (time: number) => time;
const toY = (price: number) => 100 - price * 2;

test("strong magnet selects the nearest candle in X and nearest OHLC in Y", () => {
  const result = snapPointToOhlc({
    point: { time: 190, price: 23.4 },
    candles,
    mode: "strong",
    toX,
    toY,
  });
  assert.equal(result.snapped, true);
  assert.deepEqual(result.point, { time: 200, price: 24 });
  assert.equal(result.field, "high");
});

test("weak magnet accepts nearby OHLC and leaves distant points unchanged", () => {
  const nearby = snapPointToOhlc({
    point: { time: 197, price: 21.5 },
    candles,
    mode: "weak",
    toX,
    toY,
  });
  assert.deepEqual(nearby.point, { time: 200, price: 22 });

  const distantPoint = { time: 170, price: 40 };
  const distant = snapPointToOhlc({
    point: distantPoint,
    candles,
    mode: "weak",
    toX,
    toY,
  });
  assert.equal(distant.snapped, false);
  assert.deepEqual(distant.point, distantPoint);
});

test("duplicate OHLC prices have deterministic field identity", () => {
  const flat: Candle[] = [
    { time: 50, open: 10, high: 10, low: 10, close: 10, volume: 1 },
  ];
  const result = snapPointToOhlc({
    point: { time: 50, price: 11 },
    candles: flat,
    mode: "strong",
    toX,
    toY,
  });
  assert.equal(result.field, "open");
});

test("Ctrl/Cmd temporary toggle inverts persisted magnet enablement", () => {
  assert.equal(effectiveMagnetMode(false, "strong", false), null);
  assert.equal(effectiveMagnetMode(false, "strong", true), "strong");
  assert.equal(effectiveMagnetMode(true, "weak", false), "weak");
  assert.equal(effectiveMagnetMode(true, "weak", true), null);
});

test("indicator magnet chooses the nearest visible overlay value and preserves pressure", () => {
  const result = snapPointToIndicator({
    point: { time: 191, price: 21.4, pressure: 0.7 },
    indicators: [
      { time: 100, value: 11, sourceId: "sma", seriesKey: "sma" },
      { time: 200, value: 21, sourceId: "ema", seriesKey: "ema" },
      { time: 200, value: 24, sourceId: "bands", seriesKey: "upper" },
    ],
    toX,
    toY,
  });
  assert.equal(result.snapped, true);
  assert.deepEqual(result.point, { time: 200, price: 21, pressure: 0.7 });
  assert.equal(result.sourceId, "ema");
  assert.equal(result.seriesKey, "ema");
});

test("Snap to indicators augments Weak/Strong OHLC candidates", () => {
  const point = { time: 190, price: 23.4 };
  const fallback = snapPointWithMagnetSources({
    point,
    candles,
    indicators: [],
    mode: "strong",
    snapToIndicators: true,
    toX,
    toY,
  });
  assert.equal(fallback.source, "ohlc");
  assert.deepEqual(fallback.point, { time: 200, price: 24 });

  const indicatorWins = snapPointWithMagnetSources({
    point,
    candles,
    indicators: [{ time: 190, value: 23.5, sourceId: "ema" }],
    mode: "strong",
    snapToIndicators: true,
    toX,
    toY,
  });
  assert.equal(indicatorWins.source, "indicator");
  assert.deepEqual(indicatorWins.point, { time: 190, price: 23.5 });

  const disabled = snapPointWithMagnetSources({
    point,
    candles,
    indicators: [{ time: 190, value: 23.5 }],
    mode: "strong",
    snapToIndicators: false,
    toX,
    toY,
  });
  assert.equal(disabled.source, "ohlc");
});
