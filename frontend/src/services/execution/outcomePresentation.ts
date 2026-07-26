import type { ToastVariant } from "@/store/toastStore";

export interface ExecutionOutcomeLike {
  commandId: string;
  parentCommandId: string;
  status:
    | "ready"
    | "rejected"
    | "queued"
    | "submitted"
    | "accepted"
    | "partially_filled"
    | "filled"
    | "cancelled"
    | "failed"
    | "unknown";
  rejectCode?: string;
  message?: string;
  brokerOrderId?: string;
  brokerDealId?: string;
  updatedAtMs: number;
}

export interface ExecutionOutcomeToast {
  title: string;
  message: string;
  variant: ToastVariant;
  duration?: number;
}

export interface ExecutionOutcomePresentation {
  level: "info" | "warn" | "error";
  toast?: ExecutionOutcomeToast;
}

const DELIVERY_UNCERTAIN_CODES = new Set([
  "DELIVERY_EXPIRED",
  "DELIVERY_OUTCOME_UNKNOWN",
]);

export function isTerminalExecutionOutcome(
  status: ExecutionOutcomeLike["status"],
): boolean {
  return [
    "accepted",
    "partially_filled",
    "filled",
    "cancelled",
    "failed",
    "rejected",
    "unknown",
  ].includes(status);
}

export function presentExecutionOutcome(
  outcome: ExecutionOutcomeLike,
  accountLabel: string,
): ExecutionOutcomePresentation {
  if (DELIVERY_UNCERTAIN_CODES.has(outcome.rejectCode ?? "")) {
    return {
      level: "warn",
      toast: {
        title: `Check MT5 before trading again`,
        message:
          `The result on ${accountLabel} is not confirmed. The order may already exist in MT5. ` +
          "Reconcile open positions, pending orders, and account history before submitting a replacement.",
        variant: "warn",
        duration: 0,
      },
    };
  }

  if (outcome.rejectCode === "DELIVERY_UNAVAILABLE") {
    return {
      level: "error",
      toast: {
        title: `Command not delivered to ${accountLabel}`,
        message:
          outcome.message ??
          "The EA did not receive this command before its delivery deadline.",
        variant: "error",
      },
    };
  }

  if (outcome.status === "failed" || outcome.status === "rejected") {
    return {
      level: "error",
      toast: {
        title: `Broker rejected command on ${accountLabel}`,
        message:
          outcome.message ??
          "The execution agent reported that the broker rejected this command.",
        variant: "error",
      },
    };
  }

  if (outcome.status === "unknown") {
    return {
      level: "warn",
      toast: {
        title: `Broker outcome unknown on ${accountLabel}`,
        message:
          outcome.message ??
          "Reconcile the MT5 account before submitting another command.",
        variant: "warn",
        duration: 0,
      },
    };
  }

  if (outcome.status === "partially_filled") {
    return {
      level: "warn",
      toast: {
        title: `Order partially filled on ${accountLabel}`,
        message: brokerReference(outcome, "The broker reported a partial fill."),
        variant: "warn",
      },
    };
  }

  if (outcome.status === "cancelled") {
    return {
      level: "info",
      toast: {
        title: `Order cancelled on ${accountLabel}`,
        message: brokerReference(outcome, "The broker confirmed the cancellation."),
        variant: "success",
      },
    };
  }

  if (outcome.status === "accepted" || outcome.status === "filled") {
    const filled = outcome.status === "filled" || Boolean(outcome.brokerDealId);
    return {
      level: "info",
      toast: {
        title: filled
          ? `Order filled on ${accountLabel}`
          : `Order accepted on ${accountLabel}`,
        message: brokerReference(
          outcome,
          filled
            ? "MT5 confirmed the broker deal."
            : "MT5 confirmed the broker order.",
        ),
        variant: "success",
      },
    };
  }

  return { level: "info" };
}

function brokerReference(
  outcome: ExecutionOutcomeLike,
  fallback: string,
): string {
  if (outcome.message) return outcome.message;
  if (outcome.brokerDealId) return `Deal #${outcome.brokerDealId}`;
  if (outcome.brokerOrderId) return `Order #${outcome.brokerOrderId}`;
  return fallback;
}
