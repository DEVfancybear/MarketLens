import assert from "node:assert/strict";
import { test } from "node:test";

import { DuplicateDrawingCommand } from "../../src/components/chart/drawing/history/CommandManager";
import type { Drawing } from "../../src/types/drawing";

function fixture(): Drawing {
  return {
    id: "original",
    tool: "trendline",
    color: "#2962ff",
    lineWidth: 2,
    points: [
      { time: 10, price: 20 },
      { time: 30, price: 40 },
    ],
  };
}

test("repeated duplicate commands create non-empty unique IDs", () => {
  const drawings = new Map<string, Drawing>();
  const original = fixture();
  drawings.set(original.id, original);
  const add = (drawing: Drawing) => drawings.set(drawing.id, drawing);
  const remove = (id: string) => drawings.delete(id);

  new DuplicateDrawingCommand(add, remove, original).execute();
  new DuplicateDrawingCommand(add, remove, original).execute();

  const copies = [...drawings.values()].filter(
    (drawing) => drawing.id !== original.id,
  );
  assert.equal(copies.length, 2);
  assert.ok(copies.every((drawing) => drawing.id.trim().length > 0));
  assert.equal(new Set(drawings.keys()).size, 3);
});

test("a duplicate owns a fresh point array and can be removed in isolation", () => {
  const drawings = new Map<string, Drawing>();
  const original = fixture();
  drawings.set(original.id, original);
  const add = (drawing: Drawing) => drawings.set(drawing.id, drawing);
  const remove = (id: string) => drawings.delete(id);
  const command = new DuplicateDrawingCommand(add, remove, original);

  command.execute();
  const copy = [...drawings.values()].find(
    (drawing) => drawing.id !== original.id,
  );
  assert.ok(copy);
  assert.notStrictEqual(copy.points, original.points);
  assert.notStrictEqual(copy.points[0], original.points[0]);

  copy.points[0].price = 9999;
  assert.equal(original.points[0].price, 20);

  command.undo();
  assert.deepEqual([...drawings.keys()], [original.id]);
});
