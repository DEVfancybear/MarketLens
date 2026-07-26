import assert from "node:assert/strict";
import { test } from "node:test";

import {
  calculatePositionVolumeFromRisk,
  calculateMt5PositionSizer,
  computeMt5PositionRiskMetrics,
  formatPositionVolume,
  normalizePositionVolume,
  positionRiskAmount,
} from "../../src/services/positionLotSizing";
import type { Mt5SymbolInfo } from "../../src/types/mt5";

const eurusdInfo: Mt5SymbolInfo = {
  chartSymbol: "EURUSD",
  brokerSymbol: "EURUSD",
  digits: 5,
  point: 0.00001,
  tickSize: 0.0001,
  tickValue: 10,
  minLot: 0.01,
  maxLot: 100,
  lotStep: 0.01,
  tradeMode: "full",
  updatedAt: 0,
};

test("position lot sizing derives volume from risk and SL-entry ticks", () => {
  const riskAmount = positionRiskAmount(10_000, 1, "%");
  assert.equal(riskAmount, 100);
  assert.equal(
    calculatePositionVolumeFromRisk({
      entryPrice: 1.1,
      stopPrice: 1.095,
      riskAmount: riskAmount ?? 0,
      symbolInfo: eurusdInfo,
    }),
    0.2,
  );
});

test("position lot sizing normalizes to broker lot step and formats cleanly", () => {
  assert.equal(normalizePositionVolume(0.207, eurusdInfo), 0.2);
  assert.equal(formatPositionVolume(0.2, eurusdInfo), "0.2");
});

test("mt5 position metrics use the same lot sizing contract", () => {
  const metrics = computeMt5PositionRiskMetrics({
    entryPrice: 1.1,
    stopPrice: 1.095,
    targetPrice: 1.11,
    riskPct: 1,
    equity: 10_000,
    symbolInfo: eurusdInfo,
  });

  assert.equal(metrics.positionSize, 0.2);
  assert.equal(metrics.riskAmount, 100);
  assert.equal(metrics.rewardAmount, 200);
  assert.equal(metrics.riskReward, 2);
});

test("MT5 commission is charged on both entry and exit and volume is floored", () => {
  const metrics = calculateMt5PositionSizer({
    entryPrice: 1.1,
    stopPrice: 1.095,
    targetPrice: 1.11,
    riskValue: 1,
    riskUnit: "%",
    equity: 10_000,
    commission: 3.5,
    commissionType: "currency",
    symbolInfo: eurusdInfo,
  });

  // 50 ticks * $10 + ($3.50 * 2) = $507 per lot; $100 / $507 = .1972,
  // then MT5 floors to the .01 volume step.
  assert.equal(metrics.rawPositionSize > 0.197 && metrics.rawPositionSize < 0.198, true);
  assert.equal(metrics.positionSize, 0.19);
  assert.equal(metrics.riskAmount, 96.33);
  assert.equal(metrics.rewardAmount, 188.67);
  assert.equal(metrics.commissionRoundTrip, 7);
  assert.equal(metrics.riskMoney, 100);
});

test("direction-specific tick values and USD-base future-rate correction are applied", () => {
  const metrics = calculateMt5PositionSizer({
    entryPrice: 150,
    stopPrice: 149,
    targetPrice: 152,
    side: "long",
    riskValue: 100,
    riskUnit: "amount",
    accountCurrency: "USD",
    askPrice: 150,
    bidPrice: 149.999,
    symbolInfo: {
      ...eurusdInfo,
      tickSize: 0.001,
      tickValue: 0.6666667,
      tickValueLoss: 0.6666667,
      tickValueProfit: 0.7,
      currencyBase: "USD",
      currencyProfit: "JPY",
      calcMode: "forex",
      minLot: 0.01,
      maxLot: 100,
    },
  });

  assert.equal(metrics.lossTickValue > 0.671 && metrics.lossTickValue < 0.672, true);
  assert.equal(metrics.positionSize, 0.14);
  assert.equal(metrics.warnings.includes("STOP_LOSS_WRONG_SIDE"), false);
});

test("percent commission uses contract value and minimum volume is surfaced", () => {
  const metrics = calculateMt5PositionSizer({
    entryPrice: 1.1,
    stopPrice: 1.095,
    targetPrice: 1.101,
    riskValue: 1,
    riskUnit: "%",
    balance: 10_000,
    accountBasis: "balance",
    accountCurrency: "USD",
    askPrice: 1.1,
    commission: 0.003,
    commissionType: "percent",
    symbolInfo: {
      ...eurusdInfo,
      contractSize: 100_000,
      currencyBase: "EUR",
      currencyProfit: "USD",
      calcMode: "forex",
    },
  });

  assert.equal(metrics.commissionPerLot, 3.3);
  assert.equal(metrics.positionSize, 0.19);
  assert.equal(metrics.riskAmount, 96.25);

  const tiny = calculateMt5PositionSizer({
    entryPrice: 1.1,
    stopPrice: 1.095,
    riskValue: 0.01,
    riskUnit: "%",
    equity: 10_000,
    symbolInfo: eurusdInfo,
  });
  assert.equal(tiny.positionSize, 0.01);
  assert.equal(tiny.warnings.includes("MIN_VOLUME_INCREASED_RISK"), true);
});

