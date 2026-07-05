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

const VIEWPORT_FOLLOW_MS = 450;

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
    /** Map of drawing ID → live points during drag. */
    livePoints: Map<string, Point[]> | null;
    draggingId: string | null;
    hoveredId: string | null;
  };
  onVersionChange?: (cb: () => void) => () => void;
}

export interface RenderLoop {
  markDirty: (force?: boolean, followViewport?: boolean) => void;
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
  // Forces the next render to bypass the data-only memo guard. Set when the chart
  // viewport changes (pan/zoom/resize) — the drawing data is unchanged but every
  // (time,price)→pixel mapping has shifted, so the canvas MUST be repainted.
  let forceNext = true;
  // LWC can settle wheel zoom/autoscale across multiple frames. A single forced
  // repaint can sample an intermediate mapping and leave drawings visibly
  // detached until another event happens, so viewport changes keep forcing
  // redraws for a short burst.
  let viewportFollowUntil = 0;
  let rafId: number | null = null;
  let lastCanvasW = 0,
    lastCanvasH = 0;
  let lastDrawingsHash = "";
  let lastSelectedId: string | null = null;
  let lastHidden = false;
  let lastMachineState = "";
  let lastMachineAnchorsSig = "";
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
      // Include text/fontSize so text-only updates invalidate the memo.
      if (d.text != null) h += ":text=" + d.text;
      if (d.fontSize != null) h += ":fs=" + d.fontSize;
      // Include style fields so colour / width / line-style / fill / opacity /
      // label / visibility edits (toolbar + settings dialog + templates) repaint
      // immediately instead of waiting for the next pan/zoom.
      h +=
        ":st=" +
        d.color +
        "," +
        (d.lineWidth ?? "") +
        "," +
        (d.lineStyle ?? "") +
        "," +
        (d.fillColor ?? "") +
        "," +
        (d.opacity ?? "") +
        "," +
        (d.showLabels === false ? "0" : "1") +
        "," +
        (d.visible === false ? "0" : "1");
      // Shape/text parity fields (extend, middle line, inner text alignment).
      h +=
        ":x=" +
        (d.extend ?? "") +
        "," +
        (d.showMiddleLine ? "1" : "0") +
        "," +
        (d.middleLineColor ?? "") +
        "," +
        (d.middleLineStyle ?? "") +
        "," +
        (d.bold ? "1" : "0") +
        "," +
        (d.italic ? "1" : "0") +
        "," +
        (d.textColor ?? "") +
        "," +
        (d.textBackground ? "1" : "0") +
        "," +
        (d.textBackgroundColor ?? "") +
        "," +
        (d.textBorder ? "1" : "0") +
        "," +
        (d.textBorderColor ?? "") +
        "," +
        (d.textWrap ? "1" : "0") +
        "," +
        (d.textHAlign ?? "") +
        "," +
        (d.textVAlign ?? "");
      h +=
        ":fib=" +
        (d.fibTrendLine === false ? "0" : "1") +
        "," +
        (d.fibTrendLineColor ?? "") +
        "," +
        (d.fibTrendLineWidth ?? "") +
        "," +
        (d.fibTrendLineStyle ?? "") +
        "," +
        (d.fibLevelsLine === false ? "0" : "1") +
        "," +
        (d.fibLevelLineColor ?? "") +
        "," +
        (d.fibLevelLineWidth ?? "") +
        "," +
        (d.fibLevelLineStyle ?? "") +
        "," +
        (d.fibUseOneColor ? "1" : "0") +
        "," +
        (d.fibBackground === false ? "0" : "1") +
        "," +
        (d.fibReverse ? "1" : "0") +
        "," +
        (d.fibShowPrices === false ? "0" : "1") +
        "," +
        (d.fibShowLevels === false ? "0" : "1") +
        "," +
        (d.fibLevelsFormat ?? "") +
        "," +
        (d.fibLabelsHAlign ?? "") +
        "," +
        (d.fibLabelsVAlign ?? "") +
        "," +
        (d.fibShowText === false ? "0" : "1") +
        "," +
        (d.fibTextHAlign ?? "") +
        "," +
        (d.fibTextVAlign ?? "") +
        "," +
        (d.fibLogScale ? "1" : "0") +
        "," +
        JSON.stringify(d.fibLevels ?? []);
      // Long/Short position labels and price-scale bands depend on account
      // sizing, stats visibility, hit handling, and TP/SL colours. These fields
      // can change without moving any point, so they must be part of the memo
      // signature or the canvas will not repaint until a later viewport event.
      h +=
        ":pos=" +
        (d.targetColor ?? "") +
        "," +
        (d.stopColor ?? "") +
        "," +
        (d.accountSize ?? "") +
        "," +
        (d.accountCurrency ?? "") +
        "," +
        (d.lotSize ?? "") +
        "," +
        (d.riskValue ?? "") +
        "," +
        (d.riskUnit ?? "") +
        "," +
        (d.leverage ?? "") +
        "," +
        (d.qtyPrecision ?? "") +
        "," +
        (d.compactStats ? "1" : "0") +
        "," +
        (d.alwaysShowStats === false ? "0" : "1") +
        "," +
        JSON.stringify(d.positionStats ?? []);
    }
    return h;
  }

  function liveHash(pts: Map<string, Point[]> | null): string {
    if (!pts || pts.size === 0) return "-";
    let h = String(pts.size);
    for (const arr of pts.values()) {
      for (const pt of arr)
        h += "," + pt.time.toFixed(0) + "," + pt.price.toFixed(4);
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
    const cw = Math.round(rect.width * dpr),
      ch = Math.round(rect.height * dpr);
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }

    const m = data.machine;
    const machineState = m?.state ?? "";
    // Signature of the in-progress (rubber-band) anchors. Must include their
    // POSITIONS, not just the count — otherwise the live preview freezes after the
    // first move because the anchor count stops changing while the pointer moves.
    let machineAnchorsSig = "-";
    if (m && m.anchors.length > 0) {
      machineAnchorsSig = String(m.anchors.length);
      for (const a of m.anchors)
        machineAnchorsSig += "," + a.time.toFixed(0) + "," + a.price.toFixed(4);
    }
    const drawHash = drawingsHash(data.drawings);
    const liveH = liveHash(data.livePoints);

    if (
      !forceNext &&
      drawHash === lastDrawingsHash &&
      data.selectedDrawingId === lastSelectedId &&
      data.drawingsHidden === lastHidden &&
      machineState === lastMachineState &&
      machineAnchorsSig === lastMachineAnchorsSig &&
      data.activeTool === lastActiveTool &&
      data.drawColor === lastDrawColor &&
      liveH === lastLiveHash &&
      cw === lastCanvasW &&
      ch === lastCanvasH
    )
      return;

    forceNext = false;
    lastDrawingsHash = drawHash;
    lastSelectedId = data.selectedDrawingId;
    lastHidden = data.drawingsHidden;
    lastMachineState = machineState;
    lastMachineAnchorsSig = machineAnchorsSig;
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
    if (data.livePoints && data.livePoints.size > 0) {
      for (let i = 0; i < storeDrawings.length; i++) {
        const pts = data.livePoints.get(storeDrawings[i].id);
        if (pts)
          storeDrawings[i] = { ...storeDrawings[i], points: pts, _dragging: true };
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
    // Long/Short tools must never be culled — their right edge can sit in
    // whitespace where timeToCoordinate returns null and the bbox collapses.
    for (const d of storeDrawings) {
      if (
        d.visible !== false &&
        (d.tool === "long" || d.tool === "short") &&
        !viewport.some((v) => v.id === d.id)
      ) {
        viewport.push(d);
      }
    }
    const sorted = [...viewport].sort(
      (a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0),
    );

    let drawn = 0;
    const hovered = data.hoveredId
      ? sorted.find((d) => d.id === data.hoveredId && d.visible !== false)
      : null;
    if (hovered && !data.drawingsHidden) {
      g.save();
      g.globalAlpha = 0.3;
      g.strokeStyle = hovered.color;
      g.fillStyle = hovered.color;
      g.lineWidth = (hovered.lineWidth || 1.5) * 2.5;
      renderDrawing(g, hovered, projector, false);
      g.restore();
    }
    for (const d of sorted) {
      if (d.visible === false) continue;
      const selected = d.id === data.selectedDrawingId;
      g.strokeStyle = d.color;
      g.fillStyle = d.color;
      g.lineWidth = (d.lineWidth || 1.5) * (selected ? 1.6 : 1);
      renderDrawing(g, d, projector, selected);
      drawn++;
    }

    const renderMs = performance.now() - t0;
    perf.recordFrame(renderMs, 0, drawn, all.length - drawn, all.length);

    if (viewportFollowUntil > performance.now()) {
      forceNext = true;
      dirty = true;
      schedule();
    }
  }

  function schedule() {
    if (rafId !== null) return;
    rafId = requestAnimationFrame(() => render());
  }
  function markDirty(force = false, followViewport = false) {
    if (force) forceNext = true;
    if (followViewport) {
      viewportFollowUntil = Math.max(
        viewportFollowUntil,
        performance.now() + VIEWPORT_FOLLOW_MS,
      );
    }
    dirty = true;
    schedule();
  }
  let unsubVersion: (() => void) | undefined;
  // Viewport changes (pan/zoom/resize) keep the drawing data identical but shift
  // every pixel mapping, so force a repaint that bypasses the data-only guard.
  if (onVersionChange) {
    unsubVersion = onVersionChange(() => markDirty(true, true));
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
