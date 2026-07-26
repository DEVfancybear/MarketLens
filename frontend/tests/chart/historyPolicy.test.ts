import assert from "node:assert/strict";
import { test } from "node:test";

import {
  HISTORY_SELECTION_DEBOUNCE_MS,
  historyPageBars,
  initialHistoryBars,
  mt5ActiveHistoryRequest,
  mt5HistoryRefreshMs,
  mt5RefreshBars,
  mt5TailContinuitySeconds,
} from "../../src/services/market-data/historyPolicy";
import { SUPPORTED_TIMEFRAMES } from "../../src/types/marketData";

test("every supported timeframe has a bounded progressive history policy", () => {
  assert.equal(HISTORY_SELECTION_DEBOUNCE_MS > 0, true);
  assert.equal(HISTORY_SELECTION_DEBOUNCE_MS < 200, true);
  for (const timeframe of SUPPORTED_TIMEFRAMES) {
    assert.equal(initialHistoryBars(timeframe) > 0, true);
    assert.equal(initialHistoryBars(timeframe) <= 1_000, true);
    assert.equal(historyPageBars(timeframe) > 0, true);
    assert.equal(historyPageBars(timeframe) <= 1_000, true);
    assert.equal(mt5HistoryRefreshMs(timeframe) >= 3_000, true);
    assert.equal(mt5TailContinuitySeconds(timeframe) > 0, true);
  }
});

test("slow timeframes use small first paint windows and slower refreshes", () => {
  assert.equal(initialHistoryBars("4H"), 400);
  assert.equal(initialHistoryBars("1D"), 300);
  assert.equal(initialHistoryBars("1W"), 100);
  assert.equal(initialHistoryBars("1M"), 60);
  assert.equal(mt5HistoryRefreshMs("4H"), 30_000);
  assert.equal(mt5HistoryRefreshMs("1D"), 60_000);
  assert.equal(mt5HistoryRefreshMs("1W"), 300_000);
});

test("monthly MT5 tail continuity allows every calendar month length", () => {
  assert.equal(mt5TailContinuitySeconds("15m"), 15 * 60);
  assert.equal(mt5TailContinuitySeconds("1M"), 32 * 86400);
});

test("stale MT5 first paints escalate to the same full window for every timeframe", () => {
  for (const timeframe of SUPPORTED_TIMEFRAMES) {
    const expectedTail = timeframe === "1D" || timeframe === "1W" || timeframe === "1M"
      ? 5
      : timeframe === "1H" || timeframe === "2H" || timeframe === "4H"
        ? 10
        : 20;
    assert.equal(mt5RefreshBars(timeframe), expectedTail);
    assert.equal(mt5RefreshBars(timeframe, true), initialHistoryBars(timeframe));
  }
});

test("pending MT5 backfill polls the full cache without cancelling native work", () => {
  assert.deepEqual(mt5ActiveHistoryRequest("1M", true, true), {
    limit: 60,
    refresh: undefined,
  });
  assert.deepEqual(mt5ActiveHistoryRequest("1M", true, false), {
    limit: 60,
    refresh: true,
  });
  assert.deepEqual(mt5ActiveHistoryRequest("15m", false, false), {
    limit: 20,
    refresh: true,
  });
});
