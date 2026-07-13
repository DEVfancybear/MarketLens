import assert from "node:assert/strict";
import { test } from "node:test";

import {
  initialReplayLogicalRange,
  latestReplayLogicalRange,
  nearestReplayCandidateIndex,
  reconcileReplayPreviewIndex,
  replayRangeIntersectsData,
  shouldInitializeReplayViewport,
  shouldRealignReplayViewport,
} from "../../src/components/chart/replayViewport";

test("a newly hydrated Replay session initializes its viewport exactly once", () => {
  assert.equal(shouldInitializeReplayViewport("fork-2", "fork-1", 1), true);
  assert.equal(shouldInitializeReplayViewport("fork-2", "fork-2", 1), false);
  assert.equal(shouldInitializeReplayViewport("fork-2", "fork-1", 0), false);
  assert.equal(shouldInitializeReplayViewport(null, "fork-1", 1), false);
});

test("a first-day Replay candle uses a history-sized logical span", () => {
  assert.deepEqual(initialReplayLogicalRange(1, 8), { from: -112, to: 8 });
  assert.equal(initialReplayLogicalRange(0, 8), null);
});

test("replay viewport detects future whitespace after cursor jumps backward", () => {
  const futureRange = { from: 950, to: 1030 };

  assert.equal(replayRangeIntersectsData(futureRange, 120), false);
  assert.equal(shouldRealignReplayViewport(futureRange, 120), true);
});

test("replay viewport preserves a range that still intersects visible data", () => {
  const visibleRange = { from: 80, to: 160 };

  assert.equal(replayRangeIntersectsData(visibleRange, 120), true);
  assert.equal(shouldRealignReplayViewport(visibleRange, 120), false);
});

test("latest replay logical range keeps the replay cursor candle in view", () => {
  const next = latestReplayLogicalRange(120, { from: 950, to: 1030 }, 8);

  assert.deepEqual(next, { from: 47, to: 127 });
});

test("latest replay logical range has a deterministic fallback when current range is unavailable", () => {
  const next = latestReplayLogicalRange(50, null, 8);

  assert.deepEqual(next, { from: -63, to: 57 });
});

test("selection geometry converts a coordinate time to a UTC candidate only", () => {
  assert.equal(nearestReplayCandidateIndex([100, 200, 300], 249), 1);
  assert.equal(nearestReplayCandidateIndex([100, 200, 300], 251), 2);
  assert.equal(nearestReplayCandidateIndex([], 251), -1);
});

test("Replay selection follows its UTC candidate when the series is replaced or shrinks", () => {
  assert.equal(reconcileReplayPreviewIndex([110, 210, 310], 200, 1), 1);
  assert.equal(reconcileReplayPreviewIndex([100, 200], 500, 4), 1);
  assert.equal(reconcileReplayPreviewIndex([100, 200], null, 4), 1);
  assert.equal(reconcileReplayPreviewIndex([], 500, 4), null);
});
