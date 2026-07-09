import assert from "node:assert/strict";
import { test } from "node:test";

import { indicatorPaneTimeAnchorData } from "../../src/components/chart/indicatorPaneTimeScale";
import type { Candle, IndicatorResult } from "../../src/types";

const candles: Candle[] = [
  { time: 1000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 },
  { time: 1060, open: 1.5, high: 2, low: 1, close: 1.7, volume: 11 },
  { time: 1120, open: 1.7, high: 2, low: 1, close: 1.2, volume: 12 },
  { time: 1180, open: 1.2, high: 2, low: 1, close: 1.4, volume: 13 },
];

test("indicator pane anchor preserves every candle timestamp", () => {
  const sparseResult: IndicatorResult = {
    id: "rsi",
    series: [
      {
        key: "RSI",
        color: "#fff",
        type: "line",
        data: [
          { time: 1120, value: 55 },
          { time: 1180, value: 61 },
        ],
      },
    ],
  };

  assert.deepEqual(
    indicatorPaneTimeAnchorData(candles, sparseResult).map((point) => point.time),
    [1000, 1060, 1120, 1180],
  );
});

test("indicator pane anchor uses an in-range indicator value", () => {
  const result: IndicatorResult = {
    id: "rsi",
    series: [
      {
        key: "fill",
        color: "rgba(0,0,0,0.1)",
        type: "baselineFill",
        data: [],
      },
      {
        key: "RSI",
        color: "#fff",
        type: "line",
        data: [{ time: 1120, value: 57.5 }],
      },
    ],
  };

  assert.deepEqual(
    indicatorPaneTimeAnchorData(candles, result).map((point) => point.value),
    [57.5, 57.5, 57.5, 57.5],
  );
});

test("indicator pane anchor adds right-offset logical slots", () => {
  const result: IndicatorResult = {
    id: "rsi",
    series: [
      {
        key: "RSI",
        color: "#fff",
        type: "line",
        data: [{ time: 1120, value: 50 }],
      },
    ],
  };

  assert.deepEqual(
    indicatorPaneTimeAnchorData(candles, result, { from: 1, to: 6 }).map(
      (point) => point.time,
    ),
    [1000, 1060, 1120, 1180, 1240, 1300, 1360],
  );
});
