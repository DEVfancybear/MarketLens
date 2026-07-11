import assert from "node:assert/strict";
import { test } from "node:test";

import type { Drawing } from "../../src/types/drawing";
import {
  detectPositionHit,
  resolvePositionHit,
} from "../../src/components/chart/drawing/tools/positionHitResolution";

const drawing: Drawing = {
  id: "position-hit",
  tool: "long",
  color: "#089981",
  lineWidth: 1,
  points: [
    { time: 10, price: 100 },
    { time: 20, price: 120 },
    { time: 20, price: 90 },
  ],
};

test("position resolution waits for entry and resolves a same-bar conflict to stop", () => {
  assert.equal(
    detectPositionHit(drawing, [
      { time: 10, low: 101, high: 125 },
      { time: 11, low: 99, high: 101 },
      { time: 12, low: 89, high: 121 },
    ])?.status,
    "sl_hit",
  );
});

test("position resolution preserves persisted hits when history does not cover entry", () => {
  const persisted: Drawing = {
    ...drawing,
    tradeStatus: "tp_hit",
    hitTime: 4,
    hitPrice: 120,
  };
  assert.deepEqual(
    resolvePositionHit(persisted, [{ time: 30, low: 80, high: 100 }]),
    { status: "tp_hit", time: 14, price: 120 },
  );
});
