import type { Point } from "@/types";
import type { HitTestProjector } from "../hittest/HitTestEngine";

/**
 * Lock a whole-drawing drag to the dominant screen axis.
 *
 * Time and price use unrelated scales, so comparing their raw deltas would
 * make the chosen axis depend on symbol price and timeframe. Screen pixels
 * keep the gesture stable for every drawing tool and chart scale.
 */
export function constrainMovePointerToAxis(
  dragStart: Point,
  pointer: Point,
  toX: HitTestProjector,
  toY: HitTestProjector,
): Point {
  const startX = toX(dragStart.time);
  const startY = toY(dragStart.price);
  const pointerX = toX(pointer.time);
  const pointerY = toY(pointer.price);
  if (
    startX == null ||
    startY == null ||
    pointerX == null ||
    pointerY == null
  ) {
    return pointer;
  }

  return Math.abs(pointerX - startX) >= Math.abs(pointerY - startY)
    ? { time: pointer.time, price: dragStart.price }
    : { time: dragStart.time, price: pointer.price };
}
