import assert from "node:assert/strict";
import { test } from "node:test";

import type { Drawing } from "../../src/types/drawing";
import { hitTest } from "../../src/components/chart/drawing/hittest/HitTestEngine";
import { SelectionSession } from "../../src/components/chart/drawing/interaction/SelectionSession";
import { TransformSession } from "../../src/components/chart/drawing/interaction/TransformSession";
import {
  POSITION_DEFAULT_MIN_WIDTH_PX,
  initializePositionDrawing,
  positionBarCountForViewport,
  positionRiskDistanceForViewport,
  resolvePositionCreationTimeline,
} from "../../src/components/chart/drawing/tools/positionCreation";
import { movePosition, POSITION_ANCHORS } from "../../src/components/chart/drawing/tools/positionGeometry";
import { projectPositionGeometry } from "../../src/components/chart/drawing/tools/positionProjectedGeometry";

function onePointPosition(tool: "long" | "short"): Drawing {
  return {
    id: `position-${tool}`,
    tool,
    color: "",
    lineWidth: 0,
    points: [{ time: 1_000, price: 100 }],
  };
}

test("position creation derives symmetric long and short geometry from manifest side", () => {
  const long = initializePositionDrawing(onePointPosition("long"), 60);
  const short = initializePositionDrawing(onePointPosition("short"), 60);

  assert.equal(long?.side, "long");
  assert.deepEqual(long?.drawing.points, [
    { time: 1_000, price: 100 },
    { time: 2_200, price: 101 },
    { time: 2_200, price: 99 },
  ]);
  assert.equal(short?.side, "short");
  assert.deepEqual(short?.drawing.points, [
    { time: 1_000, price: 100 },
    { time: 2_200, price: 99 },
    { time: 2_200, price: 101 },
  ]);
});

test("position creation adapts default bars and risk to a dense EURUSD viewport", () => {
  const barSpacing = 1.5;
  const barCount = positionBarCountForViewport(barSpacing);
  assert.equal(barCount, Math.ceil(POSITION_DEFAULT_MIN_WIDTH_PX / barSpacing));
  assert.equal(positionBarCountForViewport(24), 20);
  assert.equal(positionBarCountForViewport(barSpacing, 160, 60), 40);
  assert.equal(positionBarCountForViewport(barSpacing, 160, 12), 8);
  assert.equal(positionBarCountForViewport(24, 160, 100), 4);

  const entry = 1.14263;
  const riskPriceDistance = positionRiskDistanceForViewport(
    entry,
    1.14413,
    1.14123,
  );
  assert.ok(riskPriceDistance);
  const result = initializePositionDrawing(
    {
      ...onePointPosition("long"),
      points: [{ time: 1_000, price: entry }],
    },
    900,
    0.00001,
    { barCount, riskPriceDistance },
  );
  assert.ok(result);
  assert.equal(result.drawing.points[1].time - result.drawing.points[0].time, barCount * 900);
  assert.ok(Math.abs(result.drawing.points[1].price - entry) < entry * 0.002);
  assert.ok(Math.abs(result.drawing.points[2].price - entry) < entry * 0.002);
});

test("position creation timeline skips a closed-market gap by candle index", () => {
  const friday = 1_783_719_900;
  const monday = 1_783_912_500;
  const candles = [
    { time: friday - 900 },
    { time: friday },
    ...Array.from({ length: 25 }, (_, index) => ({
      time: monday + index * 900,
    })),
  ];
  const timeline = resolvePositionCreationTimeline(friday, 900, 20, candles);
  assert.equal(timeline.entryTime, friday);
  assert.equal(timeline.rightEdgeTime, candles[21].time);
  assert.notEqual(timeline.rightEdgeTime, friday + 20 * 900);
});

