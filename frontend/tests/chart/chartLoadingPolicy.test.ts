import assert from "node:assert/strict";
import test from "node:test";
import { shouldShowChartLoading } from "../../src/components/chart/chartLoadingPolicy";

test("warm cached candles never show a blocking loading overlay", () => {
  assert.equal(
    shouldShowChartLoading({
      benchmark: false,
      replayOwnsChart: false,
      replayConnecting: false,
      loading: true,
      candleCount: 120,
    }),
    false,
  );
});

test("cold live history still shows the loading overlay", () => {
  assert.equal(
    shouldShowChartLoading({
      benchmark: false,
      replayOwnsChart: false,
      replayConnecting: false,
      loading: true,
      candleCount: 0,
    }),
    true,
  );
});
