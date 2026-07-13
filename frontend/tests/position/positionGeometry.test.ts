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

test("body drag preserves logical Position width across a closed-market gap", () => {
  const friday = 1_783_719_900;
  const monday = 1_783_912_500;
  const candles = [
    { time: friday - 900 },
    { time: friday },
    ...Array.from({ length: 30 }, (_, index) => ({
      time: monday + index * 900,
    })),
  ];
  const original: Point[] = [
    { time: candles[1].time, price: 1.14 },
    { time: candles[21].time, price: 1.15 },
    { time: candles[21].time, price: 1.13 },
  ];
  const moved = movePosition(
    original,
    { time: candles[2].time, price: 1.141 },
    { time: candles[1].time, price: 1.14 },
    { tickSize: 0.00001, barIntervalSeconds: 900, candles },
  );

  assert.equal(moved[0].time, candles[2].time);
  assert.equal(moved[1].time, candles[22].time);
  assert.equal(moved[2].time, candles[22].time);
});

test("body drag preserves a future right edge across a closed-market gap", () => {
  const friday = 1_783_719_900;
  const monday = 1_783_912_500;
  const candles = [
    { time: friday - 900 },
    { time: friday },
    ...Array.from({ length: 4 }, (_, index) => ({
      time: monday + index * 900,
    })),
  ];
  const lastIndex = candles.length - 1;
  const rightLogicalIndex = 21;
  const futureRight = candles[lastIndex].time +
    (rightLogicalIndex - lastIndex) * 900;
  const original: Point[] = [
    { time: candles[1].time, price: 1.14 },
    { time: futureRight, price: 1.15 },
    { time: futureRight, price: 1.13 },
  ];
  const moved = movePosition(
    original,
    { time: candles[2].time, price: 1.141 },
    { time: candles[1].time, price: 1.14 },
    { tickSize: 0.00001, barIntervalSeconds: 900, candles },
  );

  assert.equal(moved[0].time, candles[2].time);
  assert.equal(
    moved[1].time,
    candles[lastIndex].time + (22 - lastIndex) * 900,
  );
  assert.equal(moved[2].time, moved[1].time);
});

test("crossed Position handles retain a visible logical-bar width", () => {
  const candles = Array.from({ length: 30 }, (_, index) => ({
    time: 1_000 + index * 900,
  }));
  const points: Point[] = [
    { time: candles[5].time, price: 100 },
    { time: candles[20].time, price: 110 },
    { time: candles[20].time, price: 90 },
  ];
  const context = {
    tickSize: tick,
    barIntervalSeconds: 900,
    barSpacing: 1.5,
    candles,
  };
  const rightCrossed = movePositionAnchor(
    points,
    POSITION_ANCHORS.ENTRY_RIGHT,
    { time: candles[1].time, price: 100 },
    context,
  );
  assert.equal(rightCrossed[1].time, candles[13].time);
  assert.equal(rightCrossed[2].time, candles[13].time);

  const leftCrossed = movePositionAnchor(
    points,
    POSITION_ANCHORS.ENTRY_LEFT,
    { time: candles[29].time, price: 100 },
    context,
  );
  assert.equal(leftCrossed[0].time, candles[12].time);
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
