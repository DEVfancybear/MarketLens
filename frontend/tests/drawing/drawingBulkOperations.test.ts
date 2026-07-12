import assert from "node:assert/strict";
import { test } from "node:test";
import type { Drawing } from "../../src/types/drawing";
import {
  drawingBulkActionLabel,
  nextDrawingBulkPropertyValue,
  resolveDrawingBulkTargets,
} from "../../src/components/chart/drawing/bulk/drawingBulkOperations";

function drawing(id: string, groupId?: string, patch: Partial<Drawing> = {}): Drawing {
  return {
    id,
    tool: "trendline",
    color: "#2962ff",
    lineWidth: 1,
    points: [{ time: 1, price: 2 }, { time: 2, price: 3 }],
    group: groupId ? { id: groupId, name: "Group" } : undefined,
    ...patch,
  };
}

test("bulk scope resolver returns object, selected, group, and all targets in chart order", () => {
  const drawings = [drawing("a", "g"), drawing("b", "g"), drawing("c")];
  const selected = new Set(["a", "c", "missing"]);
  assert.deepEqual(resolveDrawingBulkTargets(drawings, selected, { kind: "object", drawingId: "b" }).map((item) => item.id), ["b"]);
  assert.deepEqual(resolveDrawingBulkTargets(drawings, selected, { kind: "selected" }).map((item) => item.id), ["a", "c"]);
  assert.deepEqual(resolveDrawingBulkTargets(drawings, selected, { kind: "group", groupId: "g" }).map((item) => item.id), ["a", "b"]);
  assert.deepEqual(resolveDrawingBulkTargets(drawings, selected, { kind: "all" }).map((item) => item.id), ["a", "b", "c"]);
});

test("bulk lock and visibility toggles converge mixed state then invert a uniform state", () => {
  assert.equal(nextDrawingBulkPropertyValue([drawing("a", undefined, { locked: true }), drawing("b")], "locked"), true);
  assert.equal(nextDrawingBulkPropertyValue([drawing("a", undefined, { locked: true }), drawing("b", undefined, { locked: true })], "locked"), false);
  assert.equal(nextDrawingBulkPropertyValue([drawing("a", undefined, { visible: false }), drawing("b")], "visible"), false);
  assert.equal(nextDrawingBulkPropertyValue([drawing("a", undefined, { visible: false }), drawing("b", undefined, { visible: false })], "visible"), true);
  assert.equal(drawingBulkActionLabel("visible", false), "Hide Drawings");
  assert.equal(drawingBulkActionLabel("locked", false), "Unlock Drawings");
});
