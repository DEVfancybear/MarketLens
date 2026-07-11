import assert from "node:assert/strict";
import { test } from "node:test";
import type { Drawing } from "../../src/types/drawing";
import { SelectionSession } from "../../src/components/chart/drawing/interaction/SelectionSession";

const drawing: Drawing = { id: "a", tool: "trendline", color: "#fff", lineWidth: 1, points: [{ time: 1, price: 1 }, { time: 2, price: 2 }] };
const hit = { drawing, target: "body" as const, anchorIndex: -1, distance: 0 };
const base = { hit, clientX: 10, clientY: 10, timeStamp: 100, button: 0, shiftKey: false, drawingsLocked: false, selectedDrawingIds: new Set<string>(), drawings: [drawing] };

test("selection session separates selection, transform, toggle, and double-click settings", () => {
  const session = new SelectionSession();
  assert.deepEqual(session.pointerDown(base).map((outcome) => outcome.kind), ["select", "transform"]);
  assert.deepEqual(session.pointerDown({ ...base, shiftKey: true }), [{ kind: "toggle", drawingId: "a" }]);
  const doubled = session.pointerDown({ ...base, timeStamp: 200, clientX: 11, clientY: 11 });
  assert.deepEqual(doubled.map((outcome) => outcome.kind), ["select", "open-settings"]);
});

test("locked selections never start transform", () => {
  const session = new SelectionSession();
  assert.deepEqual(session.pointerDown({ ...base, drawingsLocked: true }).map((outcome) => outcome.kind), ["select"]);
});
