import assert from "node:assert/strict";
import { test } from "node:test";

import { nudgeDrawingPoints } from "../../src/components/chart/drawing/interaction/drawingNudge";

const context = {
  tickSize: 0.0001,
  barIntervalSeconds: 60,
  candles: [
    { time: 60 },
    { time: 120 },
    { time: 180 },
    { time: 600 },
  ],
};

test("horizontal nudge moves one logical bar across market-time gaps", () => {
  assert.deepEqual(
    nudgeDrawingPoints(
      [{ time: 180, price: 1 }, { time: 600, price: 2 }],
      "right",
      context,
    ),
    [{ time: 600, price: 1 }, { time: 660, price: 2 }],
  );
});

test("vertical nudge moves every point by one minimum tick", () => {
  assert.deepEqual(
    nudgeDrawingPoints(
      [{ time: 180, price: 1 }, { time: 600, price: 2 }],
      "up",
      context,
    ),
    [{ time: 180, price: 1.0001 }, { time: 600, price: 2.0001 }],
  );
});

test("nudge is a safe no-op when required market units are unavailable", () => {
  const points = [{ time: 180, price: 1 }];
  assert.deepEqual(nudgeDrawingPoints(points, "left"), points);
  assert.deepEqual(nudgeDrawingPoints(points, "up"), points);
});
