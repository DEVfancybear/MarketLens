import type {
  CopyTargetDraft,
  ExecutionAccountSummary,
} from "@/types/execution";
import type {
  Mt5OrderRequest,
  Mt5PendingOrder,
  Mt5Position,
} from "@/types/mt5";
import { copyTargetAvailability } from "./copyRouting";

export type CopyableMt5Trade =
  | { kind: "position"; position: Mt5Position }
  | { kind: "pendingOrder"; order: Mt5PendingOrder };

export interface ExecutionOrderWireRequest {
  intent: {
    commandId: string;
    idempotencyKey: string;
    sourceAccountId: string;
    canonicalSymbol: string;
    side: "buy" | "sell";
    kind: "market" | "limit" | "stop";
    sizing: {
      mode: "fixed";
      quantity: string;
      unit: "lots";
    };
    limitPrice?: string;
    stopPrice?: string;
    stopLoss?: string;
    takeProfit?: string;
    metadata: Record<string, string>;
  };
  targets: Array<{
    accountId: string;
    allocation:
      | { mode: "sameQuantity" }
      | { mode: "fixedQuantity"; quantity: string; unit: "lots" }
      | { mode: "multiplier"; multiplier: string }
      | { mode: "equityProportional"; multiplier: string }
      | { mode: "riskPercent"; basisPoints: number };
    maxQuantity?: string;
  }>;
}

export function buildExecutionOrderRequest(input: {
  order: Mt5OrderRequest;
  selected: ExecutionAccountSummary;
  copyTargets: Record<string, CopyTargetDraft>;
  accounts: ExecutionAccountSummary[];
}): ExecutionOrderWireRequest {
  const { order, selected, copyTargets, accounts } = input;
  const targets: ExecutionOrderWireRequest["targets"] = [
    {
      accountId: selected.id,
      allocation: { mode: "sameQuantity" },
    },
  ];
  for (const account of accounts) {
    const target = copyTargets[account.id];
    if (
      !target?.enabled ||
      account.id === selected.id ||
      !copyTargetAvailability(account).eligible
    ) {
      continue;
    }
    targets.push(targetWire(target));
  }
  return buildOrderWire(order, selected, targets);
}

/**
 * Copies an existing broker position or pending order only to the explicitly
 * selected targets. The source account is intentionally not included because
 * it already owns the trade being copied.
 */
export function buildExecutionCopyRequest(input: {
  order: Mt5OrderRequest;
  source: ExecutionAccountSummary;
  targets: CopyTargetDraft[];
}): ExecutionOrderWireRequest {
  const targets = input.targets
    .filter(
      (target) => target.enabled && target.accountId !== input.source.id,
    )
    .map(targetWire);
  if (targets.length === 0) {
    throw new Error("at least one copy target is required");
  }
  return buildOrderWire(input.order, input.source, targets);
}

export function copyableTradeOrder(
  trade: CopyableMt5Trade,
  commandId: string,
): Mt5OrderRequest {
  if (trade.kind === "pendingOrder") {
    const order = trade.order;
    return {
      clientOrderId: commandId,
      chartSymbol: order.symbol,
      brokerSymbol: order.brokerSymbol,
      side: order.side,
      type: order.type,
      volume: order.volume,
      price: order.price,
      sl: order.sl,
      tp: order.tp,
      comment: "SMC copied pending order",
    };
  }
  const position = trade.position;
  return {
    clientOrderId: commandId,
    chartSymbol: position.symbol,
    brokerSymbol: position.brokerSymbol,
    side: position.side === "long" ? "buy" : "sell",
    type: "market",
    volume: position.volume,
    marketPrice: position.currentPrice,
    sl: position.sl,
    tp: position.tp,
    comment: "SMC copied position",
  };
}

function buildOrderWire(
  order: Mt5OrderRequest,
  source: ExecutionAccountSummary,
  targets: ExecutionOrderWireRequest["targets"],
): ExecutionOrderWireRequest {
  return {
    intent: {
      commandId: order.clientOrderId,
      idempotencyKey: order.clientOrderId,
      sourceAccountId: source.id,
      canonicalSymbol: order.chartSymbol,
      side: order.side,
      kind: order.type,
      sizing: {
        mode: "fixed",
        quantity: executionDecimal(order.volume),
        unit: "lots",
      },
      ...(order.type === "limit" && order.price != null
        ? { limitPrice: executionDecimal(order.price) }
        : {}),
      ...(order.type === "stop" && order.price != null
        ? { stopPrice: executionDecimal(order.price) }
        : {}),
      ...(order.sl != null ? { stopLoss: executionDecimal(order.sl) } : {}),
      ...(order.tp != null ? { takeProfit: executionDecimal(order.tp) } : {}),
      metadata: order.comment ? { comment: order.comment } : {},
    },
    targets,
  };
}

function targetWire(
  target: CopyTargetDraft,
): ExecutionOrderWireRequest["targets"][number] {
  return {
    accountId: target.accountId,
    allocation: allocationWire(target),
    ...(target.maxQuantity != null
      ? { maxQuantity: executionDecimal(target.maxQuantity) }
      : {}),
  };
}

function allocationWire(
  target: CopyTargetDraft,
): ExecutionOrderWireRequest["targets"][number]["allocation"] {
  switch (target.allocationMode) {
    case "fixedQuantity":
      return {
        mode: "fixedQuantity",
        quantity: executionDecimal(target.fixedQuantity ?? 0),
        unit: "lots",
      };
    case "multiplier":
      return {
        mode: "multiplier",
        multiplier: executionDecimal(target.multiplier),
      };
    case "equityProportional":
      return {
        mode: "equityProportional",
        multiplier: executionDecimal(target.multiplier),
      };
    case "riskPercent":
      return {
        mode: "riskPercent",
        basisPoints: target.riskBasisPoints ?? 50,
      };
    default:
      return { mode: "sameQuantity" };
  }
}

export function executionDecimal(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error("execution decimal must be finite");
  }
  const normalized = value.toFixed(12).replace(/\.?0+$/, "");
  return normalized === "-0" ? "0" : normalized;
}
