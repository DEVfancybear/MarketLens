import assert from "node:assert/strict";
import { test } from "node:test";

import type { Drawing } from "../../src/types/drawing";
import { applyDrawingBatchUpdates } from "../../src/store/drawingBatchUpdate";

function fixture(id: string, clientRevision?: number): Drawing {
  return {
    id,
    tool: "trendline",
    color: "#2962ff",
    lineWidth: 2,
    points: [
      { time: 10, price: 20 },
      { time: 30, price: 40 },
    ],
    clientRevision,
  };
}

test("drawing batch updates publish final values and advance each client revision", () => {
  const first = fixture("a", 4);
  const second = fixture("b");
  const untouched = fixture("c", 9);
  const current = [first, second, untouched];
  const moved = second.points.map((point) => ({
    time: point.time + 5,
    price: point.price + 10,
  }));

  const result = applyDrawingBatchUpdates(current, [
    { id: "a", patch: { color: "#f23645" } },
    { id: "b", patch: { points: moved } },
    { id: "missing", patch: { locked: true } },
  ]);

  assert.notEqual(result.drawings, current);
  assert.equal(result.drawings[0].clientRevision, 5);
  assert.equal(result.drawings[0].color, "#f23645");
  assert.equal(result.drawings[1].clientRevision, 1);
  assert.deepEqual(result.drawings[1].points, moved);
  assert.equal(result.drawings[2], untouched, "unaffected objects retain identity");
  assert.equal(result.updatedById.size, 2);
  assert.equal(first.color, "#2962ff", "the previous state is not mutated");
});

test("repeated ids retain sequential revision and patch semantics without intermediate arrays", () => {
  const current = [fixture("a", 2)];
  const result = applyDrawingBatchUpdates(current, [
    { id: "a", patch: { color: "#f23645" } },
    { id: "a", patch: { lineWidth: 5 } },
  ]);

  assert.equal(result.drawings[0].clientRevision, 4);
  assert.equal(result.drawings[0].color, "#f23645");
  assert.equal(result.drawings[0].lineWidth, 5);

  const noMatch = applyDrawingBatchUpdates(current, [
    { id: "missing", patch: { visible: false } },
  ]);
  assert.equal(noMatch.drawings, current);
  assert.equal(noMatch.updatedById.size, 0);
});
