import assert from "node:assert/strict";
import { test } from "node:test";

import type { Drawing } from "../../src/types/drawing";
import { hitPriorityScore } from "../../src/components/chart/drawing/hittest/hitPriority";
import { SpatialIndex } from "../../src/components/chart/drawing/renderer/SpatialIndex";
import {
  sameRenderMemoState,
  selectedIdsHash,
  type RenderMemoState,
} from "../../src/components/chart/drawing/renderer/renderMemo";
import { getTool } from "../../src/components/chart/drawing/tools/ToolRegistry";
import "../../src/components/chart/drawing/tools/plugins/RectangleTool";

const toX = (time: number) => time;
const toY = (price: number) => price;

function rectangleDrawing(patch: Partial<Drawing> = {}): Drawing {
  return {
    id: "rect-1",
    tool: "rectangle",
    color: "#2962ff",
    lineWidth: 1.5,
    points: [
      { time: 10, price: 20 },
      { time: 20, price: 80 },
    ],
    visible: true,
    ...patch,
  };
}

test("spatial culling uses adapter bounds for extended rectangle geometry", () => {
  const index = new SpatialIndex();
  const extended = rectangleDrawing({ extend: "right" });

  index.rebuild([extended], toX, toY);

  assert.deepEqual(index.queryViewport(500, 40, 10, 10), [extended]);
});

test("drag viewport reuses static culling and substitutes live rectangle geometry", () => {
  const index = new SpatialIndex();
  const original = rectangleDrawing();
  const live = rectangleDrawing({
    points: [
      { time: 500, price: 40 },
      { time: 600, price: 90 },
    ],
  });
  index.rebuild([original], toX, toY);

  const visible = index.queryViewportWithOverrides(
    0,
    0,
    100,
    100,
    new Map([[original.id, live]]),
  );

  assert.deepEqual(visible, [live]);
});

test("rectangle extend hit-testing covers the visible extended region", () => {
  const adapter = getTool("rectangle");
  assert.ok(adapter);

  const extended = rectangleDrawing({ extend: "right" });
  const hits = adapter.hitTest(extended, 500, 50, toX, toY);
  const body = hits.find((hit) => hit.target === "body");

  assert.equal(body?.drawing.id, extended.id);
});

test("rectangle extend bounding box matches the visible extended side", () => {
  const adapter = getTool("rectangle");
  assert.ok(adapter);

  const right = adapter.boundingBox(rectangleDrawing({ extend: "right" }), toX, toY);
  const left = adapter.boundingBox(rectangleDrawing({ extend: "left" }), toX, toY);
  const both = adapter.boundingBox(rectangleDrawing({ extend: "both" }), toX, toY);

  assert.ok(right);
  assert.ok(left);
  assert.ok(both);
  assert.equal(right.x, 10);
  assert.ok(right.w > 90000);
  assert.ok(left.x < -90000);
  assert.ok(left.w > 90000);
  assert.ok(both.x < -90000);
  assert.ok(both.w > 190000);
});

test("render memo key changes when only hover or multi-select changes", () => {
  const base: RenderMemoState = {
    drawingsHash: "1|rect-1:2",
    selectedDrawingId: null,
    selectedDrawingIdsHash: selectedIdsHash(undefined),
    drawingsHidden: false,
    machineState: "Idle",
    machineAnchorsSig: "-",
    activeTool: "cursor",
    drawColor: "#2962ff",
    liveHash: "-",
    hoveredId: null,
    canvasW: 800,
    canvasH: 500,
  };

  assert.equal(sameRenderMemoState(base, { ...base }), true);
  assert.equal(
    sameRenderMemoState(base, { ...base, hoveredId: "rect-1" }),
    false,
  );
  assert.equal(
    sameRenderMemoState(base, {
      ...base,
      selectedDrawingIdsHash: selectedIdsHash(new Set(["rect-1"])),
    }),
    false,
  );
  assert.equal(
    selectedIdsHash(new Set(["z", "a", "z"])),
    "a,z",
    "multi-select hashes must be stable regardless of insertion order",
  );
});

test("hit priority preserves TradingView anchor/body and z-index ordering", () => {
  assert.ok(
    hitPriorityScore({ target: "p1", distance: 20 }, 1) >
      hitPriorityScore({ target: "body", distance: 0 }, 100),
    "anchor hits must outrank body hits even on lower z-index drawings",
  );
  assert.ok(
    hitPriorityScore({ target: "body", distance: 8 }, 2) >
      hitPriorityScore({ target: "body", distance: 0 }, 1),
    "same-family hits should prefer the topmost drawing before distance",
  );
});
