import type { Drawing } from "../../../../types/drawing";
import type { HitResult } from "../hittest/HitTestEngine";

export interface SelectionPointerSample {
  hit: HitResult | null;
  clientX: number;
  clientY: number;
  timeStamp: number;
  button: number;
  /** Add/remove one drawing without clearing the rest of the selection. */
  toggleSelection: boolean;
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
    if (sample.toggleSelection && hit) {
      this.lastDown = null;
      return [{ kind: "toggle", drawingId: hit.drawing.id }];
    }

    // Clicking a member of an existing multi-selection must not collapse the
    // group before its shared transform starts.
    const alreadySelected = !!hit &&
      sample.selectedDrawingIds.has(hit.drawing.id);
    const outcomes: SelectionSessionOutcome[] = alreadySelected
      ? []
      : [{ kind: "select", drawingId: hit?.drawing.id ?? null }];
    const elapsed = this.lastDown
      ? sample.timeStamp - this.lastDown.time
      : Number.POSITIVE_INFINITY;
    const doubleClick = sample.button === 0 && !!hit && !!this.lastDown &&
      this.lastDown.id === hit.drawing.id &&
      elapsed >= 0 &&
      elapsed < DOUBLE_CLICK_MS &&
      Math.hypot(sample.clientX - this.lastDown.x, sample.clientY - this.lastDown.y) < DOUBLE_CLICK_DISTANCE;

    if (doubleClick && hit) {
      this.lastDown = null;
      outcomes.push({ kind: "open-settings", drawingId: hit.drawing.id });
      return outcomes;
    }
    this.lastDown = sample.button === 0
      ? {
          id: hit?.drawing.id ?? null,
          x: sample.clientX,
          y: sample.clientY,
          time: sample.timeStamp,
        }
      : null;
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
