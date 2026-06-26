/**
 * DrawingRendererLoop — rAF-based render loop for drawing overlays.
 */
import type { Drawing } from "@/types";
import { renderDrawing, type Projector } from "../drawingRenderer";
import type { Point } from "@/types";
import type { Machine } from "../interaction/DrawingInteractionManager";
import { getTool } from "../tools/ToolRegistry";
import { CoordinateCache } from "./CoordinateCache";
import { SpatialIndex } from "./SpatialIndex";
import { PerformanceMonitor } from "./PerformanceMonitor";

export interface RenderLoopDeps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  toX: (time: number) => number | null;
  toY: (price: number) => number | null;
  getData: () => {
    drawings: Drawing[];
    drawingsHidden: boolean;
    selectedDrawingId: string | null;
    drawColor: string;
    activeTool: Drawing["tool"];
    machine: Machine | null;
    chartReady: boolean;
    livePoints: Point[] | null;
    draggingId: string | null;
    hoveredId: string | null;
  };
  onVersionChange?: (cb: () => void) => () => void;
}

export interface RenderLoop {
  markDirty: () => void;
  destroy: () => void;
}

export function createRenderLoop(deps: RenderLoopDeps): RenderLoop {
  const {
    canvasRef,
    toX: rawToX,
    toY: rawToY,
    getData,
    onVersionChange,
  } = deps;

  const coordCache = new CoordinateCache();
  const spatialIndex = new SpatialIndex();
  const perf = PerformanceMonitor.get();

  const toX = (time: number) => coordCache.timeToX(time, rawToX);
  const toY = (price: number) => coordCache.priceToY(price, rawToY);

  let dirty = true;
  let rafId: number | null = null;
  let lastCanvasW = 0;
  let lastCanvasH = 0;
  let lastDrawingsHash = "";
  let lastSelectedId: string | null = null;
  let lastHidden = false;
  let lastMachineState = "";
  let lastMachineAnchorsLen = 0;
  let lastActiveTool = "";
  let lastDrawColor = "";
  let lastLiveHash = "";

  function drawingsHash(ds: Drawing[]): string {
    let h = String(ds.length);
    for (let i = 0; i < ds.length; i++) {
      const d = ds[i];
      h += "|" + d.id + ":" + d.points.length;
      for (let j = 0; j < d.points.length; j++) {
        h +=
          "," +
          d.points[j].time.toFixed(0) +
          "," +
          d.points[j].price.toFixed(4);
      }
    }
    return h;
  }

  function liveHash(pts: Point[] | null): string {
    if (!pts) return "-";
    let h = String(pts.length);
    for (let j = 0; j < pts.length; j++) {
      h += "," + pts[j].time.toFixed(0) + "," + pts[j].price.toFixed(4);
    }
    return h;
  }

  function render() {
    rafId = null;
    dirty = false;

    const canvas = canvasRef.current;
    const data = getData();
    if (!canvas || !data.chartReady) return;

    const t0 = performance.now();
    coordCache.nextFrame();

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const cw = Math.round(rect.width * dpr);
    const ch = Math.round(rect.height * dpr);

    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }

    const m = data.machine;
    const machineState = m?.state ?? "";
    const machineAnchorsLen = m?.anchors.length ?? 0;
    const drawHash = drawingsHash(data.drawings);
    const liveH = liveHash(data.livePoints);

    if (
      drawHash === lastDrawingsHash &&
      data.selectedDrawingId === lastSelectedId &&
      data.drawingsHidden === lastHidden &&
      machineState === lastMachineState &&
      machineAnchorsLen === lastMachineAnchorsLen &&
      data.activeTool === lastActiveTool &&
      data.drawColor === lastDrawColor &&
      liveH === lastLiveHash &&
      cw === lastCanvasW &&
      ch === lastCanvasH
    ) {
      return;
    }

    lastDrawingsHash = drawHash;
    lastSelectedId = data.selectedDrawingId;
    lastHidden = data.drawingsHidden;
    lastMachineState = machineState;
    lastMachineAnchorsLen = machineAnchorsLen;
    lastActiveTool = data.activeTool;
    lastDrawColor = data.drawColor;
    lastLiveHash = liveH;
    lastCanvasW = cw;
    lastCanvasH = ch;

    const g = canvas.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, rect.width, rect.height);

    const storeDrawings: Drawing[] = data.drawingsHidden
      ? []
      : [...data.drawings];
    if (data.livePoints && data.draggingId) {
      for (let i = 0; i < storeDrawings.length; i++) {
        if (storeDrawings[i].id === data.draggingId) {
          storeDrawings[i] = { ...storeDrawings[i], points: data.livePoints };
          break;
        }
      }
    }

    const projector: Projector = {
      toX,
      toY,
      width: rect.width,
      height: rect.height,
    };

    // Only inject the preview drawing when enough anchors are placed.
    const pr =
      m?.state === "Drawing" && m.anchors.length > 0 ? m.anchors : null;
    const tool =
      m?.state === "Drawing" ? (m.drawingTool ?? data.activeTool) : null;
    const all =
      pr && tool && pr.length >= (getTool(tool)?.minPoints ?? 2)
        ? [
            ...storeDrawings,
            {
              id: "__pending",
              tool,
              color: data.drawColor,
              lineWidth: 1.5,
              points: pr,
              visible: true,
            } as Drawing,
          ]
        : storeDrawings;

    spatialIndex.rebuild(all, toX, toY);

    const viewport = spatialIndex.queryViewport(0, 0, rect.width, rect.height);
    const sorted = [...viewport].sort(
      (a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0),
    );

    let drawn = 0;
    // Hover highlight
    const hovered = data.hoveredId ? sorted.find(d => d.id === data.hoveredId && d.visible !== false) : null;
    if (hovered && !data.drawingsHidden) { g.save(); g.globalAlpha = 0.3; g.strokeStyle = hovered.color; g.fillStyle = hovered.color; g.lineWidth = (hovered.lineWidth || 1.5) * 2.5; renderDrawing(g, hovered, projector, false); g.restore(); }
    for (const d of sorted) {
      if (d.visible === false) continue;
      const selected = d.id === data.selectedDrawingId;
      g.strokeStyle = d.color;
      g.fillStyle = d.color;
      g.lineWidth = (d.lineWidth || 1.5) * (selected ? 1.6 : 1);
      renderDrawing(g, d, projector, selected);
      drawn++;
    }

    const skipped = all.length - drawn;
    const renderMs = performance.now() - t0;
    perf.recordFrame(renderMs, 0, drawn, skipped, all.length);
  }

  function schedule() {
    if (rafId !== null) return;
    rafId = requestAnimationFrame(() => render());
  }

  function markDirty() {
    dirty = true;
    schedule();
  }

  let unsubVersion: (() => void) | undefined;
  if (onVersionChange) {
    unsubVersion = onVersionChange(() => markDirty());
  }

  schedule();

  return {
    markDirty,
    destroy: () => {
      unsubVersion?.();
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    },
  };
}
