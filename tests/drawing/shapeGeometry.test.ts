import assert from "node:assert/strict";
import { test } from "node:test";

import type { Drawing } from "../../src/types/drawing";
import {
  anchorHits,
  boundsFromPoints,
  curveBodyHits,
  ellipseBodyHit,
  polygonBodyHits,
  quadControlThroughPoint,
  sampleQuadratic,
  type XY,
} from "../../src/components/chart/drawing/tools/plugins/shapeGeometry";

const drawing: Drawing = {
  id: "shape-test",
  tool: "triangle",
  color: "#2962ff",
  lineWidth: 1.5,
  points: [],
};

test("anchor hits preserve explicit anchor index for middle vertices", () => {
  const projected: XY[] = [
    { x: 0, y: 0 },
    { x: 100, y: 100 },
    { x: 200, y: 0 },
  ];

  const hits = anchorHits(drawing, projected, 100, 100);
  const middle = hits.find((hit) => hit.anchorIndex === 1);

  assert.ok(middle);
  assert.equal(middle.target, "p0");
});

test("ellipse body hit-test follows the ellipse, not the bounding rectangle", () => {
  const inside = ellipseBodyHit(drawing, 0, 0, 0, 0, 100, 20);
  const edge = ellipseBodyHit(drawing, 100, 0, 0, 0, 100, 20);
  const outsideCorner = ellipseBodyHit(drawing, 100, 20, 0, 0, 100, 20);

  assert.equal(inside.length, 1);
  assert.equal(edge.length, 1);
  assert.equal(outsideCorner.length, 0);
});

test("triangle/polygon body hit-test covers filled interior and closed edges", () => {
  const triangle: XY[] = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 5, y: 10 },
  ];

  assert.ok(polygonBodyHits(drawing, triangle, 5, 4).length > 0);
  assert.ok(polygonBodyHits(drawing, triangle, 5, 0).length > 0);
  assert.equal(polygonBodyHits(drawing, triangle, 40, 40).length, 0);
});

test("sampled quadratic curves hit-test and bound their visible curve body", () => {
  const start: XY = { x: 0, y: 0 };
  const end: XY = { x: 10, y: 0 };
  const peak: XY = { x: 5, y: 5 };
  const control = quadControlThroughPoint(start, end, peak);
  const samples = sampleQuadratic(start, control, end, 10);
  const bounds = boundsFromPoints(samples);

  assert.equal(samples[5].x, 5);
  assert.equal(samples[5].y, 5);
  assert.equal(curveBodyHits(drawing, samples, 5, 5).length, 1);
  assert.ok(bounds);
  assert.equal(bounds.y, 0);
  assert.equal(bounds.h, 5);
});
