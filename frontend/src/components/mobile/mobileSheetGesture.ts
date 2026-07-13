export const MOBILE_SHEET_DRAG_THRESHOLD_PX = 8;
export const MOBILE_SHEET_DISMISS_OFFSET_PX = 72;

export interface MobileSheetGestureState {
  pointerId: number | null;
  startY: number | null;
  offset: number;
}

export type MobileSheetGestureEvent =
  | { type: "start"; pointerId: number; clientY: number; isPrimary: boolean }
  | { type: "move"; pointerId: number; clientY: number }
  | { type: "finish"; pointerId: number }
  | { type: "cancel"; pointerId: number };

export interface MobileSheetGestureTransition {
  state: MobileSheetGestureState;
  handled: boolean;
  dismiss: boolean;
}

export function createMobileSheetGestureState(): MobileSheetGestureState {
  return { pointerId: null, startY: null, offset: 0 };
}

function ignored(state: MobileSheetGestureState): MobileSheetGestureTransition {
  return { state, handled: false, dismiss: false };
}

/** Pure pointer gesture state machine for the mobile sheet drag handle. */
export function transitionMobileSheetGesture(
  state: MobileSheetGestureState,
  event: MobileSheetGestureEvent,
): MobileSheetGestureTransition {
  switch (event.type) {
    case "start":
      if (
        !event.isPrimary ||
        state.pointerId !== null ||
        !Number.isFinite(event.clientY)
      ) {
        return ignored(state);
      }
      return {
        state: { pointerId: event.pointerId, startY: event.clientY, offset: 0 },
        handled: true,
        dismiss: false,
      };

    case "move": {
      if (
        event.pointerId !== state.pointerId ||
        state.startY === null ||
        !Number.isFinite(event.clientY)
      ) {
        return ignored(state);
      }
      const distance = event.clientY - state.startY;
      const offset = distance > MOBILE_SHEET_DRAG_THRESHOLD_PX
        ? distance - MOBILE_SHEET_DRAG_THRESHOLD_PX
        : 0;
      return {
        state: offset === state.offset ? state : { ...state, offset },
        handled: true,
        dismiss: false,
      };
    }

    case "finish":
      if (event.pointerId !== state.pointerId || state.pointerId === null) {
        return ignored(state);
      }
      return {
        state: createMobileSheetGestureState(),
        handled: true,
        dismiss: state.offset >= MOBILE_SHEET_DISMISS_OFFSET_PX,
      };

    case "cancel":
      if (event.pointerId !== state.pointerId || state.pointerId === null) {
        return ignored(state);
      }
      return {
        state: createMobileSheetGestureState(),
        handled: true,
        dismiss: false,
      };
  }
}
