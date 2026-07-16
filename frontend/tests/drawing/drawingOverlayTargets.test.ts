import assert from "node:assert/strict";
import { test } from "node:test";
import type { Drawing } from "../../src/types/drawing";
import { resolveSelectionTextOverlay } from "../../src/components/chart/drawing/overlays/drawingOverlayTargets";
import "../../src/components/chart/drawing/tools/plugins/RectangleTool";
import "../../src/components/chart/drawing/tools/plugins/TrendLineTool";

const drawing = (id: string, tool: Drawing["tool"]): Drawing => ({
  id, tool, color: "#fff", lineWidth: 1,
  points: [{ time: 10, price: 20 }, { time: 30, price: 40 }],
});

test("overlay resolver projects capability-selected shape and line targets", () => {
  const rectangle = resolveSelectionTextOverlay([drawing("r", "rectangle")], "r", "shape-center", (v) => v, (v) => v);
  assert.deepEqual({ x: rectangle?.x, y: rectangle?.y }, { x: 20, y: 30 });
  const line = resolveSelectionTextOverlay([drawing("l", "trendline")], "l", "line-midpoint", (v) => v, (v) => v);
  assert.deepEqual({ x: line?.x, y: line?.y, angle: line?.angle }, { x: 20, y: 30, angle: 45 });
  assert.equal(resolveSelectionTextOverlay([drawing("r", "rectangle")], "r", "line-midpoint", (v) => v, (v) => v), null);
});

test("axis badge editors reuse the rendered price/time label rectangles", () => {
  const viewport = {
    width: 400,
    height: 300,
    market: { symbol: "TEST", candles: [], pricePrecision: 2 },
  };
  const horizontal = resolveSelectionTextOverlay(
    [{ ...drawing("h", "horizontal"), points: [{ time: 10, price: 20 }], showPriceLabels: true }],
    "h",
    "axis-price",
    (value) => value,
    (value) => value,
    viewport,
  );
  assert.ok(horizontal);
  assert.equal(horizontal.height, 20);
  assert.equal(horizontal.y, 20);
  assert.equal(horizontal.x + horizontal.width / 2, 397);

  const vertical = resolveSelectionTextOverlay(
    [{ ...drawing("v", "vertical"), points: [{ time: 200, price: 20 }], showTimeLabel: true }],
    "v",
    "axis-time",
    (value) => value,
    (value) => value,
    viewport,
  );
  assert.ok(vertical);
  assert.equal(vertical.height, 20);
  assert.equal(vertical.y, 287);
  assert.equal(
    resolveSelectionTextOverlay(
      [{ ...drawing("hidden", "horizontal"), points: [{ time: 10, price: 20 }], showPriceLabels: false }],
      "hidden",
      "axis-price",
      (value) => value,
      (value) => value,
      viewport,
    ),
    null,
  );

  const hiddenPriceWithText = resolveSelectionTextOverlay(
    [{
      ...drawing("hidden-text", "horizontal"),
      points: [{ time: 10, price: 20 }],
      showPriceLabels: false,
      text: "Support",
    }],
    "hidden-text",
    "axis-price",
    (value) => value,
    (value) => value,
    viewport,
  );
  assert.ok(hiddenPriceWithText, "attached price-line text retains its direct edit target");

  const hiddenTimeWithText = resolveSelectionTextOverlay(
    [{
      ...drawing("hidden-time-text", "vertical"),
      points: [{ time: 200, price: 20 }],
      showTimeLabel: false,
      text: "Open",
    }],
    "hidden-time-text",
    "axis-time",
    (value) => value,
    (value) => value,
    viewport,
  );
  assert.ok(hiddenTimeWithText, "attached time-line text retains its direct edit target");
});
