import assert from "node:assert/strict";
import test from "node:test";
import { buildExecutionOrderRequest } from "../../src/services/execution/orderRouting";
import type { ExecutionAccountSummary } from "../../src/types/execution";

const source: ExecutionAccountSummary = {
  id: "mt5_source",
  label: "Source",
  venueKind: "metatrader5",
  brokerCode: "broker",
  externalAccountRef: "1",
  mode: "live",
  status: "ready",
  currency: "USD",
  tradeAllowed: true,
};
const target: ExecutionAccountSummary = {
  ...source,
  id: "mt5_target",
  label: "Target",
  externalAccountRef: "2",
};

test("builds decimal-string direct and copy targets without owner identity", () => {
  const wire = buildExecutionOrderRequest({
    order: {
      clientOrderId: "mt5_ord_1",
      chartSymbol: "EURUSD",
      brokerSymbol: "EURUSD",
      side: "buy",
      type: "market",
      volume: 0.1,
      sl: 1.08,
      tp: 1.12,
    },
    selected: source,
    accounts: [source, target],
    copyTargets: {
      mt5_target: {
        accountId: "mt5_target",
        enabled: true,
        allocationMode: "multiplier",
        multiplier: 1.5,
      },
    },
  });

  assert.equal("ownerId" in wire, false);
  assert.equal(wire.intent.sizing.quantity, "0.1");
  assert.equal(wire.intent.stopLoss, "1.08");
  assert.deepEqual(wire.targets[0]?.allocation, { mode: "sameQuantity" });
  assert.deepEqual(wire.targets[1]?.allocation, {
    mode: "multiplier",
    multiplier: "1.5",
  });
});

test("risk-percent copy serializes basis points, not a floating percent", () => {
  const wire = buildExecutionOrderRequest({
    order: {
      clientOrderId: "mt5_ord_2",
      chartSymbol: "XAUUSD",
      brokerSymbol: "XAUUSD",
      side: "sell",
      type: "limit",
      volume: 1,
      price: 2400,
      sl: 2410,
    },
    selected: source,
    accounts: [source, target],
    copyTargets: {
      mt5_target: {
        accountId: "mt5_target",
        enabled: true,
        allocationMode: "riskPercent",
        multiplier: 1,
        riskBasisPoints: 75,
      },
    },
  });

  assert.deepEqual(wire.targets[1]?.allocation, {
    mode: "riskPercent",
    basisPoints: 75,
  });
  assert.equal(wire.intent.limitPrice, "2400");
});
