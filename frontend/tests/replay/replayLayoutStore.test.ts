import assert from "node:assert/strict";
import test from "node:test";
import { createStore } from "jotai/vanilla";
import {
  activeChartSlotAtom,
  chartLayoutPresetAtom,
  chartPanesAtom,
  chartCountForPreset,
  createInitialChartPanes,
  dropSymbolOnChartPaneAtom,
  initializePanesForPreset,
  normalizePersistedChartWorkspaceLayout,
  replayLayoutModeAtom,
  replayTracksForBackend,
  replayTracksForLayout,
  setChartLayoutPresetAtom,
  updatePaneSelection,
  visibleChartSlots,
  type ChartLayoutPreset,
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

test("all-chart backend tracks keep pane slots after unavailable siblings are removed", () => {
  const layouts: ChartLayoutPreset[] = [
    "two_horizontal",
    "two_vertical",
    "grid_2x2",
  ];
  for (const preset of layouts) {
    const tracks = replayTracksForLayout(
      "all_charts",
      preset,
      { symbol: "USDINR", chartTimeframe: "15m", slot: 1 },
      initializePanesForPreset(
        updatePaneSelection(createInitialChartPanes(), 0, {
          symbol: "ADAUSD",
          timeframe: "15m",
        }),
        preset,
        1,
      ),
      1,
    );
    const withoutFirstPane = tracks.filter((track) => track.slot !== 0);
    assert.deepEqual(
      replayTracksForBackend("all_charts", withoutFirstPane).map((track) => track.slot),
      visibleChartSlots(preset).filter((slot) => slot !== 0),
      preset,
    );
  }
});

test("expanding to multi-chart enables synchronized Replay and pane drops are slot-specific", () => {
  const store = createStore();
  store.set(chartPanesAtom, updatePaneSelection(createInitialChartPanes(), 0, {
    symbol: "EURUSD",
    timeframe: "15m",
  }));
  store.set(setChartLayoutPresetAtom, "grid_2x2");
  assert.equal(store.get(chartLayoutPresetAtom), "grid_2x2");
  assert.equal(store.get(replayLayoutModeAtom), "all_charts");

  store.set(dropSymbolOnChartPaneAtom, {
    slot: 2,
    selection: { symbol: "XAUUSD", timeframe: "1H" },
  });
  assert.equal(store.get(activeChartSlotAtom), 2);
  assert.equal(store.get(chartPanesAtom)[0]?.symbol, "EURUSD");
  assert.equal(store.get(chartPanesAtom)[2]?.symbol, "XAUUSD");
  assert.equal(store.get(chartPanesAtom)[2]?.timeframe, "1H");
});

test("persisted workspace restores four panes, Replay scope, active slot, and alert owners", () => {
  const workspace = normalizePersistedChartWorkspaceLayout(
    {
      version: 1,
      chartLayoutPreset: "grid_2x2",
      replayLayoutMode: "all_charts",
      chartPanes: [
        { id: "main", slot: 0, symbol: "EURUSD", timeframe: "15m", initialized: true },
        { id: "chart-2", slot: 1, symbol: "GBPUSD", timeframe: "1H", initialized: true },
        { id: "chart-3", slot: 2, symbol: "USDJPY", timeframe: "5m", initialized: true },
        { id: "chart-4", slot: 3, symbol: "XAUUSD", timeframe: "4H", initialized: true },
      ],
      activeChartSlot: 3,
      alertChartOwners: { "alert-1": "main" },
    },
    { symbol: "EURUSD", timeframe: "15m" },
  );
  assert.equal(workspace?.chartLayoutPreset, "grid_2x2");
  assert.equal(workspace?.chartPanes.length, 4);
  assert.equal(workspace?.chartPanes[3]?.symbol, "XAUUSD");
  assert.equal(workspace?.activeChartSlot, 3);
  assert.equal(workspace?.replayLayoutMode, "all_charts");
  assert.deepEqual(workspace?.alertChartOwners, { "alert-1": "main" });
});

test("drop and restore use the visible slots of every supported layout", () => {
  const layouts: Array<[ChartLayoutPreset, number]> = [
    ["single", 1],
    ["two_horizontal", 2],
    ["two_vertical", 2],
    ["grid_2x2", 4],
  ];
  for (const [preset, count] of layouts) {
    const store = createStore();
    store.set(chartPanesAtom, updatePaneSelection(createInitialChartPanes(), 0, {
      symbol: "EURUSD",
      timeframe: "15m",
    }));
    store.set(setChartLayoutPresetAtom, preset);
    const targetSlot = count - 1;
    store.set(dropSymbolOnChartPaneAtom, {
      slot: targetSlot,
      selection: { symbol: `TARGET${count}`, timeframe: "1H" },
    });
    assert.equal(store.get(activeChartSlotAtom), targetSlot, preset);
    assert.equal(
      store.get(chartPanesAtom)[targetSlot]?.symbol,
      `TARGET${count}`,
      preset,
    );

    const restored = normalizePersistedChartWorkspaceLayout(
      {
        version: 1,
        chartLayoutPreset: preset,
        replayLayoutMode: count > 1 ? "all_charts" : "single_chart",
        chartPanes: store.get(chartPanesAtom),
        activeChartSlot: targetSlot,
        alertChartOwners: {},
      },
      { symbol: "EURUSD", timeframe: "15m" },
    );
    assert.equal(visibleChartSlots(restored!.chartLayoutPreset).length, count);
    assert.equal(restored?.activeChartSlot, targetSlot);
  }
});
