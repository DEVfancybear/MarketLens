import assert from "node:assert/strict";
import test from "node:test";

import {
  replayAutoIntervalSeconds,
  replayControlMessage,
  replaySessionInputAt,
} from "../../src/store/replayUiState";

test("Replay controls expose kill-switch, auth, loading, and server error states", () => {
  assert.match(replayControlMessage({ enabled: false, authenticated: true, connection: "idle", error: null }) ?? "", /disabled/);
  assert.match(replayControlMessage({ enabled: true, authenticated: false, connection: "idle", error: null }) ?? "", /Sign in/);
  assert.match(replayControlMessage({ enabled: true, authenticated: true, connection: "connecting", error: null }) ?? "", /Preparing/);
  assert.equal(replayControlMessage({ enabled: true, authenticated: true, connection: "error", error: "backend failed" }), "backend failed");
});

test("selection sends the requested UTC time and lets the backend validate it", () => {
  const input = replaySessionInputAt(
    1_700_000_000,
    { symbol: "EURUSD", chartTimeframe: "15m" },
    "single_chart",
    "single",
  );
  assert.equal(input.start.time, new Date(1_700_000_000 * 1000).toISOString());
  assert.deepEqual(input.tracks, [{
    slot: 0,
    symbol: "EURUSD",
    chartTimeframe: "15m",
    required: true,
  }]);
});

test("single-chart replay preserves the owning pane when pane 3 is active", () => {
  const input = replaySessionInputAt(
    1_700_000_000,
    { symbol: "USDJPY", chartTimeframe: "5m" },
    "single_chart",
    "grid_2x2",
    1,
    {
      activeSlot: 2,
      panes: [
        {
          id: "main",
          slot: 0,
          symbol: "EURUSD",
          timeframe: "15m",
          initialized: true,
        },
        {
          id: "chart-2",
          slot: 1,
          symbol: "GBPUSD",
          timeframe: "1H",
          initialized: true,
        },
        {
          id: "chart-3",
          slot: 2,
          symbol: "USDJPY",
          timeframe: "5m",
          initialized: true,
        },
      ],
    },
  );
  assert.deepEqual(input.tracks, [{
    slot: 2,
    symbol: "USDJPY",
    chartTimeframe: "5m",
    required: true,
  }]);
});

test("all-chart replay marks only the active pane as required for every multi layout", () => {
  for (const preset of ["two_horizontal", "two_vertical", "grid_2x2"] as const) {
    const input = replaySessionInputAt(
      1_700_000_000,
      { symbol: "USDINR", chartTimeframe: "15m" },
      "all_charts",
      preset,
      1,
      {
        activeSlot: 1,
        panes: [
          {
            id: "main",
            slot: 0,
            symbol: "ADAUSD",
            timeframe: "15m",
            initialized: true,
          },
          {
            id: "chart-2",
            slot: 1,
            symbol: "USDINR",
            timeframe: "15m",
            initialized: true,
          },
        ],
      },
    );
    assert.deepEqual(
      input.tracks.map(({ slot, required }) => ({ slot, required })),
      Array.from({ length: preset === "grid_2x2" ? 4 : 2 }, (_, slot) => ({
        slot,
        required: slot === 1,
      })),
      preset,
    );
  }
});

test("Replay Auto interval matches TradingView single and synchronized layouts", () => {
  const track = (chartTimeframe: string, baseIntervalSeconds = 60) => ({
    chartTimeframe,
    dataset: { baseIntervalSeconds },
  });
  assert.equal(replayAutoIntervalSeconds([track("15m")]), 900);
  assert.equal(replayAutoIntervalSeconds([track("15m"), track("1H")]), 900);
  assert.equal(replayAutoIntervalSeconds([track("1W", 86400)]), 86400);
  assert.equal(replayAutoIntervalSeconds([track("1M", 86400)]), 86400);
});
