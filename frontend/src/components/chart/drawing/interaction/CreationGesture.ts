/**
 * Shared pointer semantics for tools whose creation can be completed either
 * by click-click or by press-drag-release.
 *
 * Keeping this state machine independent from the DOM handler prevents each
 * two-point tool from growing a subtly different drag threshold or pointer
 * ownership rule.
 */
export const CREATION_DRAG_THRESHOLD_PX = 4;

export interface CreationDragState {
  pointerId: number;
  startX: number;
  startY: number;
  dragged: boolean;
}

export function createCreationDragState(
  pointerId: number,
  startX: number,
  startY: number,
): CreationDragState {
  return { pointerId, startX, startY, dragged: false };
}

export function isPointerHeld(event: Pick<PointerEvent, "buttons" | "pressure">): boolean {
  return event.buttons !== 0 || event.pressure > 0;
}

/** Advance the shared drag state using one pointer sample. */
export function advanceCreationDrag(
  state: CreationDragState,
  sample: Pick<PointerEvent, "pointerId" | "clientX" | "clientY">,
): CreationDragState {
  if (
    state.dragged ||
    state.pointerId !== sample.pointerId
  ) {
    // The presence of this state means pointerdown has been received and its
    // matching pointerup/pointercancel has not. Do not rely on buttons/pressure
    // here: embedded browsers and some trackpads report buttons=0 on captured
    // pointermove events even while the physical button remains down.
    return state;
  }
  const distance = Math.hypot(
    sample.clientX - state.startX,
    sample.clientY - state.startY,
  );
  return distance >= CREATION_DRAG_THRESHOLD_PX
    ? { ...state, dragged: true }
    : state;
}
