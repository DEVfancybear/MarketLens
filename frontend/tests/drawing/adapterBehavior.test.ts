import assert from "node:assert/strict";
import { test } from "node:test";

import type { Drawing } from "../../src/types/drawing";
import { getTool } from "../../src/components/chart/drawing/tools/ToolRegistry";
import "../../src/components/chart/drawing/tools/plugins/BrushTool";
import "../../src/components/chart/drawing/tools/plugins/PathTool";
import "../../src/components/chart/drawing/tools/plugins/RectangleTool";
import "../../src/components/chart/drawing/tools/plugins/HorizontalTool";
import "../../src/components/chart/drawing/tools/plugins/VerticalTool";
import "../../src/components/chart/drawing/tools/plugins/CrossLineTool";
import "../../src/components/chart/drawing/tools/plugins/RayTool";
import "../../src/components/chart/drawing/tools/plugins/ExtendedLineTool";
import "../../src/components/chart/drawing/tools/plugins/EmojiTool";

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
  assert.deepEqual(
    brush
      .getAnchors(drawing("brush"), projector.toX, projector.toY)
      .map((anchor) => anchor.index),
    [0, 3],
  );
});

test("emoji hit testing and bounds scale with the rendered font size", () => {
  const emoji = getTool("emoji");
  assert.ok(emoji);
  const fixture = {
    ...drawing("emoji", 1),
    text: "🙂",
    fontSize: 60,
  };
  const bounds = emoji.boundingBox(fixture, projector.toX, projector.toY);
  assert.ok(bounds);
  assert.equal(bounds.w, 72);
  assert.equal(bounds.h, 72);
  assert.ok(
    emoji
      .hitTest(fixture, 50, 40, projector.toX, projector.toY)
      .some((hit) => hit.target === "body"),
  );
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

test("horizontal line body move preserves offset while its anchor snaps", () => {
  const horizontal = getTool("horizontal");
  assert.ok(horizontal);
  const fixture = drawing("horizontal", 1);
  const moved = horizontal.move(
    fixture.points,
    { time: 999, price: 65 },
    { time: 30, price: 25 },
  );
  assert.deepEqual(moved[0], { time: 20, price: 60 });
  assert.deepEqual(
    horizontal.moveAnchor(fixture.points, 0, { time: 999, price: 65 })[0],
    { time: 20, price: 65 },
  );
});

test("vertical line body move preserves offset while its anchor snaps", () => {
  const vertical = getTool("vertical");
  assert.ok(vertical);
  const fixture = drawing("vertical", 1);
  const moved = vertical.move(
    fixture.points,
    { time: 65, price: 999 },
    { time: 25, price: 30 },
  );
  assert.deepEqual(moved[0], { time: 60, price: 20 });
  assert.deepEqual(
    vertical.moveAnchor(fixture.points, 0, { time: 65, price: 999 })[0],
    { time: 65, price: 20 },
  );
});

test("axis line labels follow TradingView visibility controls", () => {
  const horizontal = getTool("horizontal");
  const vertical = getTool("vertical");
  const crossLine = getTool("crossLine");
  assert.ok(horizontal && vertical && crossLine);

  const hiddenHorizontal = { ...drawing("horizontal", 1), text: undefined, showPriceLabels: false };
  const hiddenContext = recordingContext();
  horizontal.render(hiddenContext.context, hiddenHorizontal, projector, false);
  assert.equal(hiddenContext.calls.filter((call) => call === "fillText").length, 0);

  const verticalContext = recordingContext();
  vertical.render(verticalContext.context, { ...drawing("vertical", 1), showTimeLabel: true }, projector, false);
  assert.equal(verticalContext.calls.filter((call) => call === "fillText").length, 1, "time label is visible without selecting the line");

  const crossContext = recordingContext();
  crossLine.render(crossContext.context, { ...drawing("crossLine", 1), showPriceLabels: true, showTimeLabel: true }, projector, false);
  assert.equal(crossContext.calls.filter((call) => call === "fillText").length, 2, "crossline renders price and time labels");

  const hiddenCrossContext = recordingContext();
  crossLine.render(hiddenCrossContext.context, { ...drawing("crossLine", 1), showPriceLabels: false, showTimeLabel: false }, projector, false);
  assert.equal(hiddenCrossContext.calls.filter((call) => call === "fillText").length, 0);
});

test("ray families share trendline text, labels, and stats rendering", () => {
  for (const tool of ["ray", "extendedLine"] as const) {
    const adapter = getTool(tool);
    assert.ok(adapter);
    const { context, calls } = recordingContext();
    adapter.render(context, { ...drawing(tool, 2), showPriceLabels: true, showStats: true }, projector, true);
    assert.ok(calls.filter((call) => call === "fillText").length >= 4, `${tool} must render text, two prices, and stats`);
  }
});

test("rectangle renders attached text through its real adapter", () => {
  const rectangle = getTool("rectangle");
  assert.ok(rectangle);
  const { context, calls } = recordingContext();
  rectangle.render(context, drawing("rectangle", 2), projector, false);
  assert.ok(calls.includes("fillText"));
});
