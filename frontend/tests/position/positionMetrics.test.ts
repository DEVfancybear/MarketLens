import assert from "node:assert/strict";
import { test } from "node:test";

import {
  calculatePositionProjection,
  decimalPlacesFromStep,
  formatPriceByTick,
  levelFromTicks,
  positionMarkPrice,
  roundToTick,
  ticksBetween,
} from "../../src/components/chart/drawing/tools/positionMetrics";

test("TradingView quantity is capped by risk and leverage", () => {
  const riskBound = calculatePositionProjection({
    side: "long",
    entryPrice: 100,
    targetPrice: 110,
    stopPrice: 95,
    accountSize: 10_000,
    riskValue: 1,
    riskUnit: "%",
    lotSize: 1,
    leverage: 1,
    pointValue: 1,
    markPrice: 104,
  });

  assert.equal(riskBound.riskSize, 100);
  assert.equal(riskBound.quantityByRisk, 20);
  assert.equal(riskBound.quantityByLeverage, 100);
  assert.equal(riskBound.quantity, 20);
  assert.equal(riskBound.profitPnl, 200);
  assert.equal(riskBound.lossPnl, -100);
  assert.equal(riskBound.openPnl, 80);
  assert.equal(riskBound.targetBalance, 10_200);
  assert.equal(riskBound.stopBalance, 9_900);

  const leverageBound = calculatePositionProjection({
    side: "long",
    entryPrice: 100,
    targetPrice: 110,
    stopPrice: 95,
    accountSize: 1_000,
    riskValue: 10,
    riskUnit: "%",
    lotSize: 1,
    leverage: 1,
    pointValue: 1,
  });
  assert.equal(leverageBound.quantityByRisk, 20);
  assert.equal(leverageBound.quantityByLeverage, 10);
  assert.equal(leverageBound.quantity, 10);
  assert.equal(leverageBound.lossPnl, -50);
  assert.equal(leverageBound.stopBalance, 950);
});

test("short projection applies point value and lot size to PnL", () => {
  const metrics = calculatePositionProjection({
    side: "short",
    entryPrice: 200,
    targetPrice: 190,
    stopPrice: 205,
    accountSize: 5_000,
    riskValue: 250,
    riskUnit: "amount",
    lotSize: 2,
    leverage: 10,
    pointValue: 5,
    markPrice: 198,
  });
  assert.equal(metrics.quantityByRisk, 5);
  assert.equal(metrics.quantity, 5);
  assert.equal(metrics.profitPnl, 500);
  assert.equal(metrics.lossPnl, -250);
  assert.equal(metrics.openPnl, 100);
  assert.equal(metrics.riskReward, 2);
});

test("historical drawings use right-edge close and future drawings use latest close", () => {
  const candles = [
    { time: 100, close: 10 },
    { time: 200, close: 12 },
    { time: 300, close: 15 },
  ];
  assert.equal(positionMarkPrice(candles, 220), 12);
  assert.equal(positionMarkPrice(candles, 400), 15);
  assert.equal(positionMarkPrice([], 400), null);
});

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
