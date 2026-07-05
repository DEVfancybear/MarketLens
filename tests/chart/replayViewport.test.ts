import assert from "node:assert/strict";
import { test } from "node:test";

import {
  latestReplayLogicalRange,
  replayRangeIntersectsData,
  shouldRealignReplayViewport,
} from "../../src/components/chart/replayViewport";

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
