import assert from "node:assert/strict";
import { test } from "node:test";

import type { Drawing } from "../../src/types/drawing";
import { TransformSession } from "../../src/components/chart/drawing/interaction/TransformSession";
import "../../src/components/chart/drawing/tools/plugins/TrendLineTool";
import "../../src/components/chart/drawing/tools/plugins/VerticalTool";

function drawing(id: string, tool: Drawing["tool"], offset = 0): Drawing {
  return {
    id,
    tool,
    color: "#2962ff",
    lineWidth: 1.5,
    points: [
      { time: 10 + offset, price: 20 + offset },
      { time: 30 + offset, price: 40 + offset },
    ],
  };
}

test("move session translates from its immutable pointer-down snapshot", () => {
  const session = new TransformSession({
    drawing: drawing("a", "trendline"),
    dragStart: { time: 10, price: 20 },
    anchorIndex: -1,
    mode: "move",
  });
  assert.deepEqual(session.update({ time: 15, price: 27 }).get("a"), [
    { time: 15, price: 27 },
    { time: 35, price: 47 },
  ]);
  assert.deepEqual(session.primaryOriginal[0], { time: 10, price: 20 });
  assert.equal(session.hasChanged("a", session.primaryOriginal), false);
  assert.equal(session.hasChanged("a", session.update({ time: 15, price: 27 }).get("a")!), true);
});

test("move preserves every anchor span when crossing a market data gap", () => {
  const subject = drawing("gap", "trendline");
  subject.points = [
    { time: 20, price: 20 },
    { time: 40, price: 40 },
  ];
  const session = new TransformSession({
    drawing: subject,
    dragStart: { time: 20, price: 30 },
    anchorIndex: -1,
    mode: "move",
    adapterContext: {
      barIntervalSeconds: 10,
      candles: [
        { time: 10 },
        { time: 20 },
        { time: 30 },
        { time: 40 },
        // Weekend/session gap: the next logical bar is not time + 10.
        { time: 100 },
        { time: 110 },
        { time: 120 },
      ],
    },
  });

  assert.deepEqual(session.update({ time: 100, price: 35 }).get("gap"), [
    { time: 100, price: 25 },
    { time: 120, price: 45 },
  ]);
});

test("resize session delegates anchor constraints to the adapter", () => {
  const vertical = drawing("v", "vertical");
  vertical.points = vertical.points.slice(0, 1);
  const session = new TransformSession({
    drawing: vertical,
    dragStart: { time: 10, price: 20 },
    anchorIndex: 0,
    mode: "resize",
  });
  assert.deepEqual(session.update({ time: 50, price: 999 }).get("v"), [
    { time: 50, price: 20 },
  ]);
});

test("multi-move translates every selected drawing in one session", () => {
  const first = drawing("a", "trendline");
  const second = drawing("b", "trendline", 5);
  const session = new TransformSession({
    drawing: first,
    dragStart: { time: 10, price: 20 },
    anchorIndex: -1,
    mode: "move",
    selectedDrawings: [first, second],
  });
  const update = session.update({ time: 12, price: 23 });
  assert.deepEqual(update.get("a")?.[0], { time: 12, price: 23 });
  assert.deepEqual(update.get("b")?.[0], { time: 17, price: 28 });
  assert.deepEqual(session.originalPointsFor("b")?.[0], { time: 15, price: 25 });
});

test("multi-move uses the same logical-bar translation for every drawing", () => {
  const first = drawing("a", "trendline");
  const second = drawing("b", "trendline", 10);
  second.points = [
    { time: 20, price: 30 },
    { time: 100, price: 50 },
  ];
  const session = new TransformSession({
    drawing: first,
    dragStart: { time: 10, price: 20 },
    anchorIndex: -1,
    mode: "move",
    selectedDrawings: [first, second],
    adapterContext: {
      barIntervalSeconds: 10,
      candles: [
        { time: 10 }, { time: 20 }, { time: 30 }, { time: 100 },
        { time: 110 }, { time: 120 }, { time: 130 },
      ],
    },
  });

  const update = session.update({ time: 100, price: 22 });
  assert.deepEqual(update.get("a")?.map((point) => point.time), [100, 120]);
  assert.deepEqual(update.get("b")?.map((point) => point.time), [110, 130]);
});

test("move snapping aligns the primary reference anchor while resize snaps directly", () => {
  const subject = drawing("snap", "trendline");
  const move = new TransformSession({
    drawing: subject,
    dragStart: { time: 15, price: 25 },
    anchorIndex: -1,
    mode: "move",
  });
  const adjusted = move.pointerAdjustedForSnap(
    { time: 17, price: 28 },
    () => ({ time: 20, price: 40 }),
  );
  assert.deepEqual(adjusted, {
    time: 15 + 20 - subject.points[0].time,
    price: 25 + 40 - subject.points[0].price,
  });

  const resize = new TransformSession({
    drawing: subject,
    dragStart: subject.points[0],
    anchorIndex: 0,
    mode: "resize",
  });
  assert.deepEqual(
    resize.pointerAdjustedForSnap({ time: 1, price: 2 }, () => ({ time: 100, price: 200 })),
    { time: 100, price: 200 },
  );
});
