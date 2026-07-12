import assert from "node:assert/strict";
import { test } from "node:test";

import type { Drawing } from "../../src/types/drawing";
import {
  CURRENT_DRAWING_SCHEMA_VERSION,
  decodeDrawing,
  decodeDrawingList,
  encodeDrawing,
} from "../../src/components/chart/drawing/persistence/drawingCodec";
import { drawingFixture } from "../../src/components/chart/drawing/testing/toolFixtures";
import {
  DRAWING_TOOLS,
  getDrawingToolManifestEntry,
} from "../../src/types/drawingToolManifest";

const legacy: Drawing = {
  id: "legacy-fib",
  tool: "fib",
  color: "#2962ff",
  lineWidth: 1.5,
  points: [
    { time: 10, price: 100 },
    { time: 20, price: 120 },
  ],
};

test("unversioned historical drawing migrates and round-trips as current schema", () => {
  const decoded = decodeDrawing(legacy);
  assert.ok(decoded.drawing);
  assert.equal(decoded.migrated, true);
  assert.equal(decoded.drawing.schemaVersion, CURRENT_DRAWING_SCHEMA_VERSION);
  assert.deepEqual(decodeDrawing(encodeDrawing(decoded.drawing)).drawing, decoded.drawing);
});

test("encoder strips transient render fields", () => {
  const encoded = encodeDrawing({ ...legacy, _dragging: true });
  assert.equal("_dragging" in encoded, false);
});

test("interval visibility is normalized at persistence boundaries", () => {
  const decoded = decodeDrawing({
    ...legacy,
    intervalVisibility: { timeframes: ["1D", "15m", "15m", "future"] },
  });
  assert.deepEqual(decoded.drawing?.intervalVisibility, {
    timeframes: ["15m", "1D"],
  });
  assert.deepEqual(encodeDrawing(decoded.drawing!).intervalVisibility, {
    timeframes: ["15m", "1D"],
  });
});

test("object names and group metadata are normalized and persisted", () => {
  const decoded = decodeDrawing({
    ...legacy,
    name: "  Breakout line  ",
    group: { id: "  group-1  ", name: "  Setups  " },
  });
  assert.equal(decoded.drawing?.name, "Breakout line");
  assert.deepEqual(decoded.drawing?.group, { id: "group-1", name: "Setups" });
  assert.deepEqual(encodeDrawing(decoded.drawing!).group, { id: "group-1", name: "Setups" });

  const malformed = decodeDrawing({ ...legacy, name: 42, group: { id: "" } });
  assert.equal(malformed.drawing?.name, undefined);
  assert.equal(malformed.drawing?.group, undefined);
});

test("drawing sync scopes are normalized and historical payloads stay global", () => {
  assert.equal(decodeDrawing(legacy).drawing?.sync, undefined);
  const global = decodeDrawing({ ...legacy, sync: { mode: "global", symbol: " EURUSD " } });
  assert.deepEqual(global.drawing?.sync, { mode: "global", symbol: "EURUSD" });
  const layout = decodeDrawing({
    ...legacy,
    sync: { mode: "layout-symbol", symbol: "EURUSD", layoutId: " layout-a " },
  });
  assert.deepEqual(layout.drawing?.sync, {
    mode: "layout-symbol",
    symbol: "EURUSD",
    layoutId: "layout-a",
  });
  const chart = decodeDrawing({
    ...legacy,
    sync: { mode: "chart-only", symbol: "EURUSD", layoutId: "layout-a", chartId: "main" },
  });
  assert.deepEqual(encodeDrawing(chart.drawing!).sync, chart.drawing?.sync);
  assert.equal(decodeDrawing({ ...legacy, sync: { mode: "chart-only", symbol: "EURUSD" } }).drawing?.sync, undefined);
});

test("unknown tools and malformed coordinates are quarantined, not silently loaded", () => {
  const result = decodeDrawingList([
    legacy,
    { ...legacy, id: "future", tool: "future-tool" },
    { ...legacy, id: "bad", points: [{ time: 1, price: Number.NaN }] },
  ]);
  assert.equal(result.drawings.length, 1);
  assert.deepEqual(result.quarantined.map(({ issue }) => issue.code), [
    "unknown-tool",
    "invalid-points",
  ]);
});

test("future schema versions are retained for quarantine", () => {
  const future = { ...legacy, schemaVersion: CURRENT_DRAWING_SCHEMA_VERSION + 1 };
  const decoded = decodeDrawing(future);
  assert.equal(decoded.drawing, null);
  assert.equal(decoded.issue?.code, "unsupported-version");
  assert.equal(decoded.quarantined, future);
});

test("every persistent tool fixture survives versioned encode/decode", () => {
  for (const tool of DRAWING_TOOLS) {
    const definition = getDrawingToolManifestEntry(tool);
    const fixture = drawingFixture(tool, {
      minPoints: definition.minPoints,
      maxPoints: definition.maxPoints,
      freeform: definition.creationMode === "click-freeform",
      continuous: definition.creationMode === "pointer-continuous",
    });
    const encoded = encodeDrawing(fixture);
    const decoded = decodeDrawing(encoded);
    assert.ok(decoded.drawing, tool);
    assert.equal(decoded.drawing.tool, tool);
    assert.deepEqual(decoded.drawing.points, fixture.points);
  }
});
