import assert from "node:assert/strict";
import { test } from "node:test";

import type { Drawing } from "../../src/types";
import {
  lineStatItems,
  lineStatsAnchor,
  resolveEnabledLineStats,
} from "../../src/components/chart/drawing/tools/plugins/lineStats";

const drawing: Drawing = {
  id: "line",
  tool: "trendline",
  color: "#2962ff",
  lineWidth: 2,
  points: [
    { time: 100, price: 1.1 },
    { time: 400, price: 1.102 },
  ],
  lineStats: [
    "priceRange",
    "percentChange",
    "pips",
    "barsRange",
    "dateTimeRange",
    "distance",
    "angle",
  ],
};

const anchors = { a: { x: 20, y: 80 }, b: { x: 120, y: 40 } };
const projector = {
  toX: (value: number) => value,
  toY: (value: number) => value,
  width: 300,
  height: 200,
  barIntervalSeconds: 60,
  market: {
    symbol: "EURUSD",
    candles: [],
    tickSize: 0.00001,
    pricePrecision: 5,
  },
};

test("line family exposes TradingView's seven independent stats", () => {
  const items = lineStatItems(drawing, anchors, projector);
  assert.deepEqual(items.map((item) => item.id), drawing.lineStats);
  assert.equal(items.find((item) => item.id === "barsRange")?.text, "5 bars");
  assert.equal(items.find((item) => item.id === "dateTimeRange")?.text, "5m");
  assert.match(items.find((item) => item.id === "pips")?.text ?? "", /20(?:\.0)? pips/);
  assert.match(items.find((item) => item.id === "angle")?.text ?? "", /°$/);
});

test("legacy combined stat migrates in memory and positions stay independent", () => {
  assert.deepEqual(resolveEnabledLineStats({ ...drawing, lineStats: undefined, showStats: true }), [
    "priceRange",
    "percentChange",
  ]);
  assert.deepEqual(lineStatsAnchor(anchors, "left", 300), { x: 26, y: 85 });
  assert.deepEqual(lineStatsAnchor(anchors, "center", 300), { x: 76, y: 65 });
  assert.deepEqual(lineStatsAnchor(anchors, "right", 300), { x: 126, y: 45 });
});

test("bars range counts logical market bars across session gaps", () => {
  const withWeekendGap = {
    ...projector,
    barIntervalSeconds: 86_400,
    market: {
      ...projector.market,
      candles: [
        { time: 100, open: 1, high: 1, low: 1, close: 1, volume: 1 },
        { time: 86_500, open: 1, high: 1, low: 1, close: 1, volume: 1 },
        { time: 345_700, open: 1, high: 1, low: 1, close: 1, volume: 1 },
        { time: 432_100, open: 1, high: 1, low: 1, close: 1, volume: 1 },
      ],
    },
  };
  const items = lineStatItems({
    ...drawing,
    points: [
      { time: 100, price: 1.1 },
      { time: 432_100, price: 1.102 },
    ],
  }, anchors, withWeekendGap);
  assert.equal(items.find((item) => item.id === "barsRange")?.text, "3 bars");
  assert.match(items.find((item) => item.id === "distance")?.text ?? "", /px$/);
});

test("pip inference distinguishes standard and fractional FX quote precision", () => {
  const cases = [
    { name: "EURUSD 4-digit", tickSize: 0.0001, pricePrecision: 4, from: 1.1, to: 1.102 },
    { name: "EURUSD 5-digit", tickSize: 0.00001, pricePrecision: 5, from: 1.1, to: 1.102 },
    { name: "USDJPY 2-digit", tickSize: 0.01, pricePrecision: 2, from: 150, to: 150.2 },
    { name: "USDJPY 3-digit", tickSize: 0.001, pricePrecision: 3, from: 150, to: 150.2 },
  ] as const;

  for (const quote of cases) {
    const [item] = lineStatItems(
      {
        ...drawing,
        points: [
          { time: 100, price: quote.from },
          { time: 400, price: quote.to },
        ],
        lineStats: ["pips"],
      },
      anchors,
      {
        ...projector,
        market: {
          ...projector.market,
          tickSize: quote.tickSize,
          pricePrecision: quote.pricePrecision,
        },
      },
    );
    assert.match(item.text, /^\+20(?:\.0)? pips$/, quote.name);
  }
});