test("position creation preserves future and pre-history whitespace entries", () => {
  const candles = [
    { time: 1_000 },
    { time: 1_900 },
    { time: 2_800 },
  ];
  const future = resolvePositionCreationTimeline(3_700, 900, 4, candles);
  assert.deepEqual(future, {
    entryTime: 3_700,
    rightEdgeTime: 7_300,
  });
  const before = resolvePositionCreationTimeline(100, 900, 2, candles);
  assert.deepEqual(before, {
    entryTime: 100,
    rightEdgeTime: 1_900,
  });
});

test("position creation applies defaults without overwriting configured values", () => {
  const input = {
    ...onePointPosition("long"),
    color: "#123456",
    lineWidth: 3,
    accountSize: 5_000,
    riskValue: 1,
    showLabels: false,
  };
  const result = initializePositionDrawing(input, Number.NaN);

  assert.equal(result?.drawing.color, "#123456");
  assert.equal(result?.drawing.lineWidth, 3);
  assert.equal(result?.drawing.accountSize, 5_000);
  assert.equal(result?.drawing.riskValue, 1);
  assert.equal(result?.drawing.showLabels, false);
  assert.equal(result?.drawing.points[1]?.time, 73_000);
  assert.deepEqual(input.points, [{ time: 1_000, price: 100 }]);
});

test("position creation ignores non-position tools and completed projections", () => {
  const trendline: Drawing = {
    ...onePointPosition("long"),
    tool: "trendline",
  };
  const complete: Drawing = {
    ...onePointPosition("short"),
    points: [
      { time: 1_000, price: 100 },
      { time: 2_000, price: 90 },
      { time: 2_000, price: 110 },
    ],
  };

  assert.equal(initializePositionDrawing(trendline, 60), null);
  assert.equal(initializePositionDrawing(complete, 60), null);
});

test("a selected compact Long/Short body resolves to move and preserves its 20px width", () => {
  const toX = (time: number) => time / 60;
  const toY = (price: number) => price * 4;

  for (const tool of ["long", "short"] as const) {
    for (const pointerType of ["mouse", "touch"] as const) {
      const initialized = initializePositionDrawing(onePointPosition(tool), 60);
      assert.ok(initialized);

      const before = initialized.drawing;
      const beforeGeometry = projectPositionGeometry(before, { toX, toY });
      assert.ok(beforeGeometry);
      const beforeTimeWidth = before.points[1].time - before.points[0].time;
      const beforeScreenWidth = beforeGeometry.xR - beforeGeometry.xL;
      const beforeTargetDistance = before.points[1].price - before.points[0].price;
      const beforeStopDistance = before.points[2].price - before.points[0].price;
      assert.ok(
        Math.abs(beforeScreenWidth - 20) < 1e-9,
        `${tool}/${pointerType} fixture must stay compact`,
      );

      const selectedDrawingIds = new Set([before.id]);
      const bodyPoint = { time: 1_600, price: before.points[0].price };
      const bodyHit = hitTest([before], bodyPoint, toX, toY, {
        selectedDrawingIds,
        pointerType,
      });
      assert.equal(bodyHit?.target, "body", `${tool}/${pointerType} center hit`);
      assert.equal(bodyHit?.anchorIndex, -1);
      assert.ok(bodyHit);
      const transform = new SelectionSession()
        .pointerDown({
          hit: bodyHit,
          clientX: toX(bodyPoint.time),
          clientY: toY(bodyPoint.price),
          timeStamp: 1,
          button: 0,
          toggleSelection: false,
          drawingsLocked: false,
          selectedDrawingIds,
          drawings: [before],
        })
        .find((outcome) => outcome.kind === "transform");
      assert.ok(transform);
      assert.equal(transform.mode, "move");

      const firstMove = new TransformSession({
        drawing: transform.drawing,
        dragStart: bodyPoint,
        anchorIndex: transform.anchorIndex,
        mode: transform.mode,
        adapterContext: { tickSize: 0.01 },
      }).update({ time: 1_900, price: before.points[0].price + 2 }).get(before.id);
      assert.ok(firstMove);

      const moved = { ...before, points: firstMove };
      const afterGeometry = projectPositionGeometry(moved, { toX, toY });
      assert.ok(afterGeometry);
      assert.equal(firstMove[1].time - firstMove[0].time, beforeTimeWidth);
      assert.ok(
        Math.abs(afterGeometry.xR - afterGeometry.xL - beforeScreenWidth) < 1e-9,
        `${tool}/${pointerType} move must preserve projected width`,
      );
      assert.equal(
        firstMove[1].price - firstMove[0].price,
        beforeTargetDistance,
      );
      assert.equal(
        firstMove[2].price - firstMove[0].price,
        beforeStopDistance,
      );
    }
  }
});

