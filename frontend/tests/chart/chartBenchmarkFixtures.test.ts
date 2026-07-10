import test from "node:test";
import assert from "node:assert/strict";
import {
  CHART_BENCHMARK_SIZES,
  createChartBenchmarkCandles,
} from "../../src/services/chartBenchmarkFixtures";

test("benchmark fixtures provide every Phase 0 size", () => {
  assert.deepEqual(CHART_BENCHMARK_SIZES, [900, 5_000, 20_000, 100_000]);
  for (const size of CHART_BENCHMARK_SIZES) {
    const candles = createChartBenchmarkCandles(size);
    assert.equal(candles.length, size);
    assert.ok(candles.every((candle, index) => index === 0 || candle.time > candles[index - 1].time));
  }
});

test("benchmark fixtures are deterministic and valid OHLC", () => {
  const first = createChartBenchmarkCandles(900);
  const second = createChartBenchmarkCandles(900);
  assert.deepEqual(first, second);
  for (const candle of first) {
    assert.ok(candle.high >= Math.max(candle.open, candle.close));
    assert.ok(candle.low <= Math.min(candle.open, candle.close));
    assert.ok(candle.volume > 0);
  }
});
