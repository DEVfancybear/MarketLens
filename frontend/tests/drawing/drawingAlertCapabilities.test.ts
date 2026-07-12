import assert from "node:assert/strict";
import { test } from "node:test";
import type { Drawing } from "../../src/types/drawing";
import {
  drawingAlertSnapshot,
  drawingAlertTargets,
} from "../../src/components/chart/drawing/alerts/drawingAlertCapabilities";

function drawing(tool: Drawing["tool"], points: Drawing["points"], patch: Partial<Drawing> = {}): Drawing {
  return { id: `${tool}-1`, tool, color: "#2962ff", lineWidth: 1, points, ...patch };
}

test("fixed horizontal and rectangle geometry project stable alert targets", () => {
  assert.deepEqual(drawingAlertTargets(drawing("horizontal", [{ time: 1, price: 101 }])), [
    { id: "point:0", label: "Price level", price: 101 },
  ]);
  assert.deepEqual(drawingAlertTargets(drawing("rectangle", [
    { time: 1, price: 90 },
    { time: 2, price: 110 },
  ])), [
    { id: "range:upper", label: "Upper boundary", price: 110 },
    { id: "range:lower", label: "Lower boundary", price: 90 },
  ]);
  assert.deepEqual(drawingAlertTargets(drawing("trendline", [
    { time: 1, price: 90 },
    { time: 2, price: 110 },
  ])), []);
});

test("Fib retracement and extension expose enabled configured levels", () => {
  const retracement = drawing("fibRetracement", [
    { time: 1, price: 100 },
    { time: 2, price: 200 },
  ], {
    fibLevels: [
      { value: 0, enabled: false, color: "#fff" },
      { value: 0.5, enabled: true, color: "#fff", text: "Mid" },
    ],
  });
  const retracementTargets = drawingAlertTargets(retracement);
  assert.equal(retracementTargets.some((target) => target.label === "Mid" && target.price === 150), true);
  assert.equal(retracementTargets.some((target) => target.id === "fib:0:0"), false);

  const extension = drawing("fibExtension", [
    { time: 1, price: 100 },
    { time: 2, price: 120 },
    { time: 3, price: 110 },
  ], { fibLevels: [{ value: 1.5, enabled: true, color: "#fff" }] });
  assert.equal(drawingAlertTargets(extension)[0].price, 140);
});

test("position targets and immutable provenance snapshot are explicit", () => {
  const position = drawing("long", [
    { time: 1, price: 100 },
    { time: 2, price: 120 },
    { time: 2, price: 90 },
  ]);
  const targets = drawingAlertTargets(position);
  assert.deepEqual(targets.map(({ label, price }) => ({ label, price })), [
    { label: "Entry", price: 100 },
    { label: "Target", price: 120 },
    { label: "Stop", price: 90 },
  ]);
  const snapshot = drawingAlertSnapshot(position, targets[1], 123456);
  position.points[1].price = 130;
  assert.deepEqual(snapshot, {
    kind: "drawing",
    drawingId: "long-1",
    drawingTool: "long",
    targetId: "position:target",
    targetLabel: "Target",
    snapshotAt: 123456,
  });
});
