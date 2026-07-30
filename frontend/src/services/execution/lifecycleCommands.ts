import { executionDecimal } from "./orderRouting";
import type {
  Mt5CancelRequest,
  Mt5CloseRequest,
  Mt5ModifyRequest,
} from "@/types/mt5";

interface CommandIdentity {
  commandId: string;
  idempotencyKey: string;
  targetAccountId: string;
}

function identity(accountId: string, clientOrderId: string): CommandIdentity {
  return {
    commandId: clientOrderId,
    idempotencyKey: clientOrderId,
    targetAccountId: accountId,
  };
}

export function buildClosePositionCommand(
  accountId: string,
  request: Mt5CloseRequest,
): Record<string, unknown> {
  return {
    type: "closePosition",
    command: {
      ...identity(accountId, request.clientOrderId),
      brokerPositionId: request.ticket,
      ...(request.volume != null
        ? { quantity: executionDecimal(request.volume) }
        : {}),
      deviationPoints: request.deviationPoints ?? 20,
    },
  };
}

export function buildModifyPositionCommand(
  accountId: string,
  request: Mt5ModifyRequest,
): Record<string, unknown> {
  if (request.target === "pendingOrder") {
    if (request.price == null) {
      throw new Error("pending order entry price is required");
    }
    return {
      type: "modifyPendingOrder",
      command: {
        ...identity(accountId, request.clientOrderId),
        brokerOrderId: request.ticket,
        price: executionDecimal(request.price),
        ...(request.sl != null ? { stopLoss: executionDecimal(request.sl) } : {}),
        ...(request.tp != null ? { takeProfit: executionDecimal(request.tp) } : {}),
      },
    };
  }
  return {
    type: "modifyPosition",
    command: {
      ...identity(accountId, request.clientOrderId),
      brokerPositionId: request.ticket,
      ...(request.sl != null ? { stopLoss: executionDecimal(request.sl) } : {}),
      ...(request.tp != null ? { takeProfit: executionDecimal(request.tp) } : {}),
    },
  };
}

export function buildCancelOrderCommand(
  accountId: string,
  request: Mt5CancelRequest,
): Record<string, unknown> {
  return {
    type: "cancelOrder",
    command: {
      ...identity(accountId, request.clientOrderId),
      brokerOrderId: request.ticket,
    },
  };
}
