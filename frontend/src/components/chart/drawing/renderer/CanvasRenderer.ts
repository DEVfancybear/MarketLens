/**
 * DrawingRendererLoop — rAF-based render loop for drawing overlays.
 */
import type { Drawing } from "@/types";
import { renderDrawing, type Projector } from "../drawingRenderer";
import type { Point } from "@/types";
import type { RefObject } from "react";
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
// Two 1080p layers at DPR 2 fit just under this budget (~64 MiB RGBA). Larger
// viewports cache only the more valuable side of the active drawing, or fall
// back to direct painting when even one layer would be too expensive.
const MAX_STATIC_CACHE_PIXELS = 16 * 1024 * 1024;

export interface StaticScenePartition {
  firstDynamicIndex: number;
  lastDynamicIndex: number;
}

/**
 * Keep all dynamic drawings in one ordered window. The static prefix/suffix
 * can then be cached independently without moving a dragged drawing above or
 * below neighbours with a different z-index.
 */
export function partitionStaticScene(
  drawings: readonly Pick<Drawing, "id">[],
  dynamicIds: ReadonlySet<string>,
): StaticScenePartition {
  let firstDynamicIndex = drawings.length;
  let lastDynamicIndex = drawings.length - 1;
  for (let i = 0; i < drawings.length; i++) {
    if (!dynamicIds.has(drawings[i].id)) continue;
    if (firstDynamicIndex === drawings.length) firstDynamicIndex = i;
    lastDynamicIndex = i;
  }
  return { firstDynamicIndex, lastDynamicIndex };
}

interface StaticSceneCache {
  drawingsHash: string;
  drawingsHidden: boolean;
  selectedDrawingId: string | null;
  selectedDrawingIdsHash: string;
  canvasW: number;
  canvasH: number;
  cssWidth: number;
  cssHeight: number;
  dpr: number;
  barIntervalSeconds: Projector["barIntervalSeconds"];
  marketContext: Projector["market"];
  firstDynamicIndex: number;
  lastDynamicIndex: number;
  prefixDrawings: Drawing[];
  suffixDrawings: Drawing[];
  prefixSelection: boolean[];
  suffixSelection: boolean[];
  prefixCanvas: HTMLCanvasElement | null;
  suffixCanvas: HTMLCanvasElement | null;
}

interface StaticSceneCacheInput {
  drawingsHash: string;
  drawingsHidden: boolean;
  selectedDrawingId: string | null;
  selectedDrawingIds: Set<string> | undefined;
  selectedDrawingIdsHash: string;
  canvasW: number;
  canvasH: number;
  cssWidth: number;
  cssHeight: number;
  dpr: number;
  barIntervalSeconds: Projector["barIntervalSeconds"];
  marketContext: Projector["market"];
  partition: StaticScenePartition;
  sorted: Drawing[];
  sourceCanvas: HTMLCanvasElement;
  projector: Projector;
}

function isSelected(
  drawing: Drawing,
  selectedDrawingId: string | null,
  selectedDrawingIds: Set<string> | undefined,
): boolean {
  return (
    drawing.id === selectedDrawingId ||
    selectedDrawingIds?.has(drawing.id) === true
  );
}

function paintDrawing(
  g: CanvasRenderingContext2D,
  drawing: Drawing,
  projector: Projector,
  selected: boolean,
): void {
  g.strokeStyle = drawing.color;
  g.fillStyle = drawing.color;
  g.lineWidth = (drawing.lineWidth || 1.5) * (selected ? 1.6 : 1);
  renderDrawing(g, drawing, projector, selected);
}

function paintDrawingRange(
  g: CanvasRenderingContext2D,
  drawings: readonly Drawing[],
  start: number,
  end: number,
  projector: Projector,
  selectedDrawingId: string | null,
  selectedDrawingIds: Set<string> | undefined,
): void {
  for (let i = start; i < end; i++) {
    const drawing = drawings[i];
    if (drawing.visible === false) continue;
    paintDrawing(
      g,
      drawing,
      projector,
      isSelected(drawing, selectedDrawingId, selectedDrawingIds),
    );
  }
}

