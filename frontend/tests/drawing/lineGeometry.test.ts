import assert from "node:assert/strict";
import { test } from "node:test";

import type { Drawing, Point } from "../../src/types/drawing";
import {
  extendedLineBodyHits,
  horizontalRayBodyHits,
  moveHorizontalLine,
  moveVerticalLine,
  rayBodyHits,
  twoPointAnchorHits,
  type Segment,
} from "../../src/components/chart/drawing/tools/plugins/lineGeometry";

const drawing: Drawing = {
  id: "line-test",
  tool: "ray",
  color: "#2962ff",
  lineWidth: 1.5,
  points: [],
};

test("ray body hit follows the first-to-second anchor direction", () => {
  const leftRay: Segment = {
    a: { x: 100, y: 100 },
    b: { x: 50, y: 100 },
  };

  assert.equal(rayBodyHits(drawing, leftRay, 20, 100).length, 1);
  assert.equal(rayBodyHits(drawing, leftRay, 150, 100).length, 0);
});

test("extended line body hit works on both sides of the anchors", () => {
  const segment: Segment = {
    a: { x: 80, y: 100 },
    b: { x: 120, y: 100 },
  };

  assert.equal(extendedLineBodyHits(drawing, segment, 20, 100).length, 1);
  assert.equal(extendedLineBodyHits(drawing, segment, 180, 100).length, 1);
});

test("horizontal ray only selects from its start point to the right", () => {
  const start = { x: 50, y: 40 };

  assert.equal(horizontalRayBodyHits(drawing, start, 80, 40).length, 1);
  assert.equal(horizontalRayBodyHits(drawing, start, 10, 40).length, 0);
});

test("line anchor hits preserve explicit endpoint anchor indices", () => {
  const segment: Segment = {
    a: { x: 10, y: 10 },
    b: { x: 100, y: 10 },
  };

  const first = twoPointAnchorHits(drawing, segment, 10, 10);
  const second = twoPointAnchorHits(drawing, segment, 100, 10);

  assert.equal(first[0].anchorIndex, 0);
  assert.equal(first[0].target, "p1");
  assert.equal(second[0].anchorIndex, 1);
  assert.equal(second[0].target, "p2");
});

test("horizontal and vertical line moves are axis constrained", () => {
  const points: Point[] = [{ time: 1000, price: 100 }];

  assert.deepEqual(moveHorizontalLine(points, { time: 2000, price: 120 }), [
    { time: 1000, price: 120 },
  ]);
  assert.deepEqual(moveVerticalLine(points, { time: 2000, price: 120 }), [
    { time: 2000, price: 100 },
  ]);
});
