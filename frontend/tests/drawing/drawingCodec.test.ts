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
import {
  MAX_DRAWING_DATA_SUB_BARS,
  MAX_DRAWING_DATA_TICKS,
} from "../../src/components/chart/drawing/data/drawingDataSamples";

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

test("Regression Trend legacy payloads resolve Close, +/-2, all lines, and Pearson defaults", () => {
  const decoded = decodeDrawing({
    ...legacy,
    id: "legacy-regression",
    tool: "regressionTrend",
    dataSnapshot: {
      version: 1,
      symbol: "TEST",
      capturedAt: 1,
      samples: [
        { time: 1, open: 1, high: 3, low: 0, close: 2, volume: 1 },
        { time: 2, open: 2, high: 4, low: 1, close: 3, volume: 1 },
      ],
    },
  });
  assert.ok(decoded.drawing);
  assert.equal(decoded.drawing.regressionUpperDeviation, 2);
  assert.equal(decoded.drawing.regressionLowerDeviation, -2);
  assert.equal(decoded.drawing.regressionSource, "close");
  assert.equal(decoded.drawing.regressionUseUpperDeviation, true);
  assert.equal(decoded.drawing.regressionUseLowerDeviation, true);
  assert.equal(decoded.drawing.regressionShowBaseLine, true);
  assert.equal(decoded.drawing.regressionShowUpperLine, true);
  assert.equal(decoded.drawing.regressionShowLowerLine, true);
  assert.equal(decoded.drawing.regressionExtendLines, false);
  assert.equal(decoded.drawing.regressionShowPearsonR, true);

  const custom = decodeDrawing({
    ...decoded.drawing,
    regressionUpperDeviation: 1.25,
    regressionLowerDeviation: -3,
    regressionSource: "hlcc4",
    regressionUseUpperDeviation: false,
    regressionShowPearsonR: false,
  });
  assert.deepEqual(
    {
      upper: custom.drawing?.regressionUpperDeviation,
      lower: custom.drawing?.regressionLowerDeviation,
      source: custom.drawing?.regressionSource,
      useUpper: custom.drawing?.regressionUseUpperDeviation,
      pearson: custom.drawing?.regressionShowPearsonR,
    },
    { upper: 1.25, lower: -3, source: "hlcc4", useUpper: false, pearson: false },
  );
  assert.deepEqual(
    encodeDrawing(custom.drawing!),
    custom.drawing,
  );
});

test("Wave D snapshots and rich content are bounded and sanitized", () => {
  const samples = Array.from({ length: 1005 }, (_, time) => ({ time, open: 1, high: 3, low: 0, close: 2, volume: time === 0 ? -1 : 4 }));
  const table = decodeDrawing({ ...legacy, tool: "table", dataSnapshot: { version: 1, symbol: " TEST ", capturedAt: 10, samples }, content: { kind: "table", cells: Array.from({ length: 25 }, () => Array.from({ length: 15 }, () => "x".repeat(250))) } }).drawing!;
  assert.equal(table.dataSnapshot?.samples.length, 1000);
  assert.equal(table.dataSnapshot?.symbol, "TEST");
  assert.equal(table.content?.kind, "table");
  if (table.content?.kind === "table") { assert.equal(table.content.cells?.length, 20); assert.equal(table.content.cells?.[0].length, 12); assert.equal(table.content.cells?.[0][0].length, 200); }
  const unsafe = decodeDrawing({ ...legacy, tool: "image", content: { kind: "image", sourceUrl: "javascript:alert(1)", alt: " safe " } }).drawing!;
  assert.deepEqual(unsafe.content, { kind: "image", alt: "safe" });
  const social = decodeDrawing({ ...legacy, tool: "socialEmbed", points: [legacy.points[0]], content: { kind: "social", sourceUrl: "https://evil.example/post" } }).drawing!;
  assert.deepEqual(social.content, { kind: "social" });
});

