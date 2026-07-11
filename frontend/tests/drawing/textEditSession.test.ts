import assert from "node:assert/strict";
import { test } from "node:test";
import type { Drawing } from "../../src/types/drawing";
import { TextEditSession } from "../../src/components/chart/drawing/interaction/TextEditSession";

const drawing: Drawing = { id: "t", tool: "text", color: "#fff", lineWidth: 1, points: [{ time: 1, price: 2 }], text: "old" };

test("standalone text session creates or removes its placeholder exactly once", () => {
  const session = TextEditSession.standalone({ ...drawing, text: "" }, { x: 10, y: 20 });
  assert.equal(session.withDraft("hello").finish().kind, "create");
  assert.deepEqual(session.cancel(), { kind: "cancel-create", placeholderId: "t" });
});

test("attached text session produces reversible old/new text", () => {
  const session = TextEditSession.attached(drawing, "line-midpoint");
  assert.deepEqual(session.finish("new"), { kind: "update", drawingId: "t", oldText: "old", newText: "new" });
  assert.deepEqual(session.finish("old"), { kind: "close" });
  assert.deepEqual(session.finish("  ", false), { kind: "close" });
});
