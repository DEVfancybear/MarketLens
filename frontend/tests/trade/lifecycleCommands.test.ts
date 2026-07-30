import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCancelOrderCommand,
  buildClosePositionCommand,
  buildModifyPositionCommand,
} from "../../src/services/execution/lifecycleCommands";

test("close command uses decimal strings and server-owned account identity", () => {
  const command = buildClosePositionCommand("mt5_account", {
    clientOrderId: "close-1",
    ticket: "123456",
    volume: 0.5,
    deviationPoints: 30,
  });
  assert.deepEqual(command, {
    type: "closePosition",
    command: {
      commandId: "close-1",
      idempotencyKey: "close-1",
      targetAccountId: "mt5_account",
      brokerPositionId: "123456",
      quantity: "0.5",
      deviationPoints: 30,
    },
  });
  assert.equal("ownerId" in command, false);
});

test("modify and cancel commands preserve broker ticket identity", () => {
  const modify = buildModifyPositionCommand("mt5_account", {
    clientOrderId: "modify-1",
    ticket: "77",
    target: "position",
    sl: 1.095,
    tp: 1.12,
  });
  assert.equal(
    (modify.command as Record<string, unknown>).brokerPositionId,
    "77",
  );
  assert.equal(
    (modify.command as Record<string, unknown>).stopLoss,
    "1.095",
  );

  const cancel = buildCancelOrderCommand("mt5_account", {
    clientOrderId: "cancel-1",
    ticket: "88",
  });
  assert.equal(
    (cancel.command as Record<string, unknown>).brokerOrderId,
    "88",
  );
});

test("pending-order modify preserves entry and protection clear values", () => {
  assert.deepEqual(
    buildModifyPositionCommand("mt5_account", {
      clientOrderId: "modify-2",
      ticket: "88",
      target: "pendingOrder",
      price: 1.1,
      sl: 0,
      tp: 1.12,
    }),
    {
      type: "modifyPendingOrder",
      command: {
        commandId: "modify-2",
        idempotencyKey: "modify-2",
        targetAccountId: "mt5_account",
        brokerOrderId: "88",
        price: "1.1",
        stopLoss: "0",
        takeProfit: "1.12",
      },
    },
  );
});

test("pending-order modify requires an entry price", () => {
  assert.throws(() =>
    buildModifyPositionCommand("mt5_account", {
      clientOrderId: "modify-3",
      ticket: "88",
      target: "pendingOrder",
    }),
  );
});
