import assert from "node:assert/strict";
import test from "node:test";
import {
  chartCountForPreset,
  replayTracksForLayout,
} from "../../src/store/replayLayoutStore";

test("all-charts replay creates one ordered track per layout slot", () => {
  const tracks = replayTracksForLayout("all_charts", "grid_2x2", {
    symbol: "EURUSD",
    chartTimeframe: "15m",
  });
  assert.equal(chartCountForPreset("grid_2x2"), 4);
  assert.deepEqual(tracks.map((track) => track.slot), [0, 1, 2, 3]);
});

test("current-chart replay always creates only slot zero", () => {
  const tracks = replayTracksForLayout("single_chart", "grid_2x2", {
    symbol: "EURUSD",
    chartTimeframe: "15m",
  });
  assert.equal(tracks.length, 1);
  assert.equal(tracks[0]?.slot, 0);
});
