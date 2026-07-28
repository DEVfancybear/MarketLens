import assert from "node:assert/strict";
import { test } from "node:test";
import type { Drawing } from "../../src/types/drawing";
import {
  formatAxisTime,
  timeAxisLabelRect,
} from "../../src/components/chart/drawing/tools/plugins/axisLabels";

const REPORTED_CANDLE_TIME =
  Date.UTC(2026, 6, 24, 20, 45, 0, 0) / 1000;

const verticalDrawing: Drawing = {
  id: "timezone-regression",
  tool: "vertical",
  color: "#2962ff",
  lineWidth: 1.5,
  points: [{ time: REPORTED_CANDLE_TIME, price: 1 }],
};

test("drawing time-axis labels format one UTC coordinate in the selected IANA zone", () => {
  assert.equal(
    formatAxisTime(REPORTED_CANDLE_TIME, "UTC"),
    "Fri 24 Jul 26 20:45",
  );
  assert.equal(
    formatAxisTime(REPORTED_CANDLE_TIME, "Asia/Ho_Chi_Minh"),
    "Sat 25 Jul 26 03:45",
  );
});

test("drawing time-axis label geometry uses the projector display timezone", () => {
  const rect = timeAxisLabelRect(
    verticalDrawing,
    {
      width: 600,
      height: 400,
      market: {
        symbol: "AUDUSD",
        candles: [],
        timeZone: "Asia/Ho_Chi_Minh",
      },
    },
    300,
  );

  assert.equal(rect.text, "Sat 25 Jul 26 03:45");
  assert.equal(rect.y, 377);
});
