import assert from "node:assert/strict";
import { test } from "node:test";

import {
  historyPageBars,
  initialHistoryBars,
  mt5HistoryRefreshMs,
} from "../../src/services/market-data/historyPolicy";
import { SUPPORTED_TIMEFRAMES } from "../../src/types/marketData";

test("every supported timeframe has a bounded progressive history policy", () => {
  for (const timeframe of SUPPORTED_TIMEFRAMES) {
    assert.equal(initialHistoryBars(timeframe) > 0, true);
    assert.equal(initialHistoryBars(timeframe) <= 1_000, true);
    assert.equal(historyPageBars(timeframe) > 0, true);
    assert.equal(historyPageBars(timeframe) <= 1_000, true);
    assert.equal(mt5HistoryRefreshMs(timeframe) >= 3_000, true);
  }
});

test("slow timeframes use small first paint windows and slower refreshes", () => {
  assert.equal(initialHistoryBars("4H"), 400);
  assert.equal(initialHistoryBars("1D"), 300);
  assert.equal(initialHistoryBars("1W"), 260);
  assert.equal(initialHistoryBars("1M"), 60);
  assert.equal(mt5HistoryRefreshMs("4H"), 30_000);
  assert.equal(mt5HistoryRefreshMs("1D"), 60_000);
  assert.equal(mt5HistoryRefreshMs("1W"), 300_000);
});
