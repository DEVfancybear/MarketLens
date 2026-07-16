import assert from "node:assert/strict";
import { test } from "node:test";

import {
  calculatePositionSizing,
  calculateRiskAmount,
  normalizePositionVolume,
} from "../../src/services/positionSizing";

test("common sizing core resolves percent and money risk", () => {
  assert.equal(
    calculateRiskAmount({
      accountSize: 10_000,
      riskValue: 1,
      riskMode: "percent",
    }),
    100,
  );
  assert.equal(
    calculateRiskAmount({
      accountSize: 10_000,
      riskValue: 125,
      riskMode: "money",
    }),
    125,
  );
  assert.equal(
    calculateRiskAmount({
      accountSize: 10_000,
      riskValue: 125.678,
      riskMode: "money",
    }),
    125.678,
  );
});

test("common sizing core charges round-trip commission and floors volume", () => {
  const result = calculatePositionSizing({
    accountSize: 10_000,
    riskValue: 1,
    riskMode: "percent",
    stopDistance: 0.005,
    targetDistance: 0.01,
    lossPerPriceUnit: 100_000,
    profitPerPriceUnit: 100_000,
    commissionPerVolumePerSide: 3.5,
    volumeRules: { min: 0.01, max: 100, step: 0.01 },
  });

  assert.equal(result.lossPerVolume, 507);
  assert.equal(result.rawVolume > 0.197 && result.rawVolume < 0.198, true);
  assert.equal(result.volume, 0.19);
  assert.equal(result.actualRisk, 96.33);
  assert.equal(result.reward, 188.67);
  assert.equal(result.riskReward > 1.9 && result.riskReward < 2, true);
});

test("MT5 reward rounding floors a negative net reward without changing exact cents", () => {
  const result = calculatePositionSizing({
    accountSize: 10_000,
    riskValue: 1,
    riskMode: "percent",
    stopDistance: 1,
    targetDistance: 0.001,
    lossPerPriceUnit: 100,
    profitPerPriceUnit: 100,
    commissionPerVolumePerSide: 1,
    volume: 1,
    volumeRules: { min: 0.01, max: 10, step: 0.01 },
    rewardRounding: "down",
  });
  assert.equal(result.reward, -1.9);
});

test("volume normalization handles minimum, maximum, epsilon, and non-decimal steps", () => {
  assert.equal(
    normalizePositionVolume(0.003, { min: 0.01, max: 10, step: 0.01 }),
    0.01,
  );
  assert.equal(
    normalizePositionVolume(10.7, { min: 0.01, max: 10, step: 0.01 }),
    10,
  );
  assert.equal(
    normalizePositionVolume(0.30000000000000004, {
      min: 0.01,
      max: 10,
      step: 0.1,
    }),
    0.3,
  );
  assert.equal(
    normalizePositionVolume(1.13, { min: 0.25, max: 10, step: 0.25 }),
    1,
  );
});

test("common sizing core caps by available margin and supports reverse sizing", () => {
  const capped = calculatePositionSizing({
    accountSize: 10_000,
    riskValue: 10,
    riskMode: "percent",
    stopDistance: 5,
    lossPerPriceUnit: 100,
    volumeRules: { min: 0.01, max: 100, step: 0.01 },
    maxVolume: 0.05,
  });
  assert.equal(capped.volume, 0.05);
  assert.equal(capped.marginCapped, true);
  assert.equal(capped.warnings.includes("MARGIN_VOLUME_CAPPED"), true);

  const reverse = calculatePositionSizing({
    accountSize: 10_000,
    riskValue: 1,
    riskMode: "percent",
    stopDistance: 0.005,
    lossPerPriceUnit: 100_000,
    volume: 0.37,
    volumeRules: { min: 0.01, max: 100, step: 0.01 },
  });
  assert.equal(reverse.volume, 0.37);
  assert.equal(reverse.warnings.includes("RISK_FROM_VOLUME"), true);
  assert.equal(reverse.actualRisk, 185);

  const noMargin = calculatePositionSizing({
    accountSize: 10_000,
    riskValue: 1,
    riskMode: "percent",
    stopDistance: 1,
    lossPerPriceUnit: 100,
    volumeRules: { min: 0.01, max: 100, step: 0.01 },
    maxVolume: 0,
  });
  assert.equal(noMargin.volume, 0);
  assert.equal(noMargin.marginCapped, true);
});
