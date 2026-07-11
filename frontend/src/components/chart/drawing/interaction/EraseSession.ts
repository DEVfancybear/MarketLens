import type { Drawing, Point } from "../../../../types/drawing";

export type EraseHitResolver = (
  drawings: readonly Drawing[],
  point: Point,
) => Drawing | null;

/** Stateless eraser gesture service; command dispatch remains in the manager. */
export class EraseSession {
  constructor(private readonly resolveHit: EraseHitResolver) {}

  pick(drawings: readonly Drawing[], point: Point): Drawing | null {
    return this.resolveHit(drawings, point);
  }
}
