import assert from "node:assert/strict";
import { test } from "node:test";

import type { Drawing } from "../../src/types/drawing";
import {
  hitTestPositionGeometry,
  positionAnchorsFromGeometry,
  positionGeometryBounds,
  projectPositionGeometry,
} from "../../src/components/chart/drawing/tools/positionProjectedGeometry";

const drawing: Drawing = {
  id: "position-geometry",
  tool: "long",
  color: "#089981",
  lineWidth: 1,
  points: [
    { time: 10, price: 100 },
    { time: 110, price: 130 },
    { time: 110, price: 80 },
  ],
};
const project = (value: number) => value;

test("projected position geometry owns all six virtual handles", () => {
  const geometry = projectPositionGeometry(drawing, { toX: project, toY: project });
  assert.ok(geometry);
  assert.deepEqual(
    positionAnchorsFromGeometry(geometry).map((anchor) => anchor.index),
    [0, 1, 2, 3, 4, 5],
  );
  assert.equal(
    hitTestPositionGeometry(drawing, 110, 130, project, project).some(
      (hit) => hit.anchorIndex === 3,
    ),
    true,
  );
  assert.deepEqual(positionGeometryBounds(drawing, project, project), {
    x: 10,
    y: 60,
    w: 100,
    h: 90,
  });
});