test("an exact compact Position handle resolves to resize and changes only that anchor geometry", () => {
  const toX = (time: number) => time / 60;
  const toY = (price: number) => price * 4;

  for (const tool of ["long", "short"] as const) {
    for (const pointerType of ["mouse", "touch"] as const) {
      const initialized = initializePositionDrawing(onePointPosition(tool), 60);
      assert.ok(initialized);
      const before = initialized.drawing;
      const selectedDrawingIds = new Set([before.id]);
      const targetRight = before.points[1];
      assert.ok(targetRight);

      const handleHit = hitTest([before], targetRight, toX, toY, {
        selectedDrawingIds,
        pointerType,
      });
      assert.equal(handleHit?.target, "p3", `${tool}/${pointerType} exact handle hit`);
      assert.equal(handleHit?.anchorIndex, POSITION_ANCHORS.TARGET_RIGHT);
      assert.ok(handleHit);

      const transform = new SelectionSession()
        .pointerDown({
          hit: handleHit,
          clientX: toX(targetRight.time),
          clientY: toY(targetRight.price),
          timeStamp: 1,
          button: 0,
          toggleSelection: false,
          drawingsLocked: false,
          selectedDrawingIds,
          drawings: [before],
        })
        .find((outcome) => outcome.kind === "transform");
      assert.ok(transform);
      assert.equal(transform.mode, "resize");
      assert.equal(transform.anchorIndex, POSITION_ANCHORS.TARGET_RIGHT);

      const targetDirection = tool === "long" ? 1 : -1;
      const resized = new TransformSession({
        drawing: transform.drawing,
        dragStart: targetRight,
        anchorIndex: transform.anchorIndex,
        mode: transform.mode,
        adapterContext: { tickSize: 0.01 },
      }).update({
        time: targetRight.time + 600,
        price: targetRight.price + targetDirection * 0.5,
      }).get(before.id);
      assert.ok(resized);

      assert.deepEqual(resized[0], before.points[0]);
      assert.equal(resized[1].time, targetRight.time + 600);
      assert.equal(resized[2].time, targetRight.time + 600);
      assert.equal(resized[1].price, targetRight.price + targetDirection * 0.5);
      assert.equal(resized[2].price, before.points[2].price);
    }
  }
});

test("off-tick Position creation is canonical before the first body move", () => {
  const tickSize = 0.05;

  for (const tool of ["long", "short"] as const) {
    const input = onePointPosition(tool);
    input.points[0].price = 100.03;
    const initialized = initializePositionDrawing(input, 60, tickSize);
    assert.ok(initialized);

    const before = initialized.drawing.points;
    assert.deepEqual(
      before.map((point) => point.price),
      tool === "long" ? [100.05, 101.05, 99.05] : [100.05, 99.05, 101.05],
    );
    for (const point of before) {
      assert.ok(Math.abs(point.price / tickSize - Math.round(point.price / tickSize)) < 1e-8);
    }

    const zeroMove = movePosition(
      before,
      { time: 1_000, price: 100.05 },
      { time: 1_000, price: 100.05 },
      tickSize,
    );
    assert.deepEqual(zeroMove, before);
    assert.equal(zeroMove[1].price - zeroMove[0].price, before[1].price - before[0].price);
    assert.equal(zeroMove[2].price - zeroMove[0].price, before[2].price - before[0].price);
  }
});
