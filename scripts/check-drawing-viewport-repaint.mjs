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
  /addEventListener\("wheel", handleWheel/.test(drawingLayer),
  "DrawingLayer must nudge viewport repaint directly from wheel zoom events",
);
assert(
  /unsubscribeVisibleLogicalRangeChange\(handleViewportChange\)/.test(drawingLayer),
  "DrawingLayer must unsubscribe the time-scale viewport listener on teardown",
);
assert(
  /removeEventListener\("wheel", handleWheel, true\)/.test(drawingLayer),
  "DrawingLayer must remove the wheel repaint listener on teardown",
);

console.log(
  "[drawing-viewport] OK: wheel zoom and viewport changes force immediate drawing repaint",
);
