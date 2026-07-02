#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const positionToolPath = resolve(
  root,
  "src/components/chart/drawing/tools/plugins/PositionTool.ts",
);
const interactionPath = resolve(
  root,
  "src/components/chart/drawing/interaction/DrawingInteractionManager.ts",
);

const positionTool = readFileSync(positionToolPath, "utf8");
const interaction = readFileSync(interactionPath, "utf8");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function clonePoints(points) {
  return points.map((point) => ({ ...point }));
}

function width(points) {
  return points[1].time - points[0].time;
}

function move(origPoints, pointer, dragStart) {
  const dt = pointer.time - dragStart.time;
  const dp = pointer.price - dragStart.price;
  return origPoints.map((point) => ({
    time: point.time + dt,
    price: point.price + dp,
  }));
}

function checkRepeatedBodyDrags(direction, deltas) {
  const start = { time: 1000, price: 59717.21 };
  let current = [
    { time: 1000, price: 59717.21 },
    { time: 1020, price: 58036.76 },
    { time: 1020, price: 61069.28 },
  ];
  const initialWidth = width(current);
  const hitTimeOffset = 90;

  assert(
    hitTimeOffset > initialWidth,
    "fixture must model a hit candle that is farther right than the stored box width",
  );

  for (const delta of deltas) {
    const dragStart = { time: current[0].time, price: current[0].price };
    const orig = clonePoints(current);
    const pointer = {
      time: dragStart.time + direction * delta,
      price: dragStart.price + direction * delta * 0.01,
    };
    current = move(orig, pointer, dragStart);

    assert(
      width(current) === initialWidth,
      `${direction > 0 ? "right" : "left"} drag changed width from ${initialWidth} to ${width(current)}`,
    );
    assert(
      current[1].time === current[2].time,
      `${direction > 0 ? "right" : "left"} drag split target/stop right-edge times`,
    );
    assert(
      current[1].time - current[0].time !== hitTimeOffset,
      `${direction > 0 ? "right" : "left"} drag snapped width to hitTime offset ${hitTimeOffset}`,
    );
  }
}

function checkStaticRegressionGuards() {
  assert(
    !/geo\.xR\s*=\s*frozenX/.test(positionTool),
    "PositionTool must not resize geometry to a TP/SL hit candle (found geo.xR = frozenX)",
  );
  assert(
    !/function\s+withHitFreeze/.test(positionTool),
    "PositionTool must not reintroduce hit-freeze geometry helper",
  );
  assert(
    !/getPositionMoveOrigin/.test(positionTool + interaction),
    "Body drag must use stored points directly, not a hit-expanded move origin",
  );
  assert(
    /geo\.xR\s*=\s*origXR/.test(positionTool),
    "PositionTool should explicitly keep TP/SL hit state from changing right-edge geometry",
  );
}

checkStaticRegressionGuards();
checkRepeatedBodyDrags(1, [1, 3, 8, 21, 55, 89]);
checkRepeatedBodyDrags(-1, [1, 3, 8, 21, 55, 89]);

console.log("[position-drag-width] OK: left/right body drags preserve width");