test("volume-profile snapshot detail is sanitized and bounded newest-first", () => {
  const subBars = Array.from(
    { length: MAX_DRAWING_DATA_SUB_BARS + 2 },
    (_, time) => ({ time, open: 1, high: 2, low: 0, close: 1, volume: time }),
  );
  const ticks: Array<{ price: number; volume: number }> = Array.from(
    { length: MAX_DRAWING_DATA_TICKS + 2 },
    (_, price) => ({ price, volume: price === 0 ? -1 : 1 }),
  );
  ticks.push({ price: Number.NaN, volume: 1 });
  const decoded = decodeDrawing({
    ...legacy,
    tool: "fixedVolumeProfile",
    dataSnapshot: {
      version: 1,
      symbol: " TEST ",
      capturedAt: 1,
      samples: [{
        time: 1,
        open: 1,
        high: 2,
        low: 0,
        close: 1,
        volume: 1,
        subBars,
        ticks,
      }],
    },
  }).drawing!;

  const sample = decoded.dataSnapshot!.samples[0];
  assert.equal(sample.subBars?.length, MAX_DRAWING_DATA_SUB_BARS);
  assert.equal(sample.subBars?.[0].time, 2);
  assert.equal(sample.subBarsComplete, false);
  assert.equal(sample.ticks?.length, MAX_DRAWING_DATA_TICKS);
  assert.equal(sample.ticks?.[0].price, 2);
  assert.equal(sample.ticks?.at(-1)?.price, MAX_DRAWING_DATA_TICKS + 1);
  assert.equal(sample.ticksComplete, false);
});

test("volume-profile settings decode to typed bounded values", () => {
  const decoded = decodeDrawing({
    ...legacy,
    tool: "anchoredVolumeProfile",
    points: [legacy.points[0]],
    volumeProfileRows: 0,
    volumeProfileValueAreaPercent: 250,
    volumeProfileWidthPercent: -1,
    volumeProfilePlacement: "middle",
    volumeProfileVolumeMode: "future",
    volumeProfileShowPointOfControl: false,
  }).drawing!;
  assert.equal(decoded.volumeProfileRows, 1);
  assert.equal(decoded.volumeProfileValueAreaPercent, 100);
  assert.equal(decoded.volumeProfileWidthPercent, 1);
  assert.equal(decoded.volumeProfilePlacement, "right");
  assert.equal(decoded.volumeProfileVolumeMode, "up-down");
  assert.equal(decoded.volumeProfileShowPointOfControl, false);
});

test("pressure-ready freeform points round-trip with normalized pressure", () => {
  const decoded = decodeDrawing({
    ...legacy,
    tool: "brush",
    points: [
      { time: 1, price: 2, pressure: -1 },
      { time: 2, price: 3, pressure: 0.75 },
      { time: 3, price: 4, pressure: 2 },
    ],
  });
  assert.deepEqual(decoded.drawing?.points.map((point) => point.pressure), [0, 0.75, 1]);
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

test("position execution links are sanitized and round-trip through backend payloads", () => {
  const decoded = decodeDrawing({
    ...legacy,
    id: "linked-long",
    tool: "long",
    points: [
      { time: 10, price: 100 },
      { time: 20, price: 110 },
      { time: 20, price: 95 },
    ],
    execution: {
      accountId: " mt5_account ",
      clientCommandId: " exec_place_123 ",
      status: "running",
      brokerOrderId: "501",
      brokerPositionId: "701",
      updatedAt: 200,
      unsafe: "<script>",
    },
  });
  assert.deepEqual(decoded.drawing?.execution, {
    accountId: "mt5_account",
    clientCommandId: "exec_place_123",
    status: "running",
    brokerOrderId: "501",
    brokerPositionId: "701",
    updatedAt: 200,
  });
  assert.deepEqual(
    encodeDrawing(decoded.drawing!).execution,
    decoded.drawing?.execution,
  );
  assert.equal(
    decodeDrawing({
      ...legacy,
      execution: { accountId: "x", clientCommandId: "y", status: "future" },
    }).drawing?.execution,
    undefined,
  );
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
