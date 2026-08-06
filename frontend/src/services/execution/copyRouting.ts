import type {
  CopyRoutePreview,
  CopyRoutePreviewInput,
  ExecutionAccountSummary,
} from "@/types/execution";

const EPSILON = 1e-12;
export const OFFLINE_COPY_TTL_MS = 5 * 60 * 1_000;

export type CopyTargetAvailability =
  | {
      eligible: true;
      mode: "ready" | "waiting";
      label: string;
      detail: string;
    }
  | {
      eligible: false;
      mode: "blocked";
      label: string;
      detail: string;
    };

export function copyTargetAvailability(
  account: ExecutionAccountSummary,
): CopyTargetAvailability {
  if (account.venueKind !== "metatrader5") {
    return {
      eligible: false,
      mode: "blocked",
      label: "Unavailable",
      detail: "This venue does not have an enabled execution adapter.",
    };
  }
  if (account.status === "ready" && account.tradeAllowed) {
    return {
      eligible: true,
      mode: "ready",
      label: "Ready",
      detail: "The EA is online and can receive the copy immediately.",
    };
  }
  if (account.status === "offline" || account.status === "connecting") {
    return {
      eligible: true,
      mode: "waiting",
      label: "Offline · waits 5 min",
      detail:
        "Start this account's MT5 terminal and EA within 5 minutes. The server revalidates the order before delivery.",
    };
  }
  if (account.statusReason === "ea_update_required") {
    return {
      eligible: false,
      mode: "blocked",
      label: "EA update required",
      detail: "Install the latest SMCExecutionEA before copying to this account.",
    };
  }
  if (!account.tradeAllowed) {
    return {
      eligible: false,
      mode: "blocked",
      label: "Trading disabled",
      detail: "Enable Algo Trading and broker trading permission first.",
    };
  }
  return {
    eligible: false,
    mode: "blocked",
    label: account.status === "disabled" ? "Disabled" : "Not ready",
    detail: "Reconnect or repair this terminal before selecting it as a target.",
  };
}

/**
 * Client-side preview only. Rust repeats every calculation and risk check
 * authoritatively before an order is queued for a venue adapter.
 */
export function previewCopyRoutes(
  input: CopyRoutePreviewInput,
): CopyRoutePreview[] {
  const byId = new Map(input.accounts.map((account) => [account.id, account]));

  return input.targets.map((target): CopyRoutePreview => {
    if (!target.enabled) {
      return blocked(target.accountId, "TARGET_DISABLED");
    }
    const account = byId.get(target.accountId);
    if (!account) return blocked(target.accountId, "TARGET_NOT_FOUND");
    if (account.status === "offline" || account.status === "connecting") {
      return {
        accountId: target.accountId,
        status: "waiting",
        expiresInMs: OFFLINE_COPY_TTL_MS,
      };
    }
    if (account.status !== "ready") {
      return blocked(target.accountId, "TARGET_NOT_READY");
    }
    if (!account.tradeAllowed) {
      return blocked(target.accountId, "TARGET_CANNOT_TRADE");
    }

    let quantity = input.sourceQuantity;
    if (target.allocationMode === "fixedQuantity") {
      quantity = target.fixedQuantity ?? Number.NaN;
    } else if (target.allocationMode === "multiplier") {
      quantity *= target.multiplier;
    } else if (target.allocationMode === "equityProportional") {
      if (!isPositive(input.sourceEquity)) {
        return blocked(target.accountId, "SOURCE_EQUITY_REQUIRED");
      }
      if (!isPositive(account.equity)) {
        return blocked(target.accountId, "TARGET_EQUITY_REQUIRED");
      }
      quantity *= (account.equity / input.sourceEquity) * target.multiplier;
    } else if (target.allocationMode === "riskPercent") {
      // Risk-percent sizing requires instrument tick metadata and stop distance.
      // It is intentionally reserved for the authoritative Rust preview.
      return blocked(target.accountId, "INVALID_QUANTITY");
    }

    if (isPositive(target.maxQuantity)) {
      quantity = Math.min(quantity, target.maxQuantity);
    }
    quantity = floorToStep(
      quantity,
      input.quantitySteps?.[target.accountId] ?? 0,
    );
    if (!isPositive(quantity)) {
      return blocked(target.accountId, "INVALID_QUANTITY");
    }
    return {
      accountId: target.accountId,
      status: "ready",
      quantity,
      allocationMode: target.allocationMode,
    };
  });
}

function floorToStep(value: number, step: number): number {
  if (!isPositive(step)) return value;
  const units = Math.floor((value + EPSILON) / step);
  return Number((units * step).toPrecision(12));
}

function isPositive(value: number | undefined): value is number {
  return value != null && Number.isFinite(value) && value > 0;
}

function blocked(
  accountId: string,
  reason: Extract<CopyRoutePreview, { status: "blocked" }>["reason"],
): CopyRoutePreview {
  return { accountId, status: "blocked", reason };
}
