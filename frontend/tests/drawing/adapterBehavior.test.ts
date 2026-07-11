import assert from "node:assert/strict";
import { test } from "node:test";

import type { Drawing } from "../../src/types/drawing";
import { getTool } from "../../src/components/chart/drawing/tools/ToolRegistry";
import "../../src/components/chart/drawing/tools/plugins/BrushTool";
import "../../src/components/chart/drawing/tools/plugins/PathTool";
import "../../src/components/chart/drawing/tools/plugins/RectangleTool";
import "../../src/components/chart/drawing/tools/plugins/VerticalTool";

function drawing(tool: Drawing["tool"], points = 4): Drawing {
  return {
    id: `fixture-${tool}`,
    tool,
    color: "#2962ff",
    lineWidth: 2,
    fillColor: "#2962ff",
    opacity: 0.2,
    text: "Fixture text",
    fontSize: 13,
    points: [
      { time: 20, price: 20 },
      { time: 80, price: 70 },
      { time: 130, price: 35 },
      { time: 180, price: 90 },
    ].slice(0, points),
  };
}

function recordingContext() {
  const calls: string[] = [];
  const target: Record<string, unknown> = {
    canvas: { width: 800, height: 600 },
    measureText: (text: string) => ({
      width: text.length * 7,
      actualBoundingBoxAscent: 9,
      actualBoundingBoxDescent: 3,
    }),
  };
  const context = new Proxy(target, {
    get(object, property) {
      if (property in object) return object[property as string];
      return (..._args: unknown[]) => calls.push(String(property));
    },
    set(object, property, value) {
      object[property as string] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { context, calls };
}

const projector = {
  toX: (value: number) => value,
  toY: (value: number) => value,
  width: 800,
  height: 600,
};

test("brush and highlighter use the continuous stroke contract", () => {
  const brush = getTool("brush");
  const highlighter = getTool("highlighter");
  assert.ok(brush?.continuous);
  assert.ok(highlighter?.continuous);
  const { context, calls } = recordingContext();
  brush.render(context, drawing("brush"), projector, true);
  assert.ok(calls.includes("quadraticCurveTo"));
  assert.ok(calls.includes("stroke"));
  assert.equal(brush.getAnchors(drawing("brush"), projector.toX, projector.toY).length, 4);
});

test("path remains an open freeform tool with indexed anchors", () => {
  const path = getTool("path");
  assert.ok(path?.freeform);
  const fixture = {
    ...drawing("path"),
    points: [
      { time: 20, price: 20 },
      { time: 20, price: 100 },
      { time: 100, price: 100 },
      { time: 100, price: 20 },
    ],
  };
  const { context, calls } = recordingContext();
  path.render(context, fixture, projector, true);
  assert.ok(calls.includes("lineTo"));
  assert.equal(
    path.hitTest(fixture, 60, 20, projector.toX, projector.toY).some(
      (hit) => hit.target === "body",
    ),
    false,
    "the last point must not connect back to the first point",
  );
  assert.deepEqual(
    path.getAnchors(fixture, projector.toX, projector.toY).map((anchor) => anchor.index),
    [0, 1, 2, 3],
  );
});

test("vertical line movement stays time-axis constrained", () => {
  const vertical = getTool("vertical");
  assert.ok(vertical);
  const fixture = drawing("vertical", 1);
  const moved = vertical.move(
    fixture.points,
    { time: 65, price: 999 },
    { time: 20, price: 20 },
  );
  assert.equal(moved[0].time, 65);
  assert.equal(moved[0].price, 20);
});

test("rectangle renders attached text through its real adapter", () => {
  const rectangle = getTool("rectangle");
  assert.ok(rectangle);
  const { context, calls } = recordingContext();
  rectangle.render(context, drawing("rectangle", 2), projector, false);
  assert.ok(calls.includes("fillText"));
});
