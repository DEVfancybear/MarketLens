import assert from "node:assert/strict";
import { test } from "node:test";
import type { Drawing } from "../../src/types/drawing";
import {
  canGroupDrawingsBySyncMode,
  drawingBelongsToSyncContext,
  drawingSyncBinding,
  drawingSyncMode,
  mergeDrawingSyncRegistry,
  rebindDrawingsToSyncContext,
  resolveDrawingSyncModeSetting,
  selectDrawingsForSyncContext,
} from "../../src/components/chart/drawing/persistence/drawingSyncScope";

const context = { symbol: "EURUSD", layoutId: "layout-a", chartId: "main" };

function drawing(id: string, sync?: Drawing["sync"]): Drawing {
  return {
    id,
    tool: "trendline",
    color: "#2962ff",
    lineWidth: 1,
    points: [{ time: 1, price: 2 }, { time: 2, price: 3 }],
    sync,
  };
}

test("sync bindings retain only metadata required by each scope", () => {
  assert.deepEqual(drawingSyncBinding("global", context), {
    mode: "global",
    symbol: "EURUSD",
  });
  assert.deepEqual(drawingSyncBinding("layout-symbol", context), {
    mode: "layout-symbol",
    symbol: "EURUSD",
    layoutId: "layout-a",
  });
  assert.deepEqual(drawingSyncBinding("chart-only", context), {
    mode: "chart-only",
    symbol: "EURUSD",
    layoutId: "layout-a",
    chartId: "main",
  });
});

test("historical drawings use the safe pane-local default while scoped drawings require matching context", () => {
  assert.equal(drawingSyncMode(drawing("legacy")), "chart-only");
  assert.equal(drawingBelongsToSyncContext(drawing("legacy"), context), true);
  assert.equal(drawingBelongsToSyncContext(drawing("global", drawingSyncBinding("global", context)), { ...context, layoutId: "layout-b" }), true);
  assert.equal(drawingBelongsToSyncContext(drawing("layout", drawingSyncBinding("layout-symbol", context)), { ...context, chartId: "secondary" }), true);
  assert.equal(drawingBelongsToSyncContext(drawing("layout", drawingSyncBinding("layout-symbol", context)), { ...context, layoutId: "layout-b" }), false);
  assert.equal(drawingBelongsToSyncContext(drawing("chart", drawingSyncBinding("chart-only", context)), { ...context, chartId: "secondary" }), false);
});

test("the versioned setting migrates only the former implicit global default", () => {
  assert.deepEqual(resolveDrawingSyncModeSetting("global", undefined), {
    mode: "chart-only",
    needsMigration: true,
  });
  assert.deepEqual(resolveDrawingSyncModeSetting("global", 2), {
    mode: "global",
    needsMigration: false,
  });
  assert.deepEqual(resolveDrawingSyncModeSetting("layout-symbol", 1), {
    mode: "layout-symbol",
    needsMigration: true,
  });
});

test("registry projection and replacement preserve other layout/chart scopes", () => {
  const otherContext = { ...context, layoutId: "layout-b" };
  const registry = [
    drawing("global", drawingSyncBinding("global", context)),
    drawing("active", drawingSyncBinding("chart-only", context)),
    drawing("other", drawingSyncBinding("chart-only", otherContext)),
  ];
  assert.deepEqual(selectDrawingsForSyncContext(registry, context).map((item) => item.id), ["global", "active"]);
  const next = mergeDrawingSyncRegistry(registry, [
    { ...registry[0], name: "updated" },
    drawing("new", drawingSyncBinding("layout-symbol", context)),
  ], context);
  assert.deepEqual(new Set(next.map((item) => item.id)), new Set(["global", "other", "new"]));
  assert.equal(next.find((item) => item.id === "global")?.name, "updated");
});

test("groups accept only drawings with one synchronization mode", () => {
  const globalA = drawing("a", drawingSyncBinding("global", context));
  const globalB = drawing("b", drawingSyncBinding("global", context));
  const local = drawing("local", drawingSyncBinding("chart-only", context));
  assert.equal(canGroupDrawingsBySyncMode([globalA, globalB]), true);
  assert.equal(canGroupDrawingsBySyncMode([globalA, local]), false);
  assert.equal(canGroupDrawingsBySyncMode([globalA]), false);
});

test("saving as a new layout rebinds scoped drawings but preserves global identity", () => {
  const global = drawing("global", drawingSyncBinding("global", context));
  const layout = drawing("layout", drawingSyncBinding("layout-symbol", context));
  const chart = drawing("chart", drawingSyncBinding("chart-only", context));
  const next = rebindDrawingsToSyncContext([global, layout, chart], {
    symbol: "EURUSD",
    layoutId: "layout-copy",
    chartId: "secondary",
  });
  assert.equal(next[0], global);
  assert.deepEqual(next[1].sync, {
    mode: "layout-symbol",
    symbol: "EURUSD",
    layoutId: "layout-copy",
  });
  assert.deepEqual(next[2].sync, {
    mode: "chart-only",
    symbol: "EURUSD",
    layoutId: "layout-copy",
    chartId: "secondary",
  });
});
