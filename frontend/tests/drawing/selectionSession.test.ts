import assert from "node:assert/strict";
import { test } from "node:test";
import type { Drawing } from "../../src/types/drawing";
import { DRAWING_TOOLS } from "../../src/types/drawing";
import { SelectionSession } from "../../src/components/chart/drawing/interaction/SelectionSession";

const drawing: Drawing = { id: "a", tool: "trendline", color: "#fff", lineWidth: 1, points: [{ time: 1, price: 1 }, { time: 2, price: 2 }] };
const hit = { drawing, target: "body" as const, anchorIndex: -1, distance: 0 };
const base = { hit, clientX: 10, clientY: 10, timeStamp: 100, button: 0, toggleSelection: false, drawingsLocked: false, selectedDrawingIds: new Set<string>(), drawings: [drawing] };

test("selection session separates selection, transform, toggle, and double-click settings", () => {
  const session = new SelectionSession();
  assert.deepEqual(session.pointerDown(base).map((outcome) => outcome.kind), ["select", "transform"]);
  const doubled = session.pointerDown({ ...base, timeStamp: 200, clientX: 11, clientY: 11 });
  assert.deepEqual(doubled.map((outcome) => outcome.kind), ["select", "open-settings"]);
  assert.deepEqual(session.pointerDown({ ...base, toggleSelection: true }), [{ kind: "toggle", drawingId: "a" }]);
});

test("locked selections never start transform", () => {
  const session = new SelectionSession();
  assert.deepEqual(session.pointerDown({ ...base, drawingsLocked: true }).map((outcome) => outcome.kind), ["select"]);
});

test("dragging a member preserves the existing multi-selection", () => {
  const second = { ...drawing, id: "b" };
  const session = new SelectionSession();
  const outcomes = session.pointerDown({
    ...base,
    selectedDrawingIds: new Set(["a", "b"]),
    drawings: [drawing, second],
  });
  assert.deepEqual(outcomes.map((outcome) => outcome.kind), ["transform"]);
  const transform = outcomes[0];
  assert.equal(transform.kind, "transform");
  assert.deepEqual(
    transform.selectedDrawings?.map((candidate) => candidate.id),
    ["a", "b"],
  );
});

test("every persistent drawing family shares the double-click settings contract", () => {
  for (const tool of DRAWING_TOOLS) {
    const candidate = { ...drawing, id: `drawing-${tool}`, tool };
    const candidateHit = { ...hit, drawing: candidate };
    const session = new SelectionSession();
    session.pointerDown({ ...base, hit: candidateHit });
    const outcomes = session.pointerDown({
      ...base,
      hit: candidateHit,
      timeStamp: 200,
    });
    assert.deepEqual(
      outcomes.map((outcome) => outcome.kind),
      ["select", "open-settings"],
      `${tool}: settings`,
    );
  }
});

test("secondary-button clicks never masquerade as a settings double-click", () => {
  const session = new SelectionSession();
  session.pointerDown({ ...base, button: 2 });
  assert.deepEqual(
    session.pointerDown({ ...base, button: 2, timeStamp: 200 })
      .map((outcome) => outcome.kind),
    ["select"],
  );
});

test("a secondary click cannot arm a later primary settings double-click", () => {
  const session = new SelectionSession();
  session.pointerDown({ ...base, button: 2 });
  assert.deepEqual(
    session.pointerDown({ ...base, button: 0, timeStamp: 200 })
      .map((outcome) => outcome.kind),
    ["select", "transform"],
  );
});
