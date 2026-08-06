import assert from "node:assert/strict";
import test from "node:test";
import {
  buildExecutionCopyRequest,
  buildExecutionOrderRequest,
  copyableTradeOrder,
} from "../../src/services/execution/orderRouting";
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

test("fixed-quantity copy serializes target lots independently of source size", () => {
  const wire = buildExecutionOrderRequest({
    order: {
      clientOrderId: "mt5_ord_fixed",
      chartSymbol: "XAUUSD",
      brokerSymbol: "XAUUSD",
      side: "buy",
      type: "market",
      volume: 2,
    },
    selected: source,
    accounts: [source, target],
    copyTargets: {
      mt5_target: {
        accountId: "mt5_target",
        enabled: true,
        allocationMode: "fixedQuantity",
        fixedQuantity: 0.15,
        multiplier: 1,
      },
    },
  });

  assert.deepEqual(wire.targets[1]?.allocation, {
    mode: "fixedQuantity",
    quantity: "0.15",
    unit: "lots",
  });
});

test("keeps offline MT5 copy targets but excludes targets that cannot become executable", () => {
  const offline = { ...target, status: "offline" as const };
  const blocked = {
    ...target,
    id: "mt5_blocked",
    status: "blocked" as const,
    statusReason: "ea_update_required" as const,
  };
  const wire = buildExecutionOrderRequest({
    order: {
      clientOrderId: "mt5_ord_deferred",
      chartSymbol: "EURUSD",
      brokerSymbol: "EURUSD",
      side: "buy",
      type: "limit",
      volume: 0.1,
      price: 1.09,
      sl: 1.08,
    },
    selected: source,
    accounts: [source, offline, blocked],
    copyTargets: {
      [offline.id]: {
        accountId: offline.id,
        enabled: true,
        allocationMode: "sameQuantity",
        multiplier: 1,
      },
      [blocked.id]: {
        accountId: blocked.id,
        enabled: true,
        allocationMode: "sameQuantity",
        multiplier: 1,
      },
    },
  });

  assert.deepEqual(
    wire.targets.map((item) => item.accountId),
    [source.id, offline.id],
  );
});

test("existing-trade copy targets multiple accounts without resubmitting to source", () => {
  const secondTarget: ExecutionAccountSummary = {
    ...target,
    id: "mt5_target_2",
    label: "Target 2",
    externalAccountRef: "3",
  };
  const wire = buildExecutionCopyRequest({
    order: {
      clientOrderId: "exec_copy_1",
      chartSymbol: "NZDUSD",
      brokerSymbol: "NZDUSD",
      side: "buy",
      type: "limit",
      volume: 0.66,
      price: 0.57777,
      sl: 0.57708,
      tp: 0.57935,
    },
    source,
    targets: [
      {
        accountId: target.id,
        enabled: true,
        allocationMode: "sameQuantity",
        multiplier: 1,
      },
      {
        accountId: secondTarget.id,
        enabled: true,
        allocationMode: "multiplier",
        multiplier: 0.5,
      },
      {
        accountId: source.id,
        enabled: true,
        allocationMode: "sameQuantity",
        multiplier: 1,
      },
    ],
  });

  assert.equal(wire.intent.sourceAccountId, source.id);
  assert.deepEqual(
    wire.targets.map((item) => item.accountId),
    [target.id, secondTarget.id],
  );
  assert.deepEqual(wire.targets[0]?.allocation, { mode: "sameQuantity" });
  assert.deepEqual(wire.targets[1]?.allocation, {
    mode: "multiplier",
    multiplier: "0.5",
  });
});

test("existing-trade copy requires at least one non-source target", () => {
  assert.throws(
    () =>
      buildExecutionCopyRequest({
        order: {
          clientOrderId: "exec_copy_empty",
          chartSymbol: "EURUSD",
          brokerSymbol: "EURUSD",
          side: "sell",
          type: "market",
          volume: 0.1,
        },
        source,
        targets: [
          {
            accountId: source.id,
            enabled: true,
            allocationMode: "sameQuantity",
            multiplier: 1,
          },
        ],
      }),
    /at least one copy target/,
  );
});

test("pending-order copy preserves its executable prices and protection", () => {
  const order = copyableTradeOrder(
    {
      kind: "pendingOrder",
      order: {
        ticket: "154112584",
        symbol: "NZDUSD",
        brokerSymbol: "NZDUSD",
        side: "buy",
        type: "limit",
        volume: 0.66,
        price: 0.57777,
        sl: 0.57708,
        tp: 0.57935,
        createdAt: 1,
        updatedAt: 2,
      },
    },
    "exec_copy_pending",
  );

  assert.deepEqual(
    {
      side: order.side,
      type: order.type,
      volume: order.volume,
      price: order.price,
      sl: order.sl,
      tp: order.tp,
    },
    {
      side: "buy",
      type: "limit",
      volume: 0.66,
      price: 0.57777,
      sl: 0.57708,
      tp: 0.57935,
    },
  );
});

test("open-position copy becomes a same-side market order", () => {
  const order = copyableTradeOrder(
    {
      kind: "position",
      position: {
        ticket: "42",
        symbol: "EURUSD",
        brokerSymbol: "EURUSD",
        side: "short",
        volume: 0.2,
        openPrice: 1.1,
        currentPrice: 1.09,
        sl: 1.11,
        tp: 1.07,
        profit: 20,
        openedAt: 1,
        updatedAt: 2,
      },
    },
    "exec_copy_position",
  );

  assert.equal(order.side, "sell");
  assert.equal(order.type, "market");
  assert.equal(order.volume, 0.2);
  assert.equal(order.price, undefined);
  assert.equal(order.marketPrice, 1.09);
  assert.equal(order.sl, 1.11);
  assert.equal(order.tp, 1.07);
});
