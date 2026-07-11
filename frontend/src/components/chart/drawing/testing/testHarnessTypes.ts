import type { Drawing } from "../../../../types/drawing";
import type { DrawingAdapterContractResult } from "./adapterContractAudit";

export interface DrawingInteractionTestSnapshot {
  drawings: Drawing[];
  activeTool: string;
  selectedDrawingId: string | null;
  selectedDrawingIds: string[];
  machineState: string;
  canvas: { x: number; y: number; width: number; height: number };
}

export interface DrawingInteractionTestHarness {
  snapshot: () => DrawingInteractionTestSnapshot;
  auditAdapters: () => DrawingAdapterContractResult;
  projectDrawing: (id: string) => Array<{ x: number; y: number }> | null;
  inspectClientPoint: (x: number, y: number) => {
    insideCanvas: boolean;
    overDrawingUi: boolean;
    target: string | null;
    hits: Array<{ id: string; target: string; distance: number }>;
  };
  clear: () => void;
  changeSymbol: (symbol: string) => void;
}
