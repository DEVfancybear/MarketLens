import type {
  CopyTargetDraft,
  ExecutionAccountSummary,
} from "@/types/execution";
import type { Mt5OrderRequest } from "@/types/mt5";

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
    if (!target?.enabled || account.id === selected.id) continue;
    targets.push({
      accountId: account.id,
      allocation: allocationWire(target),
      ...(target.maxQuantity != null
        ? { maxQuantity: executionDecimal(target.maxQuantity) }
        : {}),
    });
  }
  return {
    intent: {
      commandId: order.clientOrderId,
      idempotencyKey: order.clientOrderId,
      sourceAccountId: selected.id,
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

function allocationWire(
  target: CopyTargetDraft,
): ExecutionOrderWireRequest["targets"][number]["allocation"] {
  switch (target.allocationMode) {
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
