import assert from "node:assert/strict";
import { test } from "node:test";

import {
  clampReplayBounds,
  indexAtOrBefore,
  indexNearestByTime,
  speedToIntervalMs,
} from "../../src/services/replayEngine";
import {
  latestReplayLogicalRange,
  replayRangeIntersectsData,
  shouldRealignReplayViewport,
} from "../../src/components/chart/replayViewport";
import type { Candle } from "../../src/types";
import { loadReplayContractFixtures } from "./fixtures";

const fixtures = loadReplayContractFixtures();

test("shared replay fixture schema is versioned and uses UTC seconds", () => {
  assert.equal(fixtures.schemaVersion, 1);
  assert.equal(fixtures.timeUnit, "unix_seconds");
});

test("date selection and at-or-before mapping follow shared fixtures", () => {
  for (const fixture of fixtures.selectionCases) {
    const candles = fixture.candles.map(
      (time): Candle => ({ time, open: 1, high: 1, low: 1, close: 1, volume: 0 }),
    );
    assert.equal(
      indexNearestByTime(candles, fixture.requestedTime),
      fixture.expectedNearestIndex,
      `${fixture.name}: nearest index`,
    );
    assert.equal(
      indexAtOrBefore(candles, fixture.requestedTime),
      fixture.expectedAtOrBeforeIndex,
      `${fixture.name}: at-or-before index`,
    );
  }
});

test("timeframe mapping uses absolute time instead of the old array index", () => {
  const m15 = Array.from({ length: 12 }, (_, index): Candle => ({
    time: 1_000 + index * 900,
    open: 1,
    high: 1,
    low: 1,
    close: 1,
    volume: 0,
  }));
  const m5 = Array.from({ length: 36 }, (_, index): Candle => ({
    time: 1_000 + index * 300,
    open: 1,
    high: 1,
    low: 1,
    close: 1,
    volume: 0,
  }));

  assert.equal(indexAtOrBefore(m5, m15[5].time), 15);
  assert.equal(indexAtOrBefore(m15, m5[16].time), 5);
});

test("replay viewport behavior is executable rather than source-regex guarded", () => {
  const futureRange = { from: 950, to: 1030 };
  assert.equal(replayRangeIntersectsData(futureRange, 120), false);
  assert.equal(shouldRealignReplayViewport(futureRange, 120), true);
  assert.deepEqual(latestReplayLogicalRange(120, futureRange, 8), {
    from: 47,
    to: 127,
  });
});

test("speed contract remains deterministic", () => {
  assert.equal(speedToIntervalMs(0.1), 10_000);
  assert.equal(speedToIntervalMs(1), 1_000);
  assert.equal(speedToIntervalMs(10), 100);
});

test("history length changes clamp replay bounds behaviorally", () => {
  assert.deepEqual(clampReplayBounds(0, 8, 9), {
    total: 0,
    anchor: 0,
    cursor: 0,
    atEnd: true,
  });
  assert.deepEqual(clampReplayBounds(5, 8, 9), {
    total: 5,
    anchor: 4,
    cursor: 4,
    atEnd: true,
  });
  assert.deepEqual(clampReplayBounds(20, 3, 7), {
    total: 20,
    anchor: 3,
    cursor: 7,
    atEnd: false,
  });
});
