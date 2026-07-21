import assert from "node:assert/strict";
import test from "node:test";

import {
  isAuthoritativeMt5HistorySnapshot,
  mt5HistoryFreshnessError,
} from "../../src/services/market-data/mt5HistoryFreshness";
import { SUPPORTED_TIMEFRAMES } from "../../src/types/marketData";

test("freshness metadata is classified consistently for every timeframe", () => {
  for (const timeframe of SUPPORTED_TIMEFRAMES) {
    assert.equal(
      isAuthoritativeMt5HistorySnapshot({
        freshnessKnown: true,
        lastBarTime: 2_000,
        minimumFreshBarTime: 2_000,
      }),
      true,
      `${timeframe} fresh response`,
    );
    assert.equal(
      isAuthoritativeMt5HistorySnapshot({
        freshnessKnown: true,
        lastBarTime: 1_999,
        minimumFreshBarTime: 2_000,
      }),
      false,
      `${timeframe} stale timestamp evidence`,
    );
  }
});

test("explicit stale, pending, exhausted and errored responses are non-authoritative", () => {
  assert.equal(isAuthoritativeMt5HistorySnapshot({ stale: true }), false);
  assert.equal(isAuthoritativeMt5HistorySnapshot({ refreshPending: true }), false);
  assert.equal(isAuthoritativeMt5HistorySnapshot({ refreshExhausted: true }), false);
  assert.equal(isAuthoritativeMt5HistorySnapshot({ lastError: "bridge unavailable" }), false);
});

test("omitted legacy evidence stays compatible but explicit unknown evidence is rejected", () => {
  assert.equal(isAuthoritativeMt5HistorySnapshot({}), true);
  assert.equal(isAuthoritativeMt5HistorySnapshot({ freshnessKnown: false }), false);
});

test("freshness errors retain a useful timeframe-specific reason", () => {
  assert.match(
    mt5HistoryFreshnessError({ refreshExhausted: true }, "USDCHF", "1W"),
    /USDCHF 1W/,
  );
  assert.equal(
    mt5HistoryFreshnessError({ lastError: "MT5 timeout" }, "USDCHF", "1M"),
    "MT5 timeout",
  );
});
