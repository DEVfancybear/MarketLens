import assert from "node:assert/strict";
import { test } from "node:test";

import { CreationSession } from "../../src/components/chart/drawing/interaction/CreationSession";

const point = (time: number, price = time) => ({ time, price });
const sample = (time: number, x = time, stamp = time * 100) => ({
  point: point(time),
  clientX: x,
  clientY: x,
  timeStamp: stamp,
});

test("one and two-point creation sessions commit at their manifest boundary", () => {
  const horizontal = new CreationSession("horizontal");
  assert.deepEqual(horizontal.pointerDown(sample(1)), {
    kind: "commit",
    points: [point(1)],
  });

  const trendline = new CreationSession("trendline");
  assert.equal(trendline.pointerDown(sample(1)).kind, "preview");
  assert.deepEqual(trendline.pointerMove(point(2)), {
    kind: "preview",
    points: [point(1), point(2)],
  });
  assert.deepEqual(trendline.pointerDown(sample(3)), {
    kind: "commit",
    points: [point(1), point(3)],
  });
});

test("fixed multi-point creation commits exactly at maxPoints", () => {
  const triangle = new CreationSession("triangle");
  assert.equal(triangle.pointerDown(sample(1)).kind, "preview");
  assert.equal(triangle.pointerDown(sample(2)).kind, "preview");
  assert.deepEqual(triangle.pointerDown(sample(3)), {
    kind: "commit",
    points: [point(1), point(2), point(3)],
  });
});

test("freeform supports explicit finish and double-click completion without duplicate points", () => {
  const explicit = new CreationSession("path");
  explicit.pointerDown(sample(1, 10, 100));
  explicit.pointerDown(sample(2, 30, 500));
  assert.deepEqual(explicit.finish(), {
    kind: "commit",
    points: [point(1), point(2)],
  });

  const doubled = new CreationSession("path");
  doubled.pointerDown(sample(1, 10, 100));
  doubled.pointerDown(sample(2, 30, 500));
  assert.deepEqual(doubled.pointerDown(sample(3, 32, 700)), {
    kind: "commit",
    points: [point(1), point(2)],
  });
});

test("continuous sessions own sampling and cancel when below minimum", () => {
  const brush = new CreationSession("brush");
  brush.pointerDown(sample(1));
  assert.deepEqual(brush.pointerMove(point(2), false), {
    kind: "preview",
    points: [point(1)],
  });
  assert.equal(brush.pointerUp(undefined).kind, "cancel");

  const stroke = new CreationSession("brush");
  stroke.pointerDown(sample(1));
  stroke.pointerMove(point(2));
  assert.deepEqual(stroke.pointerUp(point(3)), {
    kind: "commit",
    points: [point(1), point(2), point(3)],
  });
});

test("Escape-style cancel never commits a partially valid freeform drawing", () => {
  const path = new CreationSession("path");
  path.pointerDown(sample(1));
  path.pointerDown(sample(2));
  assert.deepEqual(path.cancel(), { kind: "cancel" });
});