test("margin metadata caps volume after risk sizing", () => {
  const metrics = calculateMt5PositionSizer({
    entryPrice: 2000,
    stopPrice: 1995,
    targetPrice: 2010,
    riskValue: 10,
    riskUnit: "%",
    equity: 10_000,
    freeMargin: 1_000,
    leverage: 10,
    askPrice: 2000,
    symbolInfo: {
      ...eurusdInfo,
      tickSize: 0.01,
      point: 0.01,
      tickValue: 1,
      contractSize: 100,
      calcMode: "cfd",
      minLot: 0.01,
      maxLot: 100,
    },
  });

  assert.equal(metrics.maxPositionSizeByMargin, 0.05);
  assert.equal(metrics.positionSize, 0.05);
  assert.equal(metrics.marginCapped, true);
  assert.equal(metrics.warnings.includes("MARGIN_VOLUME_CAPPED"), true);

  const manual = calculateMt5PositionSizer({
    entryPrice: 2000,
    stopPrice: 1995,
    riskValue: 1,
    riskUnit: "%",
    equity: 10_000,
    freeMargin: 1_000,
    leverage: 10,
    askPrice: 2000,
    volumeOverride: 1,
    symbolInfo: {
      ...eurusdInfo,
      tickSize: 0.01,
      point: 0.01,
      tickValue: 1,
      contractSize: 100,
      calcMode: "cfd",
      minLot: 0.01,
      maxLot: 100,
    },
  });
  assert.equal(manual.positionSize, 0.05);
  assert.equal(manual.warnings.includes("MARGIN_VOLUME_CAPPED"), true);
});

test("short positions use loss and profit tick values for their direction", () => {
  const metrics = calculateMt5PositionSizer({
    entryPrice: 1.1,
    stopPrice: 1.105,
    targetPrice: 1.09,
    side: "short",
    riskValue: 100,
    riskUnit: "amount",
    equity: 10_000,
    symbolInfo: {
      ...eurusdInfo,
      tickSize: 0.0001,
      tickValue: 8,
      tickValueLoss: 8,
      tickValueProfit: 12,
      calcMode: "forex",
    },
  });

  assert.equal(metrics.positionSize, 0.25);
  assert.equal(metrics.lossTickValue, 8);
  assert.equal(metrics.profitTickValue, 12);
  assert.equal(metrics.rewardAmount, 300);
  assert.equal(metrics.warnings.includes("STOP_LOSS_WRONG_SIDE"), false);
});

test("non-forex symbols use contract size instead of a stale tick value", () => {
  const metrics = calculateMt5PositionSizer({
    entryPrice: 2000,
    stopPrice: 1995,
    targetPrice: 2010,
    riskValue: 1_000,
    riskUnit: "amount",
    equity: 10_000,
    symbolInfo: {
      ...eurusdInfo,
      tickSize: 0.01,
      tickValue: 0.01,
      contractSize: 100,
      calcMode: "cfd",
      currencyProfit: "USD",
    },
  });

  // 5 price units * 100 USD/unit = 500 USD per lot.
  assert.equal(metrics.lossPerPriceUnit, 100);
  assert.equal(metrics.positionSize, 2);
  assert.equal(metrics.riskAmount, 1_000);
});

test("account-basis and stop-distance warnings remain explicit", () => {
  const metrics = calculateMt5PositionSizer({
    entryPrice: 1.1,
    stopPrice: 1.0999,
    targetPrice: 1.1001,
    riskValue: 1,
    riskUnit: "%",
    balance: 10_000,
    equity: 9_000,
    accountBasis: "balanceMinusRisk",
    existingRiskMoney: 1_000,
    symbolInfo: {
      ...eurusdInfo,
      minStopDistance: 0.001,
    },
  });

  assert.equal(metrics.accountSize, 9_000);
  assert.equal(metrics.targetRisk, 90);
  assert.equal(metrics.warnings.includes("STOP_LOSS_TOO_CLOSE"), true);
  assert.equal(metrics.warnings.includes("TAKE_PROFIT_TOO_CLOSE"), true);

  const withoutStop = calculateMt5PositionSizer({
    entryPrice: 1.1,
    riskValue: 1,
    equity: 10_000,
    symbolInfo: eurusdInfo,
  });
  assert.equal(withoutStop.positionSize, 0.01);
  assert.equal(withoutStop.riskAmount, 0);
  assert.equal(withoutStop.warnings.includes("STOP_LOSS_REQUIRED"), true);

  const zeroStop = calculateMt5PositionSizer({
    entryPrice: 1.1,
    stopPrice: 0,
    targetPrice: 0,
    riskValue: 1,
    equity: 10_000,
    symbolInfo: eurusdInfo,
  });
  assert.equal(zeroStop.positionSize, 0.01);
  assert.equal(zeroStop.warnings.includes("STOP_LOSS_REQUIRED"), true);

  const missingTickValue = calculateMt5PositionSizer({
    entryPrice: 1.1,
    stopPrice: 1.095,
    riskValue: 1,
    equity: 10_000,
    symbolInfo: { ...eurusdInfo, tickValue: undefined },
  });
  assert.equal(missingTickValue.positionSize, 0);
  assert.equal(missingTickValue.warnings.includes("TICK_VALUE_UNAVAILABLE"), true);
});

test("FTMO BTCUSD 0.1 percent risk floors to 0.09 lot without an override", () => {
  const metrics = calculateMt5PositionSizer({
    entryPrice: 64_357.63,
    stopPrice: 63_857.96,
    targetPrice: 64_857.3,
    side: "long",
    riskValue: 0.1,
    riskUnit: "%",
    balance: 45_791.09,
    accountBasis: "balance",
    symbolInfo: {
      chartSymbol: "BTCUSD",
      brokerSymbol: "BTCUSD",
      point: 0.01,
      tickSize: 0.01,
      tickValue: 0.01,
      tickValueLoss: 0.01,
      tickValueProfit: 0.01,
      minLot: 0.01,
      maxLot: 5,
      lotStep: 0.01,
    },
  });

  assert.equal(metrics.targetRisk, 45.79);
  assert.equal(metrics.positionSize, 0.09);
  assert.equal(metrics.riskAmount, 44.97);
});