function createStaticLayer(
  sourceCanvas: HTMLCanvasElement,
  canvasW: number,
  canvasH: number,
  dpr: number,
  drawings: readonly Drawing[],
  projector: Projector,
  selectedDrawingId: string | null,
  selectedDrawingIds: Set<string> | undefined,
): HTMLCanvasElement | null {
  try {
    const layer = sourceCanvas.ownerDocument.createElement("canvas");
    layer.width = canvasW;
    layer.height = canvasH;
    const context = layer.getContext("2d");
    if (!context) {
      layer.width = 0;
      layer.height = 0;
      return null;
    }
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    paintDrawingRange(
      context,
      drawings,
      0,
      drawings.length,
      projector,
      selectedDrawingId,
      selectedDrawingIds,
    );
    return layer;
  } catch {
    // Canvas allocation can fail on very large surfaces or constrained GPUs.
    // Direct rendering remains the correctness-preserving fallback.
    return null;
  }
}

function buildStaticSceneCache(input: StaticSceneCacheInput): StaticSceneCache {
  const { firstDynamicIndex, lastDynamicIndex } = input.partition;
  const prefixDrawings = input.sorted.slice(0, firstDynamicIndex);
  const suffixDrawings = input.sorted.slice(lastDynamicIndex + 1);
  const prefixSelection = prefixDrawings.map((drawing) =>
    isSelected(
      drawing,
      input.selectedDrawingId,
      input.selectedDrawingIds,
    ),
  );
  const suffixSelection = suffixDrawings.map((drawing) =>
    isSelected(
      drawing,
      input.selectedDrawingId,
      input.selectedDrawingIds,
    ),
  );
  const layerPixels = input.canvasW * input.canvasH;
  let cachePrefix = prefixDrawings.length > 0;
  let cacheSuffix = suffixDrawings.length > 0;

  if (layerPixels <= 0 || layerPixels > MAX_STATIC_CACHE_PIXELS) {
    cachePrefix = false;
    cacheSuffix = false;
  } else if (
    Number(cachePrefix) * layerPixels +
      Number(cacheSuffix) * layerPixels >
    MAX_STATIC_CACHE_PIXELS
  ) {
    // Keep one full-size layer and directly paint the smaller static side.
    cachePrefix = prefixDrawings.length >= suffixDrawings.length;
    cacheSuffix = !cachePrefix;
  }

  return {
    drawingsHash: input.drawingsHash,
    drawingsHidden: input.drawingsHidden,
    selectedDrawingId: input.selectedDrawingId,
    selectedDrawingIdsHash: input.selectedDrawingIdsHash,
    canvasW: input.canvasW,
    canvasH: input.canvasH,
    cssWidth: input.cssWidth,
    cssHeight: input.cssHeight,
    dpr: input.dpr,
    barIntervalSeconds: input.barIntervalSeconds,
    marketContext: input.marketContext,
    firstDynamicIndex,
    lastDynamicIndex,
    prefixDrawings,
    suffixDrawings,
    prefixSelection,
    suffixSelection,
    prefixCanvas: cachePrefix
      ? createStaticLayer(
          input.sourceCanvas,
          input.canvasW,
          input.canvasH,
          input.dpr,
          prefixDrawings,
          input.projector,
          input.selectedDrawingId,
          input.selectedDrawingIds,
        )
      : null,
    suffixCanvas: cacheSuffix
      ? createStaticLayer(
          input.sourceCanvas,
          input.canvasW,
          input.canvasH,
          input.dpr,
          suffixDrawings,
          input.projector,
          input.selectedDrawingId,
          input.selectedDrawingIds,
        )
      : null,
  };
}

