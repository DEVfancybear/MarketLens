import assert from "node:assert/strict";
import test from "node:test";
import {
  MOBILE_SHEET_DISMISS_OFFSET_PX,
  createMobileSheetGestureState,
  transitionMobileSheetGesture,
} from "../../src/components/mobile/mobileSheetGesture";

function start(pointerId = 1, clientY = 100) {
  return transitionMobileSheetGesture(createMobileSheetGestureState(), {
    type: "start",
    pointerId,
    clientY,
    isPrimary: true,
  }).state;
}

test("drag offset starts only after the 8px movement threshold", () => {
  let state = start();

  state = transitionMobileSheetGesture(state, {
    type: "move",
    pointerId: 1,
    clientY: 108,
  }).state;
  assert.equal(state.offset, 0);

  state = transitionMobileSheetGesture(state, {
    type: "move",
    pointerId: 1,
    clientY: 109,
  }).state;
  assert.equal(state.offset, 1);

  state = transitionMobileSheetGesture(state, {
    type: "move",
    pointerId: 1,
    clientY: 95,
  }).state;
  assert.equal(state.offset, 0);
});

test("finish dismisses at a visible downward offset of 72px", () => {
  assert.equal(MOBILE_SHEET_DISMISS_OFFSET_PX, 72);
  let state = start();
  state = transitionMobileSheetGesture(state, {
    type: "move",
    pointerId: 1,
    clientY: 100 + 8 + MOBILE_SHEET_DISMISS_OFFSET_PX - 1,
  }).state;
  let result = transitionMobileSheetGesture(state, {
    type: "finish",
    pointerId: 1,
  });
  assert.equal(result.dismiss, false);

  state = start();
  state = transitionMobileSheetGesture(state, {
    type: "move",
    pointerId: 1,
    clientY: 100 + 8 + MOBILE_SHEET_DISMISS_OFFSET_PX,
  }).state;
  result = transitionMobileSheetGesture(state, {
    type: "finish",
    pointerId: 1,
  });
  assert.equal(result.dismiss, true);
  assert.deepEqual(result.state, createMobileSheetGestureState());
});

test("pointer cancellation always rolls back without dismissing", () => {
  let state = start(7, 40);
  state = transitionMobileSheetGesture(state, {
    type: "move",
    pointerId: 7,
    clientY: 200,
  }).state;
  assert.ok(state.offset > MOBILE_SHEET_DISMISS_OFFSET_PX);

  const cancelled = transitionMobileSheetGesture(state, {
    type: "cancel",
    pointerId: 7,
  });
  assert.equal(cancelled.handled, true);
  assert.equal(cancelled.dismiss, false);
  assert.deepEqual(cancelled.state, createMobileSheetGestureState());

  const staleFinish = transitionMobileSheetGesture(cancelled.state, {
    type: "finish",
    pointerId: 7,
  });
  assert.equal(staleFinish.handled, false);
  assert.equal(staleFinish.dismiss, false);
});

test("non-primary and foreign pointers cannot take ownership", () => {
  const idle = createMobileSheetGestureState();
  const secondaryStart = transitionMobileSheetGesture(idle, {
    type: "start",
    pointerId: 2,
    clientY: 100,
    isPrimary: false,
  });
  assert.equal(secondaryStart.handled, false);

  const owned = start(1);
  const foreignMove = transitionMobileSheetGesture(owned, {
    type: "move",
    pointerId: 2,
    clientY: 200,
  });
  assert.equal(foreignMove.handled, false);
  assert.equal(foreignMove.state, owned);
});
