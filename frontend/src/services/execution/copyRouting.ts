import type {
  CopyRoutePreview,
  CopyRoutePreviewInput,
} from "@/types/execution";

const EPSILON = 1e-12;

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
    if (account.status !== "ready") {
      return blocked(target.accountId, "TARGET_NOT_READY");
    }
    if (!account.tradeAllowed) {
      return blocked(target.accountId, "TARGET_CANNOT_TRADE");
    }

    let quantity = input.sourceQuantity;
    if (target.allocationMode === "multiplier") {
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
