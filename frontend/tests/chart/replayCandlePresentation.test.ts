import assert from "node:assert/strict";
import test from "node:test";
import type { ReplayBar } from "../../src/services/api/resources/replayApi";
import {
  createReplayCandleProjector,
  interpolateReplayCandle,
  replayAppendedCandles,
  replayCandleAnimationDuration,
  replayCandleAnimationStart,
} from "../../src/components/chart/replayCandlePresentation";

function bar(overrides: Partial<ReplayBar> = {}): ReplayBar {
  return {
    time: "2026-05-01T10:00:00Z",
    open: 100,
    high: 108,
    low: 97,
    close: 105,
    volume: 20,
    complete: true,
    ...overrides,
  };
}

test("replay projection preserves unchanged candle identities", () => {
  const project = createReplayCandleProjector();
  const first = bar();
  const projected = project(first);
  assert.equal(project(first), projected);
  assert.notEqual(project(bar()), projected);
});

test("a newly appended replay candle grows from its open", () => {
  const target = createReplayCandleProjector()(bar());
  const start = replayCandleAnimationStart(null, target);
  assert.deepEqual(start, {
    time: target.time,
    open: 100,
    high: 100,
    low: 100,
    close: 100,
    volume: 0,
  });
  assert.deepEqual(interpolateReplayCandle(start, target, 1), target);
});

test("replay candle interpolation always keeps valid OHLC bounds", () => {
  const target = createReplayCandleProjector()(bar({ close: 95, low: 92 }));
  const start = replayCandleAnimationStart(null, target);
  const middle = interpolateReplayCandle(start, target, 0.5);
  assert.ok(middle.high >= Math.max(middle.open, middle.close));
  assert.ok(middle.low <= Math.min(middle.open, middle.close));
});

test("3x replay animation fits inside one backend clock period", () => {
  const duration = replayCandleAnimationDuration(3);
  assert.ok(duration >= 250);
  assert.ok(duration < 1000 / 3);
});

test("high-speed replay recognizes an authoritative appended batch", () => {
  const project = createReplayCandleProjector();
  const previous = [project(bar())];
  const next = [
    previous[0],
    project(bar({ time: "2026-05-01T10:15:00Z" })),
    project(bar({ time: "2026-05-01T10:30:00Z" })),
  ];
  assert.deepEqual(replayAppendedCandles(previous, next), next.slice(1));
  assert.equal(
    replayAppendedCandles(
      [project(bar({ time: "2026-05-01T09:45:00Z" }))],
      next,
    ),
    null,
  );
});

test("high-speed replay accepts a finalized forming candle before appended bars", () => {
  const project = createReplayCandleProjector();
  const stable = project(bar({ time: "2026-05-01T09:45:00Z" }));
  const forming = project(bar({ complete: false }));
  const finalized = project(bar({ close: 106, complete: true }));
  const appended = [
    project(bar({ time: "2026-05-01T10:15:00Z" })),
    project(bar({ time: "2026-05-01T10:30:00Z", complete: false })),
  ];

  assert.deepEqual(
    replayAppendedCandles([stable, forming], [stable, finalized, ...appended]),
    appended,
  );
});

test("normal-speed replay recognizes one appended candle after finalization", () => {
  const project = createReplayCandleProjector();
  const forming = project(bar({ complete: false }));
  const finalized = project(bar({ close: 106, complete: true }));
  const appended = project(bar({ time: "2026-05-01T10:15:00Z", complete: false }));

  assert.deepEqual(
    replayAppendedCandles([forming], [finalized, appended]),
    [appended],
  );
});
