import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizePropRiskEvaluation,
  presentPropRiskHeadroom,
  propRiskDecimal,
  type PropRiskEvaluationWire,
} from "../../src/services/execution/propRiskEvaluation";

const evaluationWire: PropRiskEvaluationWire = {
  modelVersion: 2,
  historyQuality: "trackedSinceGuardEnabled",
  status: "breached",
  reason: "DAILY_LOSS_LIMIT_BREACHED",
  canOpenNewOrders: false,
  shouldCancelPendingOrders: true,
  shouldCloseOpenPositions: true,
  dailyLossLimit: "2500",
  dailyLossUsed: "0",
  dailyLossRemaining: "-1553.53",
  maxLossLimit: "5000",
  maxLossUsed: "4053.53",
  maxLossRemaining: "946.47",
  maxLossReferenceBalance: "50000",
  dailyLossResult: "-4053.53",
  maxLossResult: "-4324.69",
  dailyProfitTarget: null,
  dailyProfitRemaining: null,
  balance: "45698.07",
  equity: "45946.47",
};

test("normalizes finite prop-risk decimal strings without clamping signed headroom", () => {
  assert.deepEqual(normalizePropRiskEvaluation(evaluationWire), {
    ...evaluationWire,
    dailyLossLimit: 2500,
    dailyLossUsed: 0,
    dailyLossRemaining: -1553.53,
    maxLossLimit: 5000,
    maxLossUsed: 4053.53,
    maxLossRemaining: 946.47,
    maxLossReferenceBalance: 50000,
    dailyLossResult: -4053.53,
    maxLossResult: -4324.69,
    dailyProfitTarget: null,
    dailyProfitRemaining: null,
    profitTarget: undefined,
    profitTargetResult: undefined,
    profitTargetRemaining: undefined,
    positiveDaysProfit: undefined,
    bestDayProfit: undefined,
    balance: 45698.07,
    equity: 45946.47,
  });
});

test("rejects empty and non-finite prop-risk decimals", () => {
  assert.throws(
    () => normalizePropRiskEvaluation({ ...evaluationWire, equity: "Infinity" }),
    /equity/,
  );
  assert.throws(
    () =>
      normalizePropRiskEvaluation({
        ...evaluationWire,
        dailyLossRemaining: "not-a-number",
      }),
    /dailyLossRemaining/,
  );
  assert.throws(() => propRiskDecimal("", "initialBalance"), /initialBalance/);
  assert.throws(
    () => propRiskDecimal("1e309", "initialBalance"),
    /initialBalance/,
  );
});

test("presents negative headroom as a positive exceeded amount", () => {
  assert.deepEqual(presentPropRiskHeadroom(-1553.53, 2500), {
    exceeded: true,
    displayValue: 1553.53,
    ratio: 0,
  });
  assert.deepEqual(presentPropRiskHeadroom(625, 2500), {
    exceeded: false,
    displayValue: 625,
    ratio: 0.25,
  });
});
