import assert from "node:assert/strict";
import { test } from "node:test";
import type { Drawing } from "../../src/types/drawing";
import {
  buildDrawingBulkPatchChanges,
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

test("bulk style patches keep per-object undo values and skip incompatible or unchanged drawings", () => {
  const source = [
    drawing("line", undefined, { color: "#2962ff" }),
    drawing("text", undefined, { tool: "text", color: "#2962ff", textColor: undefined }),
    drawing("same", undefined, { color: "#f23645" }),
  ];

  const changes = buildDrawingBulkPatchChanges(source, (item) => {
    if (item.id === "same") return { color: "#f23645" };
    if (item.tool === "text") return { color: "#f23645", textColor: "#f23645" };
    return { color: "#f23645" };
  });

  assert.deepEqual(changes, [
    {
      id: "line",
      newProps: { color: "#f23645" },
      oldProps: { color: "#2962ff" },
    },
    {
      id: "text",
      newProps: { color: "#f23645", textColor: "#f23645" },
      oldProps: { color: "#2962ff", textColor: undefined },
    },
  ]);
});

test("bulk fill patches clear only compatible drawings that currently have a fill", () => {
  const source = [
    drawing("line"),
    drawing("filled", undefined, { tool: "rectangle", fillColor: "#ff9800" }),
    drawing("empty", undefined, { tool: "rectangle", fillColor: undefined }),
  ];

  const changes = buildDrawingBulkPatchChanges(source, (item) =>
    item.tool === "rectangle" ? { fillColor: undefined } : null,
  );

  assert.deepEqual(changes, [{
    id: "filled",
    newProps: { fillColor: undefined },
    oldProps: { fillColor: "#ff9800" },
  }]);
});
