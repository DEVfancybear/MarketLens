import assert from "node:assert/strict";
import { test } from "node:test";

import type { Drawing } from "../../src/types/drawing";
import {
  ELLIPSE_AXIS_HANDLES,
  ellipseSelectionAnchors,
  moveEllipseSelectionAnchor,
} from "../../src/components/chart/drawing/tools/ellipseSelectionHandles";

const fixture: Drawing = {
  id: "ellipse",
  tool: "ellipse",
  color: "#2962ff",
  lineWidth: 2,
  points: [
    { time: 10, price: 30 },
    { time: 30, price: 10 },
  ],
};

test("ellipse exposes four semantic axis handles", () => {
  assert.deepEqual(
    ellipseSelectionAnchors(
      fixture,
      (value) => value,
      (value) => 100 - value,
    ).map(({ index, x, y }) => ({ index, x, y })),
    [
      { index: 0, x: 10, y: 80 },
      { index: 1, x: 20, y: 70 },
      { index: 2, x: 30, y: 80 },
      { index: 3, x: 20, y: 90 },
    ],
  );
});

test("each ellipse axis handle changes only its semantic radius", () => {
  assert.deepEqual(
    moveEllipseSelectionAnchor(
      fixture.points,
      ELLIPSE_AXIS_HANDLES.TIME_MIN,
      { time: 5, price: 999 },
    ),
    [
      { time: 5, price: 30 },
      { time: 30, price: 10 },
    ],
  );
  assert.deepEqual(
    moveEllipseSelectionAnchor(
      fixture.points,
      ELLIPSE_AXIS_HANDLES.PRICE_MIN,
      { time: 999, price: 5 },
    ),
    [
      { time: 10, price: 30 },
      { time: 30, price: 5 },
    ],
  );
});
