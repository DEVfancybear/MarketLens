import assert from "node:assert/strict";
import { test } from "node:test";

import type { Drawing } from "../../src/types";
import {
  intervalVisibilityForPreset,
  isDrawingVisibleAtTimeframe,
  matchesDrawingIntervalPreset,
  normalizeDrawingIntervalVisibility,
  toggleDrawingInterval,
} from "../../src/components/chart/drawing/visibility/drawingIntervalVisibility";

const drawing = (intervalVisibility?: Drawing["intervalVisibility"]): Drawing => ({
  id: "visibility",
  tool: "trendline",
  color: "#2962ff",
  lineWidth: 1.5,
  points: [{ time: 1, price: 2 }, { time: 3, price: 4 }],
  intervalVisibility,
});

test("historical drawings remain visible on every interval by default", () => {
  assert.equal(isDrawingVisibleAtTimeframe(drawing(), "1m"), true);
  assert.equal(isDrawingVisibleAtTimeframe(drawing(), "1M"), true);
  assert.equal(isDrawingVisibleAtTimeframe({ ...drawing(), visible: false }, "15m"), false);
});

test("quick presets resolve current, above, below, and all intervals", () => {
  assert.equal(intervalVisibilityForPreset("all", "15m"), undefined);
  assert.deepEqual(intervalVisibilityForPreset("current", "15m"), {
    timeframes: ["15m"],
  });
  assert.deepEqual(intervalVisibilityForPreset("current-and-above", "1H"), {
    timeframes: ["1H", "2H", "4H", "1D", "1W", "1M"],
  });
  assert.deepEqual(intervalVisibilityForPreset("current-and-below", "1H"), {
    timeframes: ["1m", "3m", "5m", "15m", "30m", "1H"],
  });
});

test("manual interval toggles support disjoint selections and collapse all to default", () => {
  let visibility = intervalVisibilityForPreset("current", "15m");
  visibility = toggleDrawingInterval(visibility, "1D");
  assert.deepEqual(visibility, { timeframes: ["15m", "1D"] });
  assert.equal(isDrawingVisibleAtTimeframe(drawing(visibility), "15m"), true);
  assert.equal(isDrawingVisibleAtTimeframe(drawing(visibility), "1H"), false);

  const allButOne = toggleDrawingInterval(undefined, "1m");
  assert.equal(toggleDrawingInterval(allButOne, "1m"), undefined);
});

test("boundary normalization orders, deduplicates, and drops unknown intervals", () => {
  const normalized = normalizeDrawingIntervalVisibility({
    timeframes: ["1D", "15m", "15m", "future"],
  });
  assert.deepEqual(normalized, { timeframes: ["15m", "1D"] });
  assert.equal(matchesDrawingIntervalPreset(normalized, "current", "15m"), false);
  assert.equal(matchesDrawingIntervalPreset({ timeframes: ["15m"] }, "current", "15m"), true);
});
