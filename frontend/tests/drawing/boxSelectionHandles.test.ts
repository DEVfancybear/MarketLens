import assert from "node:assert/strict";
import { test } from "node:test";

import type { Drawing } from "../../src/types/drawing";
import {
  BOX_HANDLES,
  boxSelectionAnchors,
  moveBoxSelectionAnchor,
} from "../../src/components/chart/drawing/tools/boxSelectionHandles";
import { getTool } from "../../src/components/chart/drawing/tools/ToolRegistry";
import "../../src/components/chart/drawing/tools/plugins/RectangleTool";

const fixture: Drawing = {
  id: "rectangle",
  tool: "rectangle",
  color: "#2962ff",
  lineWidth: 2,
  points: [
    { time: 10, price: 10 },
    { time: 30, price: 30 },
  ],
};

const toX = (value: number) => value;
const toY = (value: number) => 100 - value;

test("two persisted rectangle corners expose eight derived edit handles", () => {
  assert.deepEqual(
    boxSelectionAnchors(fixture, toX, toY).map((anchor) => ({
      index: anchor.index,
      x: anchor.x,
      y: anchor.y,
    })),
    [
      { index: 0, x: 10, y: 70 },
      { index: 1, x: 20, y: 70 },
      { index: 2, x: 30, y: 70 },
      { index: 3, x: 30, y: 80 },
      { index: 4, x: 30, y: 90 },
      { index: 5, x: 20, y: 90 },
      { index: 6, x: 10, y: 90 },
      { index: 7, x: 10, y: 80 },
    ],
  );

  const rectangle = getTool("rectangle");
  assert.ok(rectangle);
  for (const anchor of rectangle.getAnchors(fixture, toX, toY)) {
    assert.ok(anchor.x != null && anchor.y != null);
    assert.ok(
      rectangle
        .hitTest(fixture, anchor.x, anchor.y, toX, toY)
        .some((hit) => hit.anchorIndex === anchor.index),
      `handle ${anchor.index} keeps its hit identity`,
    );
  }
});

test("rectangle corner handles resize two axes and edge handles resize one", () => {
  assert.deepEqual(
    moveBoxSelectionAnchor(
      fixture.points,
      BOX_HANDLES.TOP_LEFT,
      { time: 5, price: 40 },
    ),
    [
      { time: 5, price: 40 },
      { time: 30, price: 10 },
    ],
  );

  assert.deepEqual(
    moveBoxSelectionAnchor(
      fixture.points,
      BOX_HANDLES.TOP_CENTER,
      { time: 999, price: 40 },
    ),
    [
      { time: 10, price: 40 },
      { time: 30, price: 10 },
    ],
    "top edge changes price without changing time",
  );

  assert.deepEqual(
    moveBoxSelectionAnchor(
      fixture.points,
      BOX_HANDLES.RIGHT_CENTER,
      { time: 40, price: 999 },
    ),
    [
      { time: 10, price: 30 },
      { time: 40, price: 10 },
    ],
    "right edge changes time without changing price",
  );
});

test("rectangle handles can cross the opposite edge without invalid geometry", () => {
  assert.deepEqual(
    moveBoxSelectionAnchor(
      fixture.points,
      BOX_HANDLES.TOP_LEFT,
      { time: 40, price: 5 },
    ),
    [
      { time: 30, price: 10 },
      { time: 40, price: 5 },
    ],
  );
});
