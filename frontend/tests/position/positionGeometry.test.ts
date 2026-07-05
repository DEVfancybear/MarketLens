import assert from "node:assert/strict";
import { test } from "node:test";

import type { Point } from "../../src/types/drawing";
import {
  movePosition,
  movePositionAnchor,
  POSITION_ANCHORS,
  positionSideFromPoints,
} from "../../src/components/chart/drawing/tools/positionGeometry";

const tick = 0.1;

function longPoints(): Point[] {
  return [
    { time: 1000, price: 100 },
    { time: 1020, price: 110 },
    { time: 1020, price: 90 },
  ];
}

function shortPoints(): Point[] {
  return [
    { time: 1000, price: 100 },
    { time: 1020, price: 90 },
    { time: 1020, price: 110 },
  ];
}

test("position side is inferred from target and stop around entry", () => {
  assert.equal(positionSideFromPoints(longPoints()), "long");
  assert.equal(positionSideFromPoints(shortPoints()), "short");
});

test("body drag moves all points and preserves the right-edge width", () => {
  const moved = movePosition(
    longPoints(),
    { time: 1005, price: 101.23 },
    { time: 1000, price: 100 },
    tick,
  );

  assert.deepEqual(moved, [
    { time: 1005, price: 101.2 },
    { time: 1025, price: 111.2 },
    { time: 1025, price: 91.2 },
  ]);
  assert.equal(moved[1].time - moved[0].time, 20);
  assert.equal(moved[1].time, moved[2].time);
});

test("left target handle resizes left edge and target price only", () => {
  const moved = movePositionAnchor(
    longPoints(),
    POSITION_ANCHORS.TARGET_LEFT,
    { time: 990, price: 112.34 },
    tick,
  );

  assert.equal(moved[0].time, 990);
  assert.equal(moved[0].price, 100);
  assert.equal(moved[1].time, 1020);
  assert.equal(moved[1].price, 112.3);
  assert.equal(moved[2].price, 90);
});

test("right entry handle resizes right edge and entry price", () => {
  const moved = movePositionAnchor(
    longPoints(),
    POSITION_ANCHORS.ENTRY_RIGHT,
    { time: 1040, price: 101.24 },
    tick,
  );

  assert.equal(moved[0].time, 1000);
  assert.equal(moved[0].price, 101.2);
  assert.equal(moved[1].time, 1040);
  assert.equal(moved[2].time, 1040);
});

test("long and short handles clamp levels to the correct side of entry", () => {
  const longMoved = movePositionAnchor(
    longPoints(),
    POSITION_ANCHORS.TARGET_RIGHT,
    { time: 1030, price: 95 },
    tick,
  );
  assert.equal(longMoved[1].price, 105);
  assert.ok(longMoved[1].price > longMoved[0].price);

  const shortMoved = movePositionAnchor(
    shortPoints(),
    POSITION_ANCHORS.TARGET_RIGHT,
    { time: 1030, price: 105 },
    tick,
  );
  assert.equal(shortMoved[1].price, 95);
  assert.ok(shortMoved[1].price < shortMoved[0].price);
});
