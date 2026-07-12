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
  PreviewedPropertyChangeCommand,
  BatchPropertyChangeCommand,
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

test("a batch property command groups several drawing changes into one history entry", () => {
  const state = drawingState();
  const history = new CommandManager();
  state.add(fixture("a"));
  state.add(fixture("b"));
  const group = { id: "group-1", name: "Analysis" };
  history.execute(new BatchPropertyChangeCommand(state.update, [
    { id: "a", newProps: { group }, oldProps: { group: undefined } },
    { id: "b", newProps: { group }, oldProps: { group: undefined } },
  ], "Group Objects"));
  assert.deepEqual(state.drawings.get("a")?.group, group);
  assert.deepEqual(state.drawings.get("b")?.group, group);
  assert.equal(history.undo(), true);
  assert.equal(state.drawings.get("a")?.group, undefined);
  assert.equal(state.drawings.get("b")?.group, undefined);
  assert.equal(history.redo(), true);
  assert.deepEqual(state.drawings.get("b")?.group, group);
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

test("a previewed settings transaction records once, then undo and redo round-trip", () => {
  const state = drawingState();
  const history = new CommandManager();
  const drawing = fixture();
  state.add(drawing);
  state.update({ id: drawing.id, patch: { color: "#f23645", lineWidth: 4 } });

  let mutations = 0;
  const update = (arg: { id: string; patch: Partial<Drawing> }) => {
    mutations += 1;
    state.update(arg);
  };
  history.execute(new PreviewedPropertyChangeCommand(
    update,
    drawing.id,
    { color: "#f23645", lineWidth: 4 },
    { color: drawing.color, lineWidth: drawing.lineWidth },
  ));

  assert.equal(mutations, 0, "OK records the existing preview without mutating again");
  assert.equal(history.undo(), true);
  assert.equal(state.drawings.get(drawing.id)?.color, drawing.color);
  assert.equal(history.redo(), true);
  assert.equal(state.drawings.get(drawing.id)?.lineWidth, 4);
  assert.equal(mutations, 2);
});
