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
