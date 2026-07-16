import assert from "node:assert/strict";
import { test } from "node:test";

import { simplifyProjectedPoints } from "../../src/components/chart/drawing/interaction/FreeformSimplification";

const identity = (value: number) => value;

test("freeform simplification removes sub-pixel noise and preserves endpoints", () => {
  const points = [
    { time: 0, price: 0, pressure: 0.4 },
    { time: 1, price: 0.1, pressure: 0.4 },
    { time: 2, price: -0.1, pressure: 0.4 },
    { time: 3, price: 0, pressure: 0.4 },
  ];
  assert.deepEqual(simplifyProjectedPoints(points, identity, identity, 0.75), [points[0], points[3]]);
});

test("freeform simplification preserves a straight variable-pressure ramp", () => {
  const points = Array.from({ length: 21 }, (_, index) => ({
    time: index,
    price: 0,
    pressure: index / 20,
  }));
  const simplified = simplifyProjectedPoints(points, identity, identity, 0.75);

  assert.ok(simplified.length > 2, "a pressure ramp must not become one constant-width segment");
  for (let index = 1; index < simplified.length; index += 1) {
    assert.ok(
      Math.abs(simplified[index].pressure! - simplified[index - 1].pressure!) <= 0.1 + Number.EPSILON,
      "adjacent retained samples keep pressure changes bounded",
    );
  }
});

test("freeform simplification preserves a pressure spike on a straight stroke", () => {
  const points = [
    { time: 0, price: 0, pressure: 0.2 },
    { time: 1, price: 0, pressure: 0.2 },
    { time: 2, price: 0, pressure: 1 },
    { time: 3, price: 0, pressure: 0.2 },
    { time: 4, price: 0, pressure: 0.2 },
  ];
  const simplified = simplifyProjectedPoints(points, identity, identity, 0.75);

  assert.ok(simplified.some((point) => point.pressure === 1));
});

test("freeform simplification retains meaningful corners and is projection-safe", () => {
  const points = [
    { time: 0, price: 0 },
    { time: 10, price: 0 },
    { time: 10, price: 10 },
  ];
  assert.deepEqual(simplifyProjectedPoints(points, identity, identity, 0.75), points);
  assert.deepEqual(simplifyProjectedPoints(points, () => null, identity, 0.75), points);
});
