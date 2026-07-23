import assert from "node:assert/strict";
import test from "node:test";
import {
  chartCountForPreset,
  createInitialChartPanes,
  initializePanesForPreset,
  replayTracksForBackend,
  replayTracksForLayout,
  updatePaneSelection,
  visibleChartSlots,
} from "../../src/store/replayLayoutStore";

test("layout presets expose the TradingView slot order", () => {
  assert.equal(chartCountForPreset("single"), 1);
  assert.deepEqual(visibleChartSlots("two_horizontal"), [0, 1]);
  assert.deepEqual(visibleChartSlots("two_vertical"), [0, 1]);
  assert.deepEqual(visibleChartSlots("grid_2x2"), [0, 1, 2, 3]);
});

test("expanding initializes new panes from active and shrinking preserves hidden panes", () => {
  const seeded = updatePaneSelection(createInitialChartPanes(), 0, {
    symbol: "EURUSD",
    timeframe: "15m",
  });
  const expanded = initializePanesForPreset(seeded, "grid_2x2", 0);
  assert.deepEqual(
    expanded.map(({ symbol, timeframe, initialized }) => ({
      symbol,
      timeframe,
      initialized,
    })),
    Array.from({ length: 4 }, () => ({
      symbol: "EURUSD",
      timeframe: "15m",
      initialized: true,
    })),
  );

  const customized = updatePaneSelection(expanded, 3, {
    symbol: "XAUUSD",
    timeframe: "1H",
  });
  const shrunk = initializePanesForPreset(customized, "single", 0);
  assert.equal(shrunk[3]?.symbol, "XAUUSD");
  assert.equal(shrunk[3]?.timeframe, "1H");
});

test("all-charts replay creates one ordered track per slot with independent markets", () => {
  let panes = initializePanesForPreset(
    updatePaneSelection(createInitialChartPanes(), 0, {
      symbol: "EURUSD",
      timeframe: "15m",
    }),
    "grid_2x2",
    0,
  );
  panes = updatePaneSelection(panes, 1, { symbol: "GBPUSD", timeframe: "1H" });
  const tracks = replayTracksForLayout("all_charts", "grid_2x2", {
    symbol: "EURUSD",
    chartTimeframe: "15m",
  }, panes);
  assert.equal(chartCountForPreset("grid_2x2"), 4);
  assert.deepEqual(tracks.map((track) => track.slot), [0, 1, 2, 3]);
  assert.deepEqual(tracks[1], {
    slot: 1,
    symbol: "GBPUSD",
    chartTimeframe: "1H",
  });
});

test("current-chart replay targets the active chart slot", () => {
  const tracks = replayTracksForLayout("single_chart", "grid_2x2", {
    symbol: "EURUSD",
    chartTimeframe: "15m",
    slot: 2,
  }, [], 2);
  assert.equal(tracks.length, 1);
  assert.equal(tracks[0]?.slot, 2);
  assert.equal(replayTracksForBackend("single_chart", tracks)[0]?.slot, 0);
});
