import assert from "node:assert/strict";
import { test } from "node:test";

import type { Drawing } from "../../src/types/drawing";
import {
  channelBodyHits,
  channelBounds,
  projectChannel,
} from "../../src/components/chart/drawing/tools/plugins/channelGeometry";

const project = (value: number) => value;

function channel(points: Drawing["points"]): Drawing {
  return {
    id: "channel-test",
    tool: "channel",
    color: "#2962ff",
    lineWidth: 2,
    points,
  };
}

test("three-anchor channel sides are parallel and the second side is hittable", () => {
  const drawing = channel([
    { time: 10, price: 10 },
    { time: 110, price: 60 },
    { time: 40, price: 100 },
  ]);
  const geometry = projectChannel(drawing, project, project);
  assert.ok(geometry);
  assert.equal(geometry.legacy, false);

  const baseDelta = {
    x: geometry.baseline.b.x - geometry.baseline.a.x,
    y: geometry.baseline.b.y - geometry.baseline.a.y,
  };
  const parallelDelta = {
    x: geometry.parallel.b.x - geometry.parallel.a.x,
    y: geometry.parallel.b.y - geometry.parallel.a.y,
  };
  assert.deepEqual(parallelDelta, baseDelta);

  const middle = {
    x: (geometry.parallel.a.x + geometry.parallel.b.x) / 2,
    y: (geometry.parallel.a.y + geometry.parallel.b.y) / 2,
  };
  assert.equal(channelBodyHits(drawing, geometry, middle.x, middle.y).length, 1);
});

test("legacy two-point channel keeps its historical projected secondary line", () => {
  const drawing = channel([
    { time: 10, price: 20 },
    { time: 110, price: 70 },
  ]);
  const geometry = projectChannel(drawing, project, project);
  assert.ok(geometry);
  assert.equal(geometry.legacy, true);
  assert.deepEqual(geometry.parallel, {
    a: { x: 10, y: 120 },
    b: { x: 110, y: 70 },
  });
  const bounds = channelBounds(geometry);
  assert.ok(bounds && bounds.w < 200 && bounds.h < 200);
});
