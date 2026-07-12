import assert from "node:assert/strict";
import { test } from "node:test";
import type { Drawing } from "../../src/types/drawing";
import {
  buildDrawingObjectTree,
  drawingObjectLabel,
  normalizeDrawingObjectName,
  reorderDrawingObjectTree,
} from "../../src/components/chart/drawing/objectTree/drawingObjectTree";

function drawing(id: string, zIndex: number, group?: Drawing["group"]): Drawing {
  return {
    id,
    tool: "trendline",
    color: "#2962ff",
    lineWidth: 1,
    points: [{ time: 1, price: 2 }, { time: 2, price: 3 }],
    zIndex,
    group,
  };
}

test("object tree groups flat drawings and orders highest layer first", () => {
  const group = { id: "group-1", name: "Analysis" };
  const tree = buildDrawingObjectTree([
    drawing("bottom", 1),
    drawing("member-a", 2, group),
    drawing("member-b", 4, group),
    drawing("top", 5),
  ]);
  assert.deepEqual(tree.map((node) => node.kind === "group" ? node.id : node.drawing.id), ["top", "group-1", "bottom"]);
  assert.equal(tree[1].kind, "group");
  if (tree[1].kind === "group") {
    assert.deepEqual(tree[1].drawings.map((item) => item.id), ["member-b", "member-a"]);
  }
});

test("object labels normalize custom names and fall back to manifest labels", () => {
  assert.equal(normalizeDrawingObjectName(`  ${"x".repeat(140)}  `)?.length, 120);
  assert.equal(drawingObjectLabel({ tool: "trendline", name: "  Breakout  " }), "Breakout");
  assert.equal(drawingObjectLabel({ tool: "trendline" }), "Trendline");
});

test("reordering a group moves all members as a contiguous layer block", () => {
  const group = { id: "group-1", name: "Analysis" };
  const drawings = [drawing("top", 5), drawing("a", 4, group), drawing("b", 2, group), drawing("bottom", 1)];
  const moved = reorderDrawingObjectTree(drawings, "group-1", "up");
  assert.equal(moved.get("a"), 4);
  assert.equal(moved.get("b"), 3);
  assert.equal(moved.get("top"), 2);
  assert.equal(moved.get("bottom"), 1);
  assert.deepEqual(reorderDrawingObjectTree(drawings, "top", "up"), new Map());

  const memberMoved = reorderDrawingObjectTree(drawings, "a", "down");
  assert.ok(memberMoved.get("b")! > memberMoved.get("a")!);
  assert.ok(memberMoved.get("a")! > memberMoved.get("bottom")!);
});
