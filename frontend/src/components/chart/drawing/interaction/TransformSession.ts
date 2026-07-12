import type { Drawing, Point } from "../../../../types/drawing";
import {
  defaultMove,
  defaultMoveAnchor,
  getTool,
} from "../tools/ToolRegistry";

export type TransformMode = "move" | "resize";

function clonePoints(points: readonly Point[]): Point[] {
  return points.map((point) => ({ ...point }));
}

export interface TransformSessionOptions {
  drawing: Drawing;
  dragStart: Point;
  anchorIndex: number;
  mode: TransformMode;
  selectedDrawings?: readonly Drawing[];
}

/** Owns immutable drag snapshots and produces transient geometry per sample. */
export class TransformSession {
  readonly drawingId: string;
  readonly tool: Drawing["tool"];
  readonly dragStart: Point;
  readonly anchorIndex: number;
  readonly mode: TransformMode;
  readonly primaryOriginal: Point[];
  private readonly originals = new Map<string, Point[]>();

  constructor(options: TransformSessionOptions) {
    this.drawingId = options.drawing.id;
    this.tool = options.drawing.tool;
    this.dragStart = { ...options.dragStart };
    this.anchorIndex = options.anchorIndex;
    this.mode = options.mode;
    this.primaryOriginal = clonePoints(options.drawing.points);
    for (const drawing of options.selectedDrawings ?? []) {
      this.originals.set(drawing.id, clonePoints(drawing.points));
    }
  }

  get isMulti(): boolean {
    return this.originals.size > 1 && this.originals.has(this.drawingId);
  }

  get multiOriginals(): ReadonlyMap<string, Point[]> {
    return this.originals;
  }

  originalPointsFor(id: string): Point[] | undefined {
    const points = this.originals.get(id);
    if (points) return clonePoints(points);
    return id === this.drawingId ? clonePoints(this.primaryOriginal) : undefined;
  }

  hasChanged(id: string, points: readonly Point[]): boolean {
    const original = this.originals.get(id) ??
      (id === this.drawingId ? this.primaryOriginal : undefined);
    return !original || original.length !== points.length || original.some(
      (point, index) =>
        point.time !== points[index]?.time || point.price !== points[index]?.price,
    );
  }

  /** Convert a snapped primary-anchor target back into the drag pointer space. */
  pointerAdjustedForSnap(pointer: Point, snap: (point: Point) => Point): Point {
    if (this.mode === "resize") return snap(pointer);
    const reference = this.primaryOriginal[0];
    if (!reference) return pointer;
    const translatedReference = {
      time: reference.time + pointer.time - this.dragStart.time,
      price: reference.price + pointer.price - this.dragStart.price,
    };
    const snappedReference = snap(translatedReference);
    return {
      time: this.dragStart.time + snappedReference.time - reference.time,
      price: this.dragStart.price + snappedReference.price - reference.price,
    };
  }

  update(pointer: Point): Map<string, Point[]> {
    if (this.isMulti) {
      const dt = pointer.time - this.dragStart.time;
      const dp = pointer.price - this.dragStart.price;
      const result = new Map<string, Point[]>();
      for (const [id, points] of this.originals) {
        result.set(
          id,
          points.map((point) => ({
            time: point.time + dt,
            price: point.price + dp,
          })),
        );
      }
      return result;
    }

    const adapter = getTool(this.tool);
    const points = this.mode === "resize" && this.anchorIndex >= 0
      ? adapter
        ? adapter.moveAnchor(this.primaryOriginal, this.anchorIndex, pointer)
        : defaultMoveAnchor(this.primaryOriginal, this.anchorIndex, pointer)
      : adapter
        ? adapter.move(this.primaryOriginal, pointer, this.dragStart)
        : defaultMove(this.primaryOriginal, pointer, this.dragStart);
    return new Map([[this.drawingId, points]]);
  }
}
