import assert from "node:assert/strict";
import test from "node:test";
import { clampFloatingPoint, type ViewportRect } from "../../src/utils/viewport";

const viewport: ViewportRect = {
  left: 20,
  top: 40,
  width: 320,
  height: 568,
  right: 340,
  bottom: 608,
};

test("floating surfaces clamp to every visual viewport edge", () => {
  assert.deepEqual(
    clampFloatingPoint(
      { x: -100, y: -100 },
      { width: 180, height: 220 },
      viewport,
      8,
    ),
    { x: 28, y: 48 },
  );

  assert.deepEqual(
    clampFloatingPoint(
      { x: 320, y: 590 },
      { width: 180, height: 220 },
      viewport,
      8,
    ),
    { x: 152, y: 380 },
  );
});

test("oversized surfaces remain reachable from the safe leading edge", () => {
  assert.deepEqual(
    clampFloatingPoint(
      { x: 200, y: 300 },
      { width: 400, height: 700 },
      viewport,
      12,
    ),
    { x: 32, y: 52 },
  );
});
