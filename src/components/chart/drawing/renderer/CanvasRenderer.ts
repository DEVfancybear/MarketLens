/**
 * DrawingRendererLoop — rAF-based render loop for drawing overlays.
 *
 * Decouples drawing rendering from React's render cycle. A single
 * requestAnimationFrame loop runs while dirty. Redraws only happen
 * when: the chart moves (version bump), drawings change, selection
 * changes, hidden/locked flags change, or the interaction state
 * produces a preview.
 *
 * Removes React useCallback churn and per-tick re-renders from the
 * drawing canvas path.
 */
import type { Drawing } from "@/types";
import { renderDrawing, type Projector } from "../drawingRenderer";
import type { Point } from "@/types";
import type { Machine } from "../interaction/InteractionManager";

export interface RenderLoopDeps {
  /** Ref to the overlay canvas. */
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  /** Convert time → pixel x. */
  toX: (time: number) => number | null;
  /** Convert price → pixel y. */
  toY: (price: number) => number | null;
  /** Read latest data on each frame (stable closure, no React deps). */
  getData: () => {
    drawings: Drawing[];
    drawingsHidden: boolean;
    selectedDrawingId: string | null;
    drawColor: string;
    activeTool: Drawing["tool"];
    machine: Machine | null;
    chartReady: boolean;
    /** Live point positions during drag (not yet in store). */
    livePoints: Point[] | null;
    /** Drawing being dragged. */
    draggingId: string | null;
  };
  /** Called when the chart viewport changes (version bump). */
  onVersionChange?: (cb: () => void) => () => void;
}

export interface RenderLoop {
  /** Mark the next frame as dirty — schedules a redraw. */
  markDirty: () => void;
  /** Stop the loop and clean up. */
  destroy: () => void;
}

export function createRenderLoop(deps: RenderLoopDeps): RenderLoop {
  const { canvasRef, toX, toY, getData, onVersionChange } = deps;

  let dirty = true;
  let rafId: number | null = null;
  let lastCanvasW = 0;
  let lastCanvasH = 0;

  // ---- Snapshot of last-rendered state (avoid redraws on identical data) ----
  let lastDrawingsHash = "";
  let lastSelectedId: string | null = null;
  let lastHidden = false;
  let lastMachineState = "";
  let lastMachineAnchorsLen = 0;
  let lastActiveTool = "";
  let lastDrawColor = "";
  let lastLiveHash = "";

  /** Quick content hash: drawing count + ids + point positions. */
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

  // ---- Render function (pure, no deps) ----
  function render() {
    rafId = null;
    dirty = false;

    const canvas = canvasRef.current;
    const data = getData();
    if (!canvas || !data.chartReady) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const cw = Math.round(rect.width * dpr);
    const ch = Math.round(rect.height * dpr);

    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }

    // Skip if nothing at all changed.
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

    // ---- Draw ----
    const g = canvas.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, rect.width, rect.height);

    // Build visible set, injecting live positions for the dragged drawing.
    const visible: Drawing[] = data.drawingsHidden ? [] : [...data.drawings];
    if (data.livePoints && data.draggingId) {
      for (let i = 0; i < visible.length; i++) {
        if (visible[i].id === data.draggingId) {
          visible[i] = { ...visible[i], points: data.livePoints };
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

    const pr =
      m?.state === "Drawing" && m.anchors.length > 0 ? m.anchors : null;
    const tool =
      m?.state === "Drawing" ? (m.drawingTool ?? data.activeTool) : null;
    const all =
      pr && tool
        ? [
            ...visible,
            {
              id: "__pending",
              tool,
              color: data.drawColor,
              lineWidth: 1.5,
              points: pr,
              visible: true,
            } as Drawing,
          ]
        : visible;

    const sorted = [...all].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
    for (const d of sorted) {
      if (d.visible === false) continue;
      const selected = d.id === data.selectedDrawingId;
      g.strokeStyle = d.color;
      g.fillStyle = d.color;
      g.lineWidth = (d.lineWidth || 1.5) * (selected ? 1.6 : 1);
      renderDrawing(g, d, projector, selected);
    }
  }

  // ---- rAF loop ----
  function schedule() {
    if (rafId !== null) return;
    rafId = requestAnimationFrame(() => render());
  }

  function markDirty() {
    dirty = true;
    schedule();
  }

  // ---- Chart viewport changes (version bumps) ----
  let unsubVersion: (() => void) | undefined;
  if (onVersionChange) {
    unsubVersion = onVersionChange(() => markDirty());
  }

  // ---- Initial render ----
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
