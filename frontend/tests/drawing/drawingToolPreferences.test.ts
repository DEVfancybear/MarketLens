import assert from "node:assert/strict";
import { test } from "node:test";

import type { Drawing } from "../../src/types/drawing";
import {
  decodeDrawingToolPreferences,
  pickDrawingToolDefaults,
  resolveDrawingCreationDefaults,
} from "../../src/components/chart/drawing/settings/drawingToolPreferences";

test("tool defaults retain configurable fields but never object state or geometry", () => {
  const drawing: Drawing = {
    id: "rect-1",
    tool: "rectangle",
    color: "#abcdef",
    lineWidth: 3,
    fillColor: "#123456",
    opacity: 0.4,
    text: "object-specific content",
    visible: false,
    locked: true,
    zIndex: 42,
    points: [{ time: 10, price: 20 }, { time: 30, price: 40 }],
  };

  assert.deepEqual(pickDrawingToolDefaults(drawing), {
    color: "#abcdef",
    lineWidth: 3,
    fillColor: "#123456",
    opacity: 0.4,
  });
});

test("creation defaults layer manifest, current color, and per-tool user settings", () => {
  const defaults = resolveDrawingCreationDefaults(
    "trendline",
    {
      color: "#ff0000",
      lineWidth: 4,
      lineStyle: "dashed",
      points: [{ time: 999, price: 999 }],
      id: "must-not-leak",
    },
    "#2962ff",
  );

  assert.equal(defaults.color, "#ff0000");
  assert.equal(defaults.lineWidth, 4);
  assert.equal(defaults.lineStyle, "dashed");
  assert.equal(defaults.points, undefined);
  assert.equal(defaults.id, undefined);
});

test("preference decoder rejects unknown versions, tools, and unsafe fields", () => {
  assert.deepEqual(decodeDrawingToolPreferences({ version: 99, keepDrawing: true }), {
    version: 1,
    keepDrawing: false,
    toolDefaults: {},
  });

  const decoded = decodeDrawingToolPreferences({
    version: 1,
    keepDrawing: true,
    toolDefaults: {
      trendline: {
        color: "#00ff00",
        lineWidth: 2,
        points: [{ time: 1, price: 2 }],
        visible: false,
      },
      unknownTool: { color: "red" },
    },
  });

  assert.equal(decoded.keepDrawing, true);
  assert.deepEqual(decoded.toolDefaults.trendline, {
    color: "#00ff00",
    lineWidth: 2,
  });
  assert.equal((decoded.toolDefaults as Record<string, unknown>).unknownTool, undefined);
});

test("position input preferences persist without carrying projected price geometry", () => {
  const position: Drawing = {
    id: "long-1",
    tool: "long",
    color: "#089981",
    lineWidth: 1,
    points: [{ time: 1, price: 100 }],
    accountSize: 10_000,
    riskValue: 1,
    riskUnit: "%",
    stop: 99,
    target: 102,
  };

  const defaults = pickDrawingToolDefaults(position);
  assert.equal(defaults.accountSize, 10_000);
  assert.equal(defaults.riskValue, 1);
  assert.equal(defaults.riskUnit, "%");
  assert.equal(defaults.stop, undefined);
  assert.equal(defaults.target, undefined);
  assert.equal(defaults.points, undefined);
});
