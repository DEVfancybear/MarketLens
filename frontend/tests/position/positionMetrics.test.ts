import assert from "node:assert/strict";
import { test } from "node:test";

import {
  decimalPlacesFromStep,
  formatPriceByTick,
  levelFromTicks,
  roundToTick,
  ticksBetween,
} from "../../src/components/chart/drawing/tools/positionMetrics";

test("BTCUSDT position levels match TradingView tick and price parity", () => {
  const tickSize = 0.1;
  const entry = 61915.1;
  const profitPrice = 62061.8;
  const stopPrice = 61768.4;

  assert.equal(ticksBetween(entry, profitPrice, tickSize), 1467);
  assert.equal(ticksBetween(entry, stopPrice, tickSize), 1467);
  assert.equal(levelFromTicks(entry, 1467, 1, tickSize), profitPrice);
  assert.equal(levelFromTicks(entry, 1467, -1, tickSize), stopPrice);
  assert.equal(formatPriceByTick(profitPrice, tickSize, 2), "62061.8");
});

test("short positions invert profit and stop price directions", () => {
  const tickSize = 0.01;
  const entry = 100;

  assert.equal(levelFromTicks(entry, 25, -1, tickSize), 99.75);
  assert.equal(levelFromTicks(entry, 25, 1, tickSize), 100.25);
  assert.equal(ticksBetween(entry, 99.75, tickSize), 25);
  assert.equal(ticksBetween(entry, 100.25, tickSize), 25);
});

test("price formatting follows tick precision without cosmetic zeros", () => {
  assert.equal(decimalPlacesFromStep(1e-5), 5);
  assert.equal(roundToTick(1.234567, 0.0001), 1.2346);
  assert.equal(formatPriceByTick(1.2300000001, 0.01, 2), "1.23");
  assert.equal(formatPriceByTick(4200, 0.1, 2), "4200");
});
