import assert from "node:assert/strict";
import test from "node:test";
import type { Candle, IndicatorConfig } from "../../src/types";
import { indicatorDependencyFor } from "../../src/services/indicatorDependencies";
import {
  buildEmaState,
  buildMacdState,
  buildRsiState,
  currentSessionVwap,
  latestSma,
  rsiValue,
} from "../../src/services/incrementalIndicatorMath";

function candles(count = 600): Candle[] {
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + Math.sin(index / 9) * 4 + index * 0.015;
    return {
      time: 1_700_000_000 + index * 300,
      open: close - 0.2,
      high: close + 0.7,
      low: close - 0.8,
      close,
      volume: index % 19 === 0 ? 0 : 10 + (index % 13),
    };
  });
}

function closeEnough(actual: number, expected: number, message?: string) {
  assert.ok(Math.abs(actual - expected) <= 1e-10, `${message ?? "values differ"}: ${actual} vs ${expected}`);
}

test("dependency metadata separates finite, recursive, session, and safe fallback indicators", () => {
  const config = (type: IndicatorConfig["type"]): IndicatorConfig => ({
    id: type,
    type,
    length: 14,
    color: "#fff",
    visible: true,
  });
  assert.deepEqual(indicatorDependencyFor(config("SMA")), { kind: "finite", warmupBars: 13 });
  assert.deepEqual(indicatorDependencyFor(config("EMA")), {
    kind: "recursive",
    warmupBars: 13,
    checkpointInterval: 256,
  });
  assert.deepEqual(indicatorDependencyFor(config("VWAP")), { kind: "session", boundary: "utc-day" });
  assert.equal(indicatorDependencyFor(config("ADR")).kind, "full-history");
  assert.equal(indicatorDependencyFor(config("CUSTOM")).kind, "full-history");
});

test("EMA and MACD recursive state matches independent full-history recurrence", () => {
  const input = candles();
  const ema = buildEmaState(input, 21);
  let expectedEma = input[0].close;
  for (let index = 0; index < input.length; index += 1) {
    if (index > 0) expectedEma = input[index].close * (2 / 22) + expectedEma * (20 / 22);
    closeEnough(ema[index], expectedEma, `ema[${index}]`);
  }

  const macd = buildMacdState(input, 12, 26, 9);
  let fast = input[0].close;
  let slow = input[0].close;
  let signal = 0;
  for (let index = 0; index < input.length; index += 1) {
    if (index > 0) {
      fast = input[index].close * (2 / 13) + fast * (11 / 13);
      slow = input[index].close * (2 / 27) + slow * (25 / 27);
    }
    const line = fast - slow;
    signal = index === 0 ? line : line * (2 / 10) + signal * (8 / 10);
    closeEnough(macd.fast[index], fast, `macd.fast[${index}]`);
    closeEnough(macd.slow[index], slow, `macd.slow[${index}]`);
    closeEnough(macd.signal[index], signal, `macd.signal[${index}]`);
  }
});

test("RSI state matches Wilder full-history recurrence", () => {
  const input = candles();
  const length = 14;
  const state = buildRsiState(input, length);
  let gain = 0;
  let loss = 0;
  for (let index = 1; index <= length; index += 1) {
    const change = input[index].close - input[index - 1].close;
    gain += Math.max(change, 0);
    loss += Math.max(-change, 0);
  }
  gain /= length;
  loss /= length;
  closeEnough(state.avgGain[length], gain);
  closeEnough(state.avgLoss[length], loss);
  for (let index = length + 1; index < input.length; index += 1) {
    const change = input[index].close - input[index - 1].close;
    gain = (gain * (length - 1) + Math.max(change, 0)) / length;
    loss = (loss * (length - 1) + Math.max(-change, 0)) / length;
    closeEnough(state.avgGain[index], gain, `rsi.gain[${index}]`);
    closeEnough(state.avgLoss[index], loss, `rsi.loss[${index}]`);
    closeEnough(rsiValue(state.avgGain[index], state.avgLoss[index]), rsiValue(gain, loss));
  }
});

test("finite SMA and session VWAP tail values match full-history references", () => {
  const input = candles();
  const length = 50;
  const expectedSma = input.slice(-length).reduce((sum, candle) => sum + candle.close, 0) / length;
  closeEnough(latestSma(input, length)!, expectedSma);

  const lastDay = Math.floor(input.at(-1)!.time / 86_400);
  const session = input.filter((candle) => Math.floor(candle.time / 86_400) === lastDay);
  const volume = session.reduce((sum, candle) => sum + candle.volume, 0);
  const pv = session.reduce(
    (sum, candle) => sum + ((candle.high + candle.low + candle.close) / 3) * candle.volume,
    0,
  );
  closeEnough(currentSessionVwap(input)!, volume ? pv / volume : session.at(-1)!.close);

  const corrected = [...input.slice(0, -1), { ...input.at(-1)!, close: input.at(-1)!.close + 7 }];
  const correctedExpected = corrected.slice(-length).reduce((sum, candle) => sum + candle.close, 0) / length;
  closeEnough(latestSma(corrected, length)!, correctedExpected);
});
