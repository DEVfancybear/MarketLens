import type { DrawingTool, Point } from "@/types";

export type InteractionState =
  "Idle" | "Drawing" | "MovingDrawing" | "ResizingHandle";

export interface Machine {
  state: InteractionState;
  anchors: Point[];
  drawingTool: DrawingTool | null;
  drawingId: string | null;
  dragAnchor: number;
  dragStart: Point | null;
  dragOrig: Point[] | null;
  multiDragOrig: Map<string, Point[]>;
}

export function createInitialMachine(): Machine {
  return {
    state: "Idle",
    anchors: [],
    drawingTool: null,
    drawingId: null,
    dragAnchor: -1,
    dragStart: null,
    dragOrig: null,
    multiDragOrig: new Map(),
  };
}

export const INITIAL_MACHINE: Machine = createInitialMachine();
