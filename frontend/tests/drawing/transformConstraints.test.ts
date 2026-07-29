import assert from "node:assert/strict";
import { test } from "node:test";

import { constrainMovePointerToAxis } from "../../src/components/chart/drawing/interaction/transformConstraints";

const toX = (time: number) => time * 10;
const toY = (price: number) => 1000 - price * 5;

test("whole-drawing Shift drag locks to the dominant horizontal screen axis", () => {
  assert.deepEqual(
    constrainMovePointerToAxis(
      { time: 10, price: 20 },
      { time: 18, price: 22 },
      toX,
      toY,
    ),
    { time: 18, price: 20 },
  );
});

test("whole-drawing Shift drag locks to the dominant vertical screen axis", () => {
  assert.deepEqual(
    constrainMovePointerToAxis(
      { time: 10, price: 20 },
      { time: 11, price: 30 },
      toX,
      toY,
    ),
    { time: 10, price: 30 },
  );
});

test("axis constraint falls back safely when projection is unavailable", () => {
  const pointer = { time: 18, price: 22 };
  assert.equal(
    constrainMovePointerToAxis(
      { time: 10, price: 20 },
      pointer,
      () => null,
      toY,
    ),
    pointer,
  );
});
