import assert from "node:assert/strict";
import { test } from "node:test";

import {
  clearMarketSessionsByProvider,
  countdownClockNow,
  mergeMarketSessionStatuses,
  normalizeMt5MarketSessions,
} from "../../src/services/market-data/mt5SessionStatus";
import type { MarketProvider, MarketSessionStatus } from "../../src/types";

function session(
  provider: MarketProvider = "mt5",
  patch: Partial<MarketSessionStatus> = {},
): MarketSessionStatus {
  return {
    provider,
    symbol: "EURUSD",
    state: "open",
    scheduledOpen: true,
    sessionOpenAt: 900,
    sessionCloseAt: 1_008,
    nextTransitionAt: 1_008,
    serverTime: 1_000,
    observedAt: 1_000,
    validUntil: 1_010,
    source: "mt5",
    receivedAt: 5_000,
    ...patch,
  };
}

test("normalizes camelCase market_status sessions and rejects malformed items", () => {
  const statuses = normalizeMt5MarketSessions(
    [
      {
        symbol: " eurusd ",
        state: "open",
        scheduledOpen: true,
        reason: "scheduled_session",
        sessionOpenAt: 1_700_000_000,
        sessionCloseAt: 1_700_003_600,
        nextOpenAt: 1_700_086_400,
        nextTransitionAt: 1_700_003_600,
        serverTime: 1_700_000_100,
        observedAt: 1_700_000_099,
        validUntil: 1_700_000_110,
        source: "mt5",
      },
      { symbol: "GBPUSD", state: "paused", serverTime: 1, observedAt: 1 },
    ],
    2_000_000_000,
  );

  assert.equal(statuses.length, 1);
  assert.deepEqual(statuses[0], {
    provider: "mt5",
    symbol: "EURUSD",
    state: "open",
    scheduledOpen: true,
    reason: "scheduled_session",
    sessionOpenAt: 1_700_000_000,
    sessionCloseAt: 1_700_003_600,
    nextOpenAt: 1_700_086_400,
    nextTransitionAt: 1_700_003_600,
    serverTime: 1_700_000_100,
    observedAt: 1_700_000_099,
    validUntil: 1_700_000_110,
    source: "mt5",
    receivedAt: 2_000_000_000,
  });
});

test("an explicit zero-clock unknown status immediately replaces stale open state", () => {
  const [unknown] = normalizeMt5MarketSessions(
    [{
      symbol: "EURUSD",
      state: "unknown",
      scheduledOpen: true,
      reason: "session_helper_unavailable",
      serverTime: 0,
      observedAt: 0,
      validUntil: 0,
    }],
    2_000,
    "mt5-stream",
  );
  assert.equal(unknown.state, "unknown");
  assert.equal(unknown.scheduledOpen, false);
  assert.equal(unknown.observedAt, 0);
  assert.equal(unknown.serverTime, 0);
  assert.equal(unknown.source, "mt5-stream");

  // Even a workstation clock far behind the broker must not reject this
  // explicit disconnect invalidation as an older update.
  const current = { EURUSD: session("mt5", { observedAt: 9_999 }) };
  assert.equal(
    mergeMarketSessionStatuses(current, [unknown]).EURUSD.state,
    "unknown",
  );
});

test("session merge rejects strictly older updates but accepts a later close", () => {
  const currentStatus = session("mt5", { observedAt: 200, serverTime: 200 });
  const current = { EURUSD: currentStatus };

  const afterOlder = mergeMarketSessionStatuses(current, [
    session("mt5", { observedAt: 199, serverTime: 999, state: "closed" }),
  ]);
  assert.equal(afterOlder, current);
  assert.equal(afterOlder.EURUSD, currentStatus);

  const afterClose = mergeMarketSessionStatuses(current, [
    session("mt5", { observedAt: 201, serverTime: 201, state: "closed" }),
  ]);
  assert.notEqual(afterClose, current);
  assert.equal(afterClose.EURUSD.state, "closed");
});

test("disconnect invalidation clears only statuses owned by MT5", () => {
  const current = {
    EURUSD: session("mt5"),
    BTCUSDT: session("binance", { symbol: "BTCUSDT" }),
  };
  assert.deepEqual(clearMarketSessionsByProvider(current, "mt5"), {
    BTCUSDT: current.BTCUSDT,
  });
});

test("countdown uses the UTC observation clock and stops at expiry or session close", () => {
  const open = session();

  assert.equal(countdownClockNow(undefined, 5_005), 5_005);
  assert.equal(countdownClockNow(null, 5_005), null);
  assert.equal(countdownClockNow(open, 5_005), 1_005);
  assert.equal(countdownClockNow(open, 5_008), null);
  assert.equal(
    countdownClockNow(session("mt5", { sessionCloseAt: undefined, nextTransitionAt: undefined }), 5_010),
    null,
  );
  assert.equal(countdownClockNow(session("mt5", { state: "closed" }), 5_001), null);
  assert.equal(
    countdownClockNow(
      session("mt5", { scheduledOpen: false }),
      5_001,
    ),
    null,
  );
  assert.equal(
    countdownClockNow(
      session("mt5", { sessionCloseAt: undefined, nextTransitionAt: undefined }),
      5_001,
    ),
    null,
  );
});
