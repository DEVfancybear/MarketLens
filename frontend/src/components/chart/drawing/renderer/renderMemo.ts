export interface RenderMemoState {
  drawingsHash: string;
  selectedDrawingId: string | null;
  selectedDrawingIdsHash: string;
  drawingsHidden: boolean;
  machineState: string;
  machineAnchorsSig: string;
  activeTool: string;
  drawColor: string;
  liveHash: string;
  hoveredId: string | null;
  canvasW: number;
  canvasH: number;
  barIntervalSeconds: number;
  /** Referential revision supplied by the composition root. */
  marketContext: object | undefined;
}

export function selectedIdsHash(ids: Set<string> | undefined): string {
  if (!ids || ids.size === 0) return "-";
  return [...ids].sort().join(",");
}

export function sameRenderMemoState(
  a: RenderMemoState,
  b: RenderMemoState,
): boolean {
  return (
    a.drawingsHash === b.drawingsHash &&
    a.selectedDrawingId === b.selectedDrawingId &&
    a.selectedDrawingIdsHash === b.selectedDrawingIdsHash &&
    a.drawingsHidden === b.drawingsHidden &&
    a.machineState === b.machineState &&
    a.machineAnchorsSig === b.machineAnchorsSig &&
    a.activeTool === b.activeTool &&
    a.drawColor === b.drawColor &&
    a.liveHash === b.liveHash &&
    a.hoveredId === b.hoveredId &&
    a.canvasW === b.canvasW &&
    a.canvasH === b.canvasH &&
    a.barIntervalSeconds === b.barIntervalSeconds &&
    a.marketContext === b.marketContext
  );
}
