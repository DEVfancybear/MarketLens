import assert from "node:assert/strict";
import { test } from "node:test";

import {
  calculatePositionVolumeFromRisk,
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
