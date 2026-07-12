import assert from "node:assert/strict";
import { test } from "node:test";

import { simplifyProjectedPoints } from "../../src/components/chart/drawing/interaction/FreeformSimplification";

const identity = (value: number) => value;

test("freeform simplification removes sub-pixel noise and preserves endpoints", () => {
  const points = [
    { time: 0, price: 0, pressure: 0.1 },
    { time: 1, price: 0.1, pressure: 0.2 },
    { time: 2, price: -0.1, pressure: 0.3 },
    { time: 3, price: 0, pressure: 0.4 },
  ];
  assert.deepEqual(simplifyProjectedPoints(points, identity, identity, 0.75), [points[0], points[3]]);
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
