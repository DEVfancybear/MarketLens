import type { ExecutionCommandOutcomeWire } from "@/services/api/resources/executionApi";
import type {
  PositionDrawingExecution,
} from "@/types/drawing";
import type { Mt5PendingOrder, Mt5Position } from "@/types/mt5";

export interface ReconciledPositionDrawingExecution {
  execution: PositionDrawingExecution;
  tradeStatus: "pending" | "running";
  position?: Mt5Position;
  pendingOrder?: Mt5PendingOrder;
}

export function mt5CommandComment(commandId: string): string {
  return `SMC:${commandId}`.slice(0, 31);
}

export function reconcilePositionDrawingExecution(input: {
  execution: PositionDrawingExecution;
  accountId: string;
  outcomes: ExecutionCommandOutcomeWire[];
  positions: Mt5Position[];
  pendingOrders: Mt5PendingOrder[];
}): ReconciledPositionDrawingExecution | null {
  const { execution, accountId, outcomes, positions, pendingOrders } = input;
  if (execution.accountId !== accountId) return null;

  const related = outcomes
    .filter(
      (outcome) =>
        outcome.commandId === execution.clientCommandId ||
        outcome.parentCommandId === execution.clientCommandId ||
        outcome.parentCommandId.startsWith(`${execution.clientCommandId}:`),
    )
    .sort((left, right) => right.updatedAtMs - left.updatedAtMs);
  const latest = related[0];
  const brokerOrderId =
    latest?.brokerOrderId ?? execution.brokerOrderId;
  const expectedComments = new Set(
    related.map((outcome) => mt5CommandComment(outcome.commandId)),
  );
  const pendingOrder = pendingOrders.find(
    (order) =>
      (brokerOrderId != null && order.ticket === brokerOrderId) ||
      (order.comment != null && expectedComments.has(order.comment)),
  );
  const position = positions.find(
    (candidate) =>
      (execution.brokerPositionId != null &&
        candidate.ticket === execution.brokerPositionId) ||
      (brokerOrderId != null && candidate.ticket === brokerOrderId) ||
      (candidate.comment != null && expectedComments.has(candidate.comment)),
  );

  let status = execution.status;
  if (position) status = "running";
  else if (pendingOrder) status = "pending";
  else if (latest && ["failed", "rejected", "unknown"].includes(latest.status)) {
    status = "rejected";
  } else if (latest?.status === "cancelled") {
    status = "closed";
  } else if (
    execution.status === "running" &&
    execution.brokerPositionId != null
  ) {
    status = "closed";
  } else if (
    latest &&
    ["accepted", "partially_filled", "filled"].includes(latest.status)
  ) {
    status = latest.status === "filled" ? "running" : "pending";
  }

  const next: PositionDrawingExecution = {
    ...execution,
    status,
    ...(brokerOrderId ? { brokerOrderId } : {}),
    ...(position ? { brokerPositionId: position.ticket } : {}),
    updatedAt: Math.max(
      execution.updatedAt,
      latest?.updatedAtMs ?? 0,
      position?.updatedAt ?? 0,
      pendingOrder?.updatedAt ?? 0,
    ),
  };
  const unchanged =
    next.status === execution.status &&
    next.brokerOrderId === execution.brokerOrderId &&
    next.brokerPositionId === execution.brokerPositionId &&
    next.updatedAt === execution.updatedAt;
  if (unchanged) return null;
  return {
    execution: next,
    tradeStatus: status === "running" ? "running" : "pending",
    ...(position ? { position } : {}),
    ...(pendingOrder ? { pendingOrder } : {}),
  };
}
