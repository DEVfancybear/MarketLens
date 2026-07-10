import test from "node:test";
import assert from "node:assert/strict";
import {
  selectSmcInputWindow,
  SMC_INPUT_MAX_BARS,
} from "../../src/services/smc/smcInputWindow";
import type { Candle } from "../../src/types";

const candles = Array.from({ length: 5_000 }, (_, index): Candle => ({
  time: index + 1,
  open: index,
  high: index + 1,
  low: index - 1,
  close: index + 0.5,
  volume: 100,
}));

test("SMC worker input keeps small arrays by identity", () => {
  const small = candles.slice(0, 900);
  assert.equal(selectSmcInputWindow(small), small);
});

test("SMC worker input is capped to the engine analysis tail", () => {
  const selected = selectSmcInputWindow(candles);
  assert.equal(selected.length, SMC_INPUT_MAX_BARS);
  assert.equal(selected[0], candles[3_500]);
  assert.equal(selected.at(-1), candles.at(-1));
});