function sameDrawingRefs(
  cached: readonly Drawing[],
  drawings: readonly Drawing[],
  start: number,
): boolean {
  if (start < 0 || cached.length > drawings.length - start) return false;
  for (let i = 0; i < cached.length; i++) {
    if (cached[i] !== drawings[start + i]) return false;
  }
  return true;
}

function sameSelectionFlags(
  cached: readonly boolean[],
  drawings: readonly Drawing[],
  start: number,
  selectedDrawingId: string | null,
  selectedDrawingIds: Set<string> | undefined,
): boolean {
  if (start < 0 || cached.length > drawings.length - start) return false;
  for (let i = 0; i < cached.length; i++) {
    if (
      cached[i] !==
      isSelected(drawings[start + i], selectedDrawingId, selectedDrawingIds)
    ) {
      return false;
    }
  }
  return true;
}

function canReuseStaticSceneCache(
  cache: StaticSceneCache,
  input: StaticSceneCacheInput,
): boolean {
  const { firstDynamicIndex, lastDynamicIndex } = input.partition;
  return (
    cache.drawingsHash === input.drawingsHash &&
    cache.drawingsHidden === input.drawingsHidden &&
    cache.selectedDrawingId === input.selectedDrawingId &&
    cache.selectedDrawingIdsHash === input.selectedDrawingIdsHash &&
    cache.canvasW === input.canvasW &&
    cache.canvasH === input.canvasH &&
    cache.cssWidth === input.cssWidth &&
    cache.cssHeight === input.cssHeight &&
    cache.dpr === input.dpr &&
    cache.barIntervalSeconds === input.barIntervalSeconds &&
    cache.marketContext === input.marketContext &&
    cache.firstDynamicIndex === firstDynamicIndex &&
    cache.lastDynamicIndex === lastDynamicIndex &&
    cache.prefixDrawings.length === firstDynamicIndex &&
    cache.suffixDrawings.length ===
      input.sorted.length - (lastDynamicIndex + 1) &&
    sameDrawingRefs(cache.prefixDrawings, input.sorted, 0) &&
    sameSelectionFlags(
      cache.prefixSelection,
      input.sorted,
      0,
      input.selectedDrawingId,
      input.selectedDrawingIds,
    ) &&
    sameDrawingRefs(
      cache.suffixDrawings,
      input.sorted,
      lastDynamicIndex + 1,
    ) &&
    sameSelectionFlags(
      cache.suffixSelection,
      input.sorted,
      lastDynamicIndex + 1,
      input.selectedDrawingId,
      input.selectedDrawingIds,
    )
  );
}

function compositeStaticLayer(
  target: CanvasRenderingContext2D,
  layer: HTMLCanvasElement,
): void {
  target.save();
  // Both canvases already contain DPR-scaled pixels. Copy in device space to
  // avoid a second scale/filter pass while retaining the target's CSS transform.
  target.setTransform(1, 0, 0, 1, 0, 0);
  target.drawImage(layer, 0, 0);
  target.restore();
}

function disposeStaticSceneCache(cache: StaticSceneCache | null): void {
  if (!cache) return;
  if (cache.prefixCanvas) {
    cache.prefixCanvas.width = 0;
    cache.prefixCanvas.height = 0;
  }
  if (cache.suffixCanvas) {
    cache.suffixCanvas.width = 0;
    cache.suffixCanvas.height = 0;
  }
}

type RenderMachine = {
  state: string;
  anchors: Point[];
  drawingTool: Drawing["tool"] | null;
};

export interface RenderLoopDeps {
  canvasRef: RefObject<HTMLCanvasElement | null>;
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
  let staticSceneCache: StaticSceneCache | null = null;

