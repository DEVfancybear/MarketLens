import type { Drawing } from "../../../../types/drawing";
import type { HitResult } from "../hittest/HitTestEngine";

export interface SelectionPointerSample {
  hit: HitResult | null;
  clientX: number;
  clientY: number;
  timeStamp: number;
  button: number;
  shiftKey: boolean;
  drawingsLocked: boolean;
  selectedDrawingIds: ReadonlySet<string>;
  drawings: readonly Drawing[];
}

export type SelectionSessionOutcome =
  | { kind: "toggle"; drawingId: string }
  | { kind: "select"; drawingId: string | null }
  | { kind: "open-settings"; drawingId: string }
  | {
      kind: "transform";
      drawing: Drawing;
      anchorIndex: number;
      mode: "move" | "resize";
      selectedDrawings?: Drawing[];
    };

const DOUBLE_CLICK_MS = 350;
const DOUBLE_CLICK_DISTANCE = 6;

export class SelectionSession {
  private lastDown: { id: string | null; x: number; y: number; time: number } | null = null;

  pointerDown(sample: SelectionPointerSample): SelectionSessionOutcome[] {
    const { hit } = sample;
    if (sample.shiftKey && hit) {
      return [{ kind: "toggle", drawingId: hit.drawing.id }];
    }

    const outcomes: SelectionSessionOutcome[] = [
      { kind: "select", drawingId: hit?.drawing.id ?? null },
    ];
    const doubleClick = !!hit && !!this.lastDown &&
      this.lastDown.id === hit.drawing.id &&
      sample.timeStamp - this.lastDown.time < DOUBLE_CLICK_MS &&
      Math.hypot(sample.clientX - this.lastDown.x, sample.clientY - this.lastDown.y) < DOUBLE_CLICK_DISTANCE;
    this.lastDown = {
      id: hit?.drawing.id ?? null,
      x: sample.clientX,
      y: sample.clientY,
      time: sample.timeStamp,
    };

    if (doubleClick && hit) {
      outcomes.push({ kind: "open-settings", drawingId: hit.drawing.id });
      return outcomes;
    }
    if (!hit || sample.drawingsLocked || hit.drawing.locked || sample.button !== 0) {
      return outcomes;
    }

    const anchorIndex = hit.anchorIndex ?? -1;
    const isMulti = sample.selectedDrawingIds.size > 1 &&
      sample.selectedDrawingIds.has(hit.drawing.id);
    outcomes.push({
      kind: "transform",
      drawing: hit.drawing,
      anchorIndex: isMulti ? -1 : anchorIndex,
      mode: anchorIndex < 0 ? "move" : "resize",
      selectedDrawings: isMulti
        ? sample.drawings.filter((drawing) => sample.selectedDrawingIds.has(drawing.id))
        : undefined,
    });
    return outcomes;
  }
}
