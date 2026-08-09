import assert from "node:assert/strict";
import test from "node:test";
import {
  findExactPropRiskProfile,
  resolveProfileInitialBalance,
} from "../../src/services/execution/propRiskProfile";
import type { PropRiskProfile } from "../../src/types/execution";

const profile: PropRiskProfile = {
  id: "generic_stage",
  version: 2,
  providerCode: "generic",
  programCode: "stage",
  displayName: "Generic · Stage",
  timezone: "UTC",
  rulesLocked: true,
  capitalMode: "manual",
  referenceBalances: [],
  rules: {
    dailyLossLimitBasisPoints: 500,
    maxLossLimitBasisPoints: 1_000,
    dailyLossReference: "startOfDayBalance",
    maxLossMode: "static",
    maxRiskPerTradeBasisPoints: 100,
    maxTotalOpenRiskBasisPoints: 300,
    requireStopLoss: true,
    warningBufferBasisPoints: 100,
    emergencyBufferBasisPoints: 50,
  },
  actions: {
    blockNewOrders: true,
    cancelPendingOrders: true,
    closeOpenPositions: true,
    lockAfterProfitTarget: false,
    failClosedOnStaleData: true,
  },
};

test("reference balance resolution is profile data driven", () => {
  const balances = [25_000, 50_000, 100_000];

  assert.equal(
    resolveProfileInitialBalance("referenceBalances", balances, 45_698.07),
    50_000,
  );
  assert.equal(
    resolveProfileInitialBalance("referenceBalances", balances, 37_000),
    50_000,
  );
  assert.equal(resolveProfileInitialBalance("manual", balances, 12_345), 12_345);
});

test("reference balance resolution rejects unusable telemetry", () => {
  assert.equal(
    resolveProfileInitialBalance("referenceBalances", [50_000], undefined),
    undefined,
  );
  assert.equal(
    resolveProfileInitialBalance("referenceBalances", [50_000], Number.NaN),
    undefined,
  );
  assert.equal(
    resolveProfileInitialBalance("referenceBalances", [50_000], 0),
    undefined,
  );
  assert.equal(
    resolveProfileInitialBalance("referenceBalances", [0, Number.NaN], 12_345),
    undefined,
  );
});

test("assignment lookup requires the exact catalog version and never falls back", () => {
  assert.equal(findExactPropRiskProfile([profile], "generic_stage", 2), profile);
  assert.equal(findExactPropRiskProfile([profile], "generic_stage", 1), undefined);
  assert.equal(findExactPropRiskProfile([profile], "different_stage", 2), undefined);
  assert.equal(findExactPropRiskProfile([], "generic_stage", 2), undefined);
});
