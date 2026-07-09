import assert from "node:assert/strict";
import test from "node:test";
import {
  createInitialMachine,
  INITIAL_MACHINE,
} from "../../src/components/chart/drawing/interaction/machine";

test("drawing interaction machine factory returns isolated mutable containers", () => {
  const first = createInitialMachine();
  const second = createInitialMachine();

  first.anchors.push({ time: 1, price: 2 });
  first.multiDragOrig.set("dw_1", [{ time: 3, price: 4 }]);

  assert.equal(second.anchors.length, 0);
  assert.equal(second.multiDragOrig.size, 0);
  assert.notEqual(first.multiDragOrig, second.multiDragOrig);
});

test("exported initial drawing machine remains an idle immutable baseline by convention", () => {
  assert.equal(INITIAL_MACHINE.state, "Idle");
  assert.equal(INITIAL_MACHINE.anchors.length, 0);
  assert.equal(INITIAL_MACHINE.multiDragOrig.size, 0);
});