  function drawingsHash(ds: Drawing[]): string {
    if (ds === lastDrawingsRef) return lastDrawingsHash;
    let h = String(ds.length);
    for (let i = 0; i < ds.length; i++) {
      const d = ds[i];
      // Every store mutation advances clientRevision. Keep zIndex explicit as
      // well so ordering-only changes cannot be swallowed by the render memo.
      h +=
        "|" +
        d.id +
        ":r=" +
        (d.clientRevision ?? 0) +
        ":z=" +
        (d.zIndex ?? 0) +
        ":" +
        d.points.length;
      for (let j = 0; j < d.points.length; j++) {
        h +=
          "," +
          d.points[j].time.toFixed(0) +
          "," +
          d.points[j].price.toFixed(4) +
          "," +
          (Number.isFinite(d.points[j].pressure)
            ? Number(d.points[j].pressure).toFixed(3)
            : "-");
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
        (d.showPriceLabels == null ? "u" : d.showPriceLabels ? "1" : "0") +
        (d.showTimeLabel === false ? "0" : "1") +
        "," +
        (d.showStats ? "1" : "0") +
        "," +
        JSON.stringify(d.lineStats ?? []) +
        "," +
        (d.lineStatsPosition ?? "") +
        "," +
        (d.alwaysShowLineStats ? "1" : "0") +
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
      h +=
        ":reg=" +
        [
          d.regressionUpperDeviation,
          d.regressionLowerDeviation,
          d.regressionUseUpperDeviation,
          d.regressionUseLowerDeviation,
          d.regressionSource,
          d.regressionShowBaseLine,
          d.regressionShowUpperLine,
          d.regressionShowLowerLine,
          d.regressionExtendLines,
          d.regressionShowPearsonR,
        ].join(",") +
        ":vp=" +
        [
          d.volumeProfileRows,
          d.volumeProfileValueAreaPercent,
          d.volumeProfileWidthPercent,
          d.volumeProfilePlacement,
          d.volumeProfileVolumeMode,
          d.volumeProfileShowHistogram,
          d.volumeProfileShowPointOfControl,
          d.volumeProfileShowValueAreaHigh,
          d.volumeProfileShowValueAreaLow,
        ].join(",") +
        ":gann=" +
        JSON.stringify(d.gann ?? null);
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
        h +=
          "," +
          pt.time.toFixed(0) +
          "," +
          pt.price.toFixed(4) +
          "," +
          (Number.isFinite(pt.pressure) ? Number(pt.pressure).toFixed(3) : "-");
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

    const forcedRender = forceNext;
    if (
      !forcedRender &&
      lastMemoState &&
      sameRenderMemoState(memoState, lastMemoState)
    )
      return;

    forceNext = false;
    if (forcedRender) {
      disposeStaticSceneCache(staticSceneCache);
      staticSceneCache = null;
    }
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
    const pendingDrawing =
      pr && tool && pr.length >= (getTool(tool)?.minPoints ?? 2)
        ? ({
            id: "__pending",
            tool,
            color: data.drawColor,
            lineWidth: 1.5,
            points: pr,
            visible: true,
          } as Drawing)
        : null;
    const all = pendingDrawing
      ? [...storeDrawings, pendingDrawing]
      : storeDrawings;

    const liveOverrides = new Map<string, Drawing>();
    if (data.livePoints && data.livePoints.size > 0) {
      for (const drawing of storeDrawings) {
        if (data.livePoints.has(drawing.id)) {
          liveOverrides.set(drawing.id, drawing);
        }
      }
    }
    // Pending creation geometry is transient just like drag geometry. Keep the
    // committed scene index stable and inject the one preview object at query
    // time instead of rebuilding every tool's bounds on every pointer sample.
    if (pendingDrawing) liveOverrides.set(pendingDrawing.id, pendingDrawing);
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
      // Index only committed drawings. Transient overrides are added by
      // queryViewportWithOverrides above, so their changing geometry cannot
      // invalidate the static scene index.
      spatialIndex.rebuild(storeDrawings, toX, toY);
      viewport = liveOverrides.size > 0
        ? spatialIndex.queryViewportWithOverrides(
            0,
            0,
            rect.width,
            rect.height,
            liveOverrides,
          )
        : spatialIndex.queryViewport(0, 0, rect.width, rect.height);
      spatialDrawingsRef = data.drawings;
      spatialCanvasW = cw;
      spatialCanvasH = ch;
      spatialHidden = data.drawingsHidden;
      spatialInvalidated = false;
    }
    // Projected tools can opt out when future-space coordinates collapse their
    // spatial bounds because the current time scale cannot represent them.
    const viewportIds = new Set(viewport.map((drawing) => drawing.id));
    for (const d of storeDrawings) {
      if (
        d.visible !== false &&
        getDrawingToolManifestEntry(d.tool).viewportCulling === "always-render" &&
        !viewportIds.has(d.id)
      ) {
        viewport.push(d);
        viewportIds.add(d.id);
      }
    }
    const sorted = [...viewport].sort(
      (a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0),
    );

    const dynamicIds = new Set<string>();
    if (data.draggingId) dynamicIds.add(data.draggingId);
    if (data.livePoints) {
      for (const id of data.livePoints.keys()) dynamicIds.add(id);
    }
    if (pendingDrawing) dynamicIds.add(pendingDrawing.id);
    const partition = partitionStaticScene(sorted, dynamicIds);
    const interactionActive =
      data.draggingId !== null ||
      (data.livePoints?.size ?? 0) > 0 ||
      (m?.state === "Drawing" && m.anchors.length > 0);
    const viewportIsFollowing = viewportFollowUntil > performance.now();
    let frameCache: StaticSceneCache | null = null;
    if (interactionActive && !viewportIsFollowing) {
      const cacheInput: StaticSceneCacheInput = {
        drawingsHash: drawHash,
        drawingsHidden: data.drawingsHidden,
        selectedDrawingId: data.selectedDrawingId,
        selectedDrawingIds: data.selectedDrawingIds,
        selectedDrawingIdsHash: selectedHash,
        canvasW: cw,
        canvasH: ch,
        cssWidth: rect.width,
        cssHeight: rect.height,
        dpr,
        // Keep the raw projector value in the cache key. The render memo uses
        // a 60-second fallback for cheap equality, but adapters may distinguish
        // an explicit interval from an omitted one during an active drag.
        barIntervalSeconds: data.barIntervalSeconds,
        marketContext: data.marketContext,
        partition,
        sorted,
        sourceCanvas: canvas,
        projector,
      };
      if (
        !staticSceneCache ||
        !canReuseStaticSceneCache(staticSceneCache, cacheInput)
      ) {
        disposeStaticSceneCache(staticSceneCache);
        staticSceneCache = buildStaticSceneCache(cacheInput);
      }
      frameCache = staticSceneCache;
    } else {
      disposeStaticSceneCache(staticSceneCache);
      staticSceneCache = null;
    }

    let drawn = 0;
    for (const drawing of sorted) {
      if (drawing.visible !== false) drawn++;
    }
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
    if (frameCache) {
      const middleStart = frameCache.firstDynamicIndex;
      const middleEnd = frameCache.lastDynamicIndex + 1;
      if (frameCache.prefixCanvas) {
        compositeStaticLayer(g, frameCache.prefixCanvas);
      } else {
        paintDrawingRange(
          g,
          sorted,
          0,
          middleStart,
          projector,
          data.selectedDrawingId,
          data.selectedDrawingIds,
        );
      }
      paintDrawingRange(
        g,
        sorted,
        middleStart,
        middleEnd,
        projector,
        data.selectedDrawingId,
        data.selectedDrawingIds,
      );
      if (frameCache.suffixCanvas) {
        compositeStaticLayer(g, frameCache.suffixCanvas);
      } else {
        paintDrawingRange(
          g,
          sorted,
          middleEnd,
          sorted.length,
          projector,
          data.selectedDrawingId,
          data.selectedDrawingIds,
        );
      }
    } else {
      paintDrawingRange(
        g,
        sorted,
        0,
        sorted.length,
        projector,
        data.selectedDrawingId,
        data.selectedDrawingIds,
      );
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
      disposeStaticSceneCache(staticSceneCache);
      staticSceneCache = null;
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    },
  };
}
