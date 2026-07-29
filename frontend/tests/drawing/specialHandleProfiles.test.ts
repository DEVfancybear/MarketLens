import assert from "node:assert/strict";
import { test } from "node:test";

import type { Drawing, DrawingTool } from "../../src/types/drawing";
import { getTool } from "../../src/components/chart/drawing/tools/ToolRegistry";
import "../../src/components/chart/drawing/tools/plugins/RectangleTool";
import "../../src/components/chart/drawing/tools/plugins/EllipseTool";
import "../../src/components/chart/drawing/tools/plugins/ProjectionRichTools";

const toX = (value: number) => value;
const toY = (value: number) => 100 - value;

function fixture(tool: DrawingTool): Drawing {
  return {
    id: tool,
    tool,
    color: "#2962ff",
    lineWidth: 2,
    points: [
      { time: 10, price: 30 },
      { time: 30, price: 10 },
    ],
  };
}

test("special geometry profiles expose their declared virtual handle counts", () => {
  const expected = new Map<DrawingTool, number>([
    ["rectangle", 8],
    ["ellipse", 4],
    ["table", 4],
    ["image", 4],
  ]);
  for (const [tool, count] of expected) {
    const adapter = getTool(tool);
    assert.ok(adapter, `${tool} adapter`);
    assert.equal(
      adapter.getAnchors(fixture(tool), toX, toY).length,
      count,
      `${tool} handles`,
    );
  }
});

test("every virtual handle keeps a unique hit identity", () => {
  for (const tool of ["rectangle", "ellipse", "table", "image"] as const) {
    const adapter = getTool(tool);
    assert.ok(adapter);
    const drawing = fixture(tool);
    const anchors = adapter.getAnchors(drawing, toX, toY);
    assert.equal(
      new Set(anchors.map((anchor) => anchor.index)).size,
      anchors.length,
      `${tool} unique anchor ids`,
    );
    for (const anchor of anchors) {
      assert.ok(anchor.x != null && anchor.y != null);
      assert.ok(
        adapter.hitTest(drawing, anchor.x, anchor.y, toX, toY)
          .some((hit) => hit.anchorIndex === anchor.index),
        `${tool} handle ${anchor.index} hit identity`,
      );
    }
  }
});
