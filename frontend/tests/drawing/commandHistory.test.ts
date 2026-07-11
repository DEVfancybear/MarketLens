import assert from "node:assert/strict";
import { test } from "node:test";

import type { Drawing } from "../../src/types/drawing";
import {
  CommandManager,
  CreateDrawingCommand,
  DeleteDrawingCommand,
  DuplicateDrawingCommand,
  MoveDrawingCommand,
  PropertyChangeCommand,
} from "../../src/components/chart/drawing/history/CommandManager";

function fixture(id = "drawing-1"): Drawing {
  return {
    id,
    tool: "trendline",
    color: "#2962ff",
    lineWidth: 2,
    points: [
      { time: 10, price: 20 },
      { time: 30, price: 40 },
    ],
  };
}

function drawingState() {
  const drawings = new Map<string, Drawing>();
  return {
    drawings,
    add: (drawing: Drawing) => drawings.set(drawing.id, structuredClone(drawing)),
    remove: (id: string) => drawings.delete(id),
    update: ({ id, patch }: { id: string; patch: Partial<Drawing> }) => {
      const current = drawings.get(id);
      if (current) drawings.set(id, { ...current, ...structuredClone(patch) });
    },
  };
}

test("create, move, property, delete, and duplicate commands round-trip", () => {
  const state = drawingState();
  const history = new CommandManager();
  const original = fixture();

  history.execute(new CreateDrawingCommand(state.add, state.remove, original));
  assert.equal(state.drawings.size, 1);

  const moved = original.points.map((point) => ({
    time: point.time + 5,
    price: point.price + 10,
  }));
  history.execute(
    new MoveDrawingCommand(state.update, original.id, moved, original.points),
  );
  assert.deepEqual(state.drawings.get(original.id)?.points, moved);

  history.execute(
    new PropertyChangeCommand(
      state.update,
      original.id,
      { color: "#f23645", locked: true },
      { color: original.color, locked: undefined },
    ),
  );
  assert.equal(state.drawings.get(original.id)?.locked, true);

  history.execute(
    new DuplicateDrawingCommand(state.add, state.remove, state.drawings.get(original.id)!),
  );
  assert.equal(state.drawings.size, 2);
  assert.equal(new Set(state.drawings.keys()).size, 2);

  assert.equal(history.undo(), true);
  assert.equal(state.drawings.size, 1);
  assert.equal(history.undo(), true);
  assert.equal(state.drawings.get(original.id)?.color, original.color);
  assert.equal(history.redo(), true);
  assert.equal(state.drawings.get(original.id)?.color, "#f23645");

  history.execute(
    new DeleteDrawingCommand(
      state.add,
      state.remove,
      state.drawings.get(original.id)!,
    ),
  );
  assert.equal(state.drawings.has(original.id), false);
  assert.equal(history.undo(), true);
  assert.equal(state.drawings.has(original.id), true);
});

test("history enforces its maximum size and invalidates redo on a new command", () => {
  const state = drawingState();
  const history = new CommandManager(2);
  history.execute(new CreateDrawingCommand(state.add, state.remove, fixture("a")));
  history.execute(new CreateDrawingCommand(state.add, state.remove, fixture("b")));
  history.execute(new CreateDrawingCommand(state.add, state.remove, fixture("c")));
  assert.equal(history.undo(), true);
  assert.equal(history.undo(), true);
  assert.equal(history.undo(), false);
  history.execute(new CreateDrawingCommand(state.add, state.remove, fixture("d")));
  assert.equal(history.redo(), false);
});
