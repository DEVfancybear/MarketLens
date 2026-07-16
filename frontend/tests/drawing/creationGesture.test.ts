import assert from "node:assert/strict";
import { test } from "node:test";

import {
  advanceCreationDrag,
  createCreationDragState,
  CREATION_DRAG_THRESHOLD_PX,
  isPointerHeld,
} from "../../src/components/chart/drawing/interaction/CreationGesture";

const sample = (overrides: Partial<PointerEvent> = {}) => ({
  pointerId: 1,
  clientX: 0,
  clientY: 0,
  buttons: 1,
  pressure: 0,
  ...overrides,
});

test("shared creation drag state has a threshold and pointer ownership", () => {
  const initial = createCreationDragState(7, 100, 100);
  assert.equal(advanceCreationDrag(initial, sample({ pointerId: 8, clientX: 200 })).dragged, false);
  assert.equal(advanceCreationDrag(initial, sample({ pointerId: 7, clientX: 100 + CREATION_DRAG_THRESHOLD_PX - 0.1, clientY: 100 })).dragged, false);
  assert.equal(advanceCreationDrag(initial, sample({ pointerId: 7, clientX: 100 + CREATION_DRAG_THRESHOLD_PX, clientY: 100 })).dragged, true);
});

test("shared creation drag state follows pointer ownership, not buttons telemetry", () => {
  const initial = createCreationDragState(1, 10, 10);
  assert.equal(isPointerHeld(sample({ buttons: 0, pressure: 0 })), false);
  assert.equal(
    advanceCreationDrag(initial, sample({ clientX: 100, clientY: 100, buttons: 0, pressure: 0 })).dragged,
    true,
  );
  assert.equal(isPointerHeld(sample({ buttons: 0, pressure: 0.5 })), true);
});
