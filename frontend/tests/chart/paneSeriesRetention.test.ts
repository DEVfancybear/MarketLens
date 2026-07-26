import assert from "node:assert/strict";
import test from "node:test";
import { selectPaneLiveSeries } from "../../src/components/chart/paneSeriesRetention";
import type { Candle } from "../../src/types";
import type { ChartPaneState } from "../../src/store/replayLayoutStore";

const pane: ChartPaneState = {
  id: "chart-2",
  slot: 1,
  symbol: "ADAUSD",
  timeframe: "1H",
  initialized: true,
};
const retained: Candle[] = [{
  time: 1_700_000_000,
  open: 0.3,
  high: 0.34,
  low: 0.29,
  close: 0.33,
  volume: 100,
}];
const current: Candle[] = [{
  ...retained[0],
  time: retained[0].time + 3_600,
  close: 0.335,
}];

test("inactive pane keeps its last coherent live frame while keyed history is cold", () => {
  assert.equal(
    selectPaneLiveSeries(pane, [], {
      symbol: "ADAUSD",
      timeframe: "1H",
      candles: retained,
      source: "live",
    }),
    retained,
  );
});

test("authoritative keyed candles replace the retained frame", () => {
  assert.equal(
    selectPaneLiveSeries(pane, current, {
      symbol: "ADAUSD",
      timeframe: "1H",
      candles: retained,
      source: "live",
    }),
    current,
  );
});

test("Replay or another symbol can never leak into the live pane fallback", () => {
  assert.deepEqual(
    selectPaneLiveSeries(pane, [], {
      symbol: "ADAUSD",
      timeframe: "1H",
      candles: retained,
      source: "replay",
    }),
    [],
  );
  assert.deepEqual(
    selectPaneLiveSeries(pane, [], {
      symbol: "BTCUSD",
      timeframe: "1H",
      candles: retained,
      source: "live",
    }),
    [],
  );
});
