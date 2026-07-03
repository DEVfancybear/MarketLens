import assert from "node:assert/strict";
import { test } from "node:test";

import type { Drawing } from "../../src/types/drawing";
import {
  buildOrderPrefillFromPositionDrawing,
  inferPositionOrderType,
} from "../../src/components/chart/drawing/tools/positionTradePrefill";

function position(tool: "long" | "short"): Drawing {
  return {
    id: "dw-test",
    tool,
    color: "#089981",
    lineWidth: 1,
    riskUnit: "%",
    riskValue: 2.5,
    points:
      tool === "long"
        ? [
            { time: 1000, price: 100 },
            { time: 1020, price: 110 },
            { time: 1020, price: 90 },
          ]
        : [
            { time: 1000, price: 100 },
            { time: 1020, price: 90 },
            { time: 1020, price: 110 },
          ],
  };
}

test("position order type follows side and entry relative to market", () => {
  assert.equal(inferPositionOrderType("long", 99, 100), "limit");
  assert.equal(inferPositionOrderType("long", 101, 100), "stop");
  assert.equal(inferPositionOrderType("short", 101, 100), "limit");
  assert.equal(inferPositionOrderType("short", 99, 100), "stop");
});

test("long position drawing fills trade ticket with entry, stop, target and risk", () => {
  assert.deepEqual(buildOrderPrefillFromPositionDrawing(position("long"), 101), {
    source: "position-drawing",
    side: "long",
    type: "limit",
    price: 100,
    stopLoss: 90,
    takeProfit: 110,
    riskPct: 2.5,
  });
});

test("short position drawing fills reversed stop and target", () => {
  assert.deepEqual(buildOrderPrefillFromPositionDrawing(position("short"), 99), {
    source: "position-drawing",
    side: "short",
    type: "limit",
    price: 100,
    stopLoss: 110,
    takeProfit: 90,
    riskPct: 2.5,
  });
});
