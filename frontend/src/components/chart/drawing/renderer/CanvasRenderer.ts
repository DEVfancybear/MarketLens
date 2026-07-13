/**
 * DrawingRendererLoop — rAF-based render loop for drawing overlays.
 */
import type { Drawing } from "@/types";
import { renderDrawing, type Projector } from "../drawingRenderer";
import type { Point } from "@/types";
import { getTool } from "../tools/ToolRegistry";
import { CoordinateCache } from "./CoordinateCache";
import { SpatialIndex } from "./SpatialIndex";
import { PerformanceMonitor } from "./PerformanceMonitor";
import {
  sameRenderMemoState,
  selectedIdsHash,
  type RenderMemoState,
} from "./renderMemo";
import { getDrawingToolManifestEntry } from "../../../../types/drawingToolManifest";

const VIEWPORT_FOLLOW_MS = 450;

type RenderMachine = {
  state: string;
  anchors: Point[];
  drawingTool: Drawing["tool"] | null;
};

export interface RenderLoopDeps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  toX: (time: number) => number | null;
  toY: (price: number) => number | null;
  getData: () => {
    drawings: Drawing[];
    drawingsHidden: boolean;
    selectedDrawingId: string | null;
    selectedDrawingIds?: Set<string>;
    drawColor: string;
    activeTool: Drawing["tool"];
    machine: RenderMachine | null;
    chartReady: boolean;
    /** Map of drawing ID → live points during drag. */
    livePoints: Map<string, Point[]> | null;
    draggingId: string | null;
    hoveredId: string | null;
    barIntervalSeconds?: number;
    marketContext?: Projector["market"];
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
  let lastMemoState: RenderMemoState | null = null;
  let lastDrawingsRef: Drawing[] | null = null;
  let lastDrawingsHash = "";
  let lastSelectedIdsRef: Set<string> | undefined;
  let lastSelectedIdsHash = "-";
  let spatialDrawingsRef: Drawing[] | null = null;
  let spatialCanvasW = -1;
  let spatialCanvasH = -1;
  let spatialHidden = false;
  let spatialInvalidated = true;

  function drawingsHash(ds: Drawing[]): string {
    if (ds === lastDrawingsRef) return lastDrawingsHash;
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
        ":parity=" +
        (d.lineStart ?? "") +
        "," +
        (d.lineEnd ?? "") +
        "," +
        (d.showMidpoint === false ? "0" : "1") +
        "," +
        (d.showPriceLabels ? "1" : "0") +
        "," +
        (d.showStats ? "1" : "0") +
        "," +
        (d.channelBackground === false ? "0" : "1") +
        "," +
        JSON.stringify(d.channelLevels ?? []);
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
    lastDrawingsRef = ds;
    lastDrawingsHash = h;
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
    let selectedHash = lastSelectedIdsHash;
    if (data.selectedDrawingIds !== lastSelectedIdsRef) {
      selectedHash = selectedIdsHash(data.selectedDrawingIds);
      lastSelectedIdsRef = data.selectedDrawingIds;
      lastSelectedIdsHash = selectedHash;
    }
    const memoState: RenderMemoState = {
      drawingsHash: drawHash,
      selectedDrawingId: data.selectedDrawingId,
      selectedDrawingIdsHash: selectedHash,
      drawingsHidden: data.drawingsHidden,
      machineState,
      machineAnchorsSig,
      activeTool: data.activeTool,
      drawColor: data.drawColor,
      liveHash: liveH,
      hoveredId: data.hoveredId,
      canvasW: cw,
      canvasH: ch,
      barIntervalSeconds: data.barIntervalSeconds ?? 60,
      marketContext: data.marketContext,
    };

    if (
      !forceNext &&
      lastMemoState &&
      sameRenderMemoState(memoState, lastMemoState)
    )
      return;

    forceNext = false;
    lastMemoState = memoState;
    const g = canvas.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, rect.width, rect.height);

    let storeDrawings: Drawing[] = data.drawingsHidden ? [] : data.drawings;
    if (data.livePoints && data.livePoints.size > 0) {
      let copied = false;
      for (let i = 0; i < storeDrawings.length; i++) {
        const pts = data.livePoints.get(storeDrawings[i].id);
        if (pts) {
          if (!copied) {
            storeDrawings = [...storeDrawings];
            copied = true;
          }
          storeDrawings[i] = { ...storeDrawings[i], points: pts, _dragging: true };
        }
      }
    }

    const projector: Projector = {
      toX,
      toY,
      width: rect.width,
      height: rect.height,
      barIntervalSeconds: data.barIntervalSeconds,
      market: data.marketContext,
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

    const liveOverrides = new Map<string, Drawing>();
    if (data.livePoints && data.livePoints.size > 0) {
      for (const drawing of storeDrawings) {
        if (data.livePoints.has(drawing.id)) {
          liveOverrides.set(drawing.id, drawing);
        }
      }
    }
    const canReuseSpatialIndex =
      liveOverrides.size > 0 &&
      !spatialInvalidated &&
      spatialDrawingsRef === data.drawings &&
      spatialCanvasW === cw &&
      spatialCanvasH === ch &&
      spatialHidden === data.drawingsHidden;
    let viewport: Drawing[];
    if (canReuseSpatialIndex) {
      viewport = spatialIndex.queryViewportWithOverrides(
        0,
        0,
        rect.width,
        rect.height,
        liveOverrides,
      );
    } else {
      spatialIndex.rebuild(all, toX, toY);
      viewport = spatialIndex.queryViewport(0, 0, rect.width, rect.height);
      spatialDrawingsRef = pr ? null : data.drawings;
      spatialCanvasW = cw;
      spatialCanvasH = ch;
      spatialHidden = data.drawingsHidden;
      spatialInvalidated = false;
    }
    // Projected tools can opt out when future-space coordinates collapse their
    // spatial bounds because the current time scale cannot represent them.
    for (const d of storeDrawings) {
      if (
        d.visible !== false &&
        getDrawingToolManifestEntry(d.tool).viewportCulling === "always-render" &&
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
      const selected =
        d.id === data.selectedDrawingId ||
        data.selectedDrawingIds?.has(d.id) === true;
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
    if (force) {
      forceNext = true;
      spatialInvalidated = true;
    }
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
