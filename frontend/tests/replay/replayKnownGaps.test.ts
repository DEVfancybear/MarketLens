import assert from "node:assert/strict";
import { test } from "node:test";

import { mtfSnapshot, speedToIntervalMs, indexAtOrBefore } from "../../src/services/replayEngine";
import { checkPendingTrigger } from "../../src/services/tradeEngine";
import type { Candle, Position } from "../../src/types";
import {
  type FixtureBar,
  type FixtureOrder,
  loadReplayContractFixtures,
} from "./fixtures";

const fixtures = loadReplayContractFixtures();

function candleOf(bar: FixtureBar): Candle {
  return {
    time: bar.time,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
  };
}

function pendingPosition(order: FixtureOrder): Position {
  return {
    id: order.clientOrderId,
    symbol: order.symbol,
    side: order.side,
    type: order.type,
    status: "pending",
    entry: order.entry,
    quantity: 1,
    remaining: 1,
    riskAmount: 1,
    openTime: 0,
    realizedPnl: 0,
    unrealizedPnl: 0,
    fills: [],
  };
}

function aggregateRevealedBars(bars: FixtureBar[], complete: boolean) {
  assert.ok(bars.length > 0);
  return {
    time: bars[0].time,
    open: bars[0].open,
    high: Math.max(...bars.map((bar) => bar.high)),
    low: Math.min(...bars.map((bar) => bar.low)),
    close: bars[bars.length - 1].close,
    volume: bars.reduce((sum, bar) => sum + bar.volume, 0),
    complete,
  };
}

test("known gap: legacy MTF exposes finalized OHLC before the higher-TF bar completes", () => {
  const fixture = fixtures.knownGaps.partialMtf;
  const expected = aggregateRevealedBars(fixture.revealedBaseBars, false);
  assert.deepEqual(expected, fixture.expectedPartialBar);

  const legacy = mtfSnapshot(
    fixture.revealedThrough,
    { "15m": [candleOf(fixture.sourceFinalBar)] },
    ["15m"],
  )[0].candle;

  assert.notDeepEqual(
    legacy,
    fixture.expectedPartialBar,
    "remove this known-gap assertion when backend progressive aggregation owns MTF",
  );
  assert.equal(legacy?.high, fixture.sourceFinalBar.high);
  assert.equal(legacy?.low, fixture.sourceFinalBar.low);
});

test("known gap: latest-only trade feed misses an intermediate +N fill", () => {
  const fixture = fixtures.knownGaps.skippedTradeFill;
  const position = pendingPosition(fixture.order);
  const lastOnly = checkPendingTrigger(
    position,
    candleOf(fixture.revealedBars[fixture.revealedBars.length - 1]),
  );
  assert.equal(lastOnly, null);

  const sequential = fixture.revealedBars
    .map((bar) => ({ bar, trigger: checkPendingTrigger(position, candleOf(bar)) }))
    .find(({ trigger }) => trigger?.type === "fill");
  assert.equal(sequential?.bar.seq, fixture.expectedFill.seq);
  assert.equal(sequential?.trigger?.price, fixture.expectedFill.price);
});

test("target contract: rewind with trades requires a fork instead of processing time backwards", () => {
  const fixture = fixtures.knownGaps.rewindWithOpenPosition;
  const error =
    fixture.hasTrades && fixture.requestedSeq < fixture.lastProcessedSeq
      ? "rewind_requires_fork"
      : null;
  assert.equal(error, fixture.expectedError);
});

test("known gap: legacy market loop can trigger an order from another symbol", () => {
  const fixture = fixtures.knownGaps.crossSymbolFill;
  const bar = candleOf(fixture.bar);
  const legacyTriggered = fixture.orders
    .filter((order) => checkPendingTrigger(pendingPosition(order), bar)?.type === "fill")
    .map((order) => order.clientOrderId);
  const targetTriggered = fixture.orders
    .filter((order) => order.symbol === fixture.marketSymbol)
    .filter((order) => checkPendingTrigger(pendingPosition(order), bar)?.type === "fill")
    .map((order) => order.clientOrderId);

  assert.deepEqual(targetTriggered, fixture.expectedTriggeredClientOrderIds);
  assert.notDeepEqual(legacyTriggered, targetTriggered);
  assert.ok(legacyTriggered.includes("btc-stop-entry"));
});

test("known gap: browser elapsed time would catch up after a hidden-tab pause", () => {
  const fixture = fixtures.knownGaps.hiddenTabResume;
  const legacySteps = Math.min(
    200,
    Math.floor(
      fixture.elapsedWallTimeMs / speedToIntervalMs(fixture.speed),
    ),
  );

  assert.ok(legacySteps > 0);
  assert.equal(fixture.expectedStatus, "paused");
  assert.equal(fixture.expectedSteps, 0);
  assert.equal(fixture.expectedPauseReason, "no_subscribers");
});

test("known gap: unavailable timeframe must error instead of reusing the old index", () => {
  const fixture = fixtures.knownGaps.unavailableTimeframe;
  const candles = fixture.newCandleTimes.map(
    (time): Candle => ({ time, open: 1, high: 1, low: 1, close: 1, volume: 0 }),
  );
  const mapped = indexAtOrBefore(candles, fixture.savedTime);
  const legacyCursor = mapped >= 0 ? mapped : fixture.currentCursor;

  assert.equal(mapped, -1);
  assert.equal(legacyCursor, fixture.expectedCursor);
  assert.equal(fixture.expectedError, "data_point_unavailable");
});
