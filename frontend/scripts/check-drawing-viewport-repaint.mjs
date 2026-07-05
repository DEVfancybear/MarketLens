#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const renderer = readFileSync(
  resolve(root, "src/components/chart/drawing/renderer/CanvasRenderer.ts"),
  "utf8",
);
const drawingLayer = readFileSync(
  resolve(root, "src/components/chart/DrawingLayer.tsx"),
  "utf8",
);
const priceChart = readFileSync(
  resolve(root, "src/components/chart/PriceChart.tsx"),
  "utf8",
);
const viewportEvents = readFileSync(
  resolve(root, "src/components/chart/chartViewportEvents.ts"),
  "utf8",
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  /const VIEWPORT_FOLLOW_MS = \d+;/.test(renderer),
  "CanvasRenderer must keep a short forced repaint window after viewport changes",
);
assert(
  /viewportFollowUntil/.test(renderer) &&
    /markDirty\(true, true\)/.test(renderer),
  "Viewport change repaint must opt into the follow-window path",
);
assert(
  /forceNext = true;\s+dirty = true;\s+schedule\(\);/s.test(renderer),
  "Viewport follow-window frames must bypass the memo guard and schedule another rAF",
);
assert(
  /subscribeChartViewportEvents\(c, cb\)/.test(drawingLayer),
  "DrawingLayer must use the shared chart viewport-event contract",
);
assert(
  /subscribeChartViewportEvents\(chart, bump\)/.test(priceChart),
  "PriceChart must use the shared viewport-event contract for ChartContext.version",
);
assert(
  /subscribeVisibleLogicalRangeChange/.test(viewportEvents) &&
    /unsubscribeVisibleLogicalRangeChange/.test(viewportEvents) &&
    /subscribeSizeChange/.test(viewportEvents) &&
    /unsubscribeSizeChange/.test(viewportEvents),
  "Viewport events helper must subscribe and unsubscribe logical-range and size changes",
);
assert(
  /"wheel"/.test(viewportEvents) &&
    /"dblclick"/.test(viewportEvents) &&
    /"touchmove"/.test(viewportEvents) &&
    /"pointermove"/.test(viewportEvents) &&
    /pointer\.buttons !== 0/.test(viewportEvents),
  "Viewport events helper must cover wheel, double-click reset, touch/pinch, and active pointer scale/pan",
);

console.log(
  "[drawing-viewport] OK: wheel zoom and viewport changes force immediate drawing repaint",
);
