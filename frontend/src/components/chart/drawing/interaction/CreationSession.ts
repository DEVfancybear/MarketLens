import type { Point } from "../../../../types/drawing";
import {
  getDrawingToolManifestEntry,
  type DrawingTool,
  type DrawingToolManifestEntry,
} from "../../../../types/drawingToolManifest";

export interface CreationPointerSample {
  point: Point;
  clientX: number;
  clientY: number;
  timeStamp: number;
}

export type CreationSessionOutcome =
  | { kind: "preview"; points: Point[] }
  | { kind: "commit"; points: Point[] }
  | { kind: "cancel" };

const DOUBLE_CLICK_MS = 350;
const DOUBLE_CLICK_DISTANCE = 6;

function clonePoints(points: readonly Point[]): Point[] {
  return points.map((point) => ({ ...point }));
}

/**
 * Owns drawing-creation gesture state. DOM capture, chart arbitration and the
 * actual history/persistence command remain responsibilities of the caller.
 */
export class CreationSession {
  readonly tool: DrawingTool;
  readonly definition: DrawingToolManifestEntry;
  private confirmed: Point[] = [];
  private lastDown: Omit<CreationPointerSample, "point"> | null = null;

  constructor(tool: DrawingTool) {
    this.tool = tool;
    this.definition = getDrawingToolManifestEntry(tool);
    if (!this.definition.persistent) {
      throw new Error(`Cannot create a drawing session for mode tool: ${tool}`);
    }
  }

  get points(): readonly Point[] {
    return this.confirmed;
  }

  pointerDown(sample: CreationPointerSample): CreationSessionOutcome {
    const { creationMode, maxPoints, minPoints } = this.definition;
    if (creationMode === "one-point") {
      this.confirmed = [{ ...sample.point }];
      return { kind: "commit", points: clonePoints(this.confirmed) };
    }
    if (creationMode === "pointer-continuous") {
      if (this.confirmed.length === 0) this.confirmed = [{ ...sample.point }];
      return { kind: "preview", points: clonePoints(this.confirmed) };
    }

    if (creationMode === "click-freeform" && this.isDoubleClick(sample)) {
      return this.confirmed.length >= minPoints
        ? { kind: "commit", points: clonePoints(this.confirmed) }
        : { kind: "cancel" };
    }

    this.lastDown = {
      clientX: sample.clientX,
      clientY: sample.clientY,
      timeStamp: sample.timeStamp,
    };
    this.confirmed = [...this.confirmed, { ...sample.point }];

    if (creationMode === "two-point" && this.confirmed.length >= 2) {
      return { kind: "commit", points: clonePoints(this.confirmed.slice(0, 2)) };
    }
    if (creationMode === "fixed-multi-point" && maxPoints != null && this.confirmed.length >= maxPoints) {
      return { kind: "commit", points: clonePoints(this.confirmed.slice(0, maxPoints)) };
    }
    return { kind: "preview", points: clonePoints(this.confirmed) };
  }

  pointerMove(point: Point, acceptContinuousPoint = true): CreationSessionOutcome {
    if (this.confirmed.length === 0) return { kind: "cancel" };
    if (this.definition.creationMode === "pointer-continuous") {
      if (acceptContinuousPoint) this.confirmed = [...this.confirmed, { ...point }];
      return { kind: "preview", points: clonePoints(this.confirmed) };
    }
    return {
      kind: "preview",
      points: [...clonePoints(this.confirmed), { ...point }],
    };
  }

  pointerUp(point?: Point, acceptContinuousPoint = true): CreationSessionOutcome {
    if (this.definition.creationMode !== "pointer-continuous") {
      return { kind: "preview", points: clonePoints(this.confirmed) };
    }
    if (point && acceptContinuousPoint) this.confirmed = [...this.confirmed, { ...point }];
    return this.confirmed.length >= this.definition.minPoints
      ? { kind: "commit", points: clonePoints(this.confirmed) }
      : { kind: "cancel" };
  }

  finish(): CreationSessionOutcome {
    if (
      this.definition.creationMode === "click-freeform" &&
      this.confirmed.length >= this.definition.minPoints
    ) {
      return { kind: "commit", points: clonePoints(this.confirmed) };
    }
    return { kind: "cancel" };
  }

  cancel(): CreationSessionOutcome {
    return { kind: "cancel" };
  }

  private isDoubleClick(sample: CreationPointerSample): boolean {
    return !!this.lastDown &&
      sample.timeStamp - this.lastDown.timeStamp < DOUBLE_CLICK_MS &&
      Math.hypot(sample.clientX - this.lastDown.clientX, sample.clientY - this.lastDown.clientY) < DOUBLE_CLICK_DISTANCE;
  }
}
