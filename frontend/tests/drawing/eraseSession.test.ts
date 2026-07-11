import assert from "node:assert/strict";
import { test } from "node:test";

import type { Drawing } from "../../src/types/drawing";
import { EraseSession } from "../../src/components/chart/drawing/interaction/EraseSession";

test("eraser resolves the topmost adapter hit without mutating drawings", () => {
  const drawings: Drawing[] = ["back", "front"].map((id) => ({
    id,
    tool: "rectangle",
    color: "#2962ff",
    lineWidth: 1.5,
    points: [
      { time: 10, price: 10 },
      { time: 50, price: 50 },
    ],
  }));
  const eraser = new EraseSession((candidates) => candidates.at(-1) ?? null);
  assert.equal(eraser.pick(drawings, { time: 30, price: 30 })?.id, "front");
  assert.equal(drawings.length, 2);
});
