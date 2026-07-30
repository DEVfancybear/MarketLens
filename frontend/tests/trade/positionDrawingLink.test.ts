import assert from "node:assert/strict";
import test from "node:test";

import {
  mt5CommandComment,
  reconcilePositionDrawingExecution,
} from "../../src/services/execution/positionDrawingLink";

const execution = {
  accountId: "mt5_account",
  clientCommandId: "exec_place_123",
  status: "submitting" as const,
  updatedAt: 100,
};

const outcome = {
  commandId: "exec_place_123:mt5_account",
  parentCommandId: "exec_place_123",
  status: "accepted" as const,
  brokerOrderId: "501",
  updatedAtMs: 200,
};

test("drawing link resolves a broker pending order by durable command outcome", () => {
  const result = reconcilePositionDrawingExecution({
    execution,
    accountId: "mt5_account",
    outcomes: [outcome],
    positions: [],
    pendingOrders: [
      {
        ticket: "501",
        symbol: "EURUSD",
        brokerSymbol: "EURUSD",
        side: "buy",
        type: "limit",
        volume: 0.1,
        price: 1.1,
        comment: mt5CommandComment(outcome.commandId),
        createdAt: 150,
        updatedAt: 220,
      },
    ],
  });

  assert.equal(result?.execution.status, "pending");
  assert.equal(result?.execution.brokerOrderId, "501");
  assert.equal(result?.pendingOrder?.ticket, "501");
});

test("drawing link follows the broker comment when a pending order fills", () => {
  const result = reconcilePositionDrawingExecution({
    execution: {
      ...execution,
      status: "pending",
      brokerOrderId: "501",
      updatedAt: 220,
    },
    accountId: "mt5_account",
    outcomes: [outcome],
    pendingOrders: [],
    positions: [
      {
        ticket: "701",
        symbol: "EURUSD",
        brokerSymbol: "EURUSD",
        side: "long",
        volume: 0.1,
        openPrice: 1.1,
        currentPrice: 1.101,
        profit: 10,
        comment: mt5CommandComment(outcome.commandId),
        openedAt: 230,
        updatedAt: 240,
      },
    ],
  });

  assert.equal(result?.execution.status, "running");
  assert.equal(result?.execution.brokerPositionId, "701");
  assert.equal(result?.position?.ticket, "701");
});

test("a filled outcome is not marked closed before its first position snapshot", () => {
  const result = reconcilePositionDrawingExecution({
    execution: {
      ...execution,
      status: "running",
      updatedAt: 220,
    },
    accountId: "mt5_account",
    outcomes: [{ ...outcome, status: "filled", updatedAtMs: 230 }],
    pendingOrders: [],
    positions: [],
  });

  assert.equal(result?.execution.status, "running");
});
