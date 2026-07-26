export type ExecutionVenueKind =
  | "simulator"
  | "metatrader5"
  | "binanceSpot"
  | "binanceUsdM";

export type ExecutionAccountMode = "simulated" | "demo" | "live" | "unknown";

export type ExecutionAccountStatus =
  | "disabled"
  | "offline"
  | "connecting"
  | "ready"
  | "degraded"
  | "blocked";

/** Broker-neutral account summary returned by the Rust execution gateway. */
export interface ExecutionAccountSummary {
  id: string;
  label: string;
  venueKind: ExecutionVenueKind;
  brokerCode: string;
  externalAccountRef: string;
  server?: string;
  mode: ExecutionAccountMode;
  status: ExecutionAccountStatus;
  currency: string;
  balance?: number;
  equity?: number;
  tradeAllowed: boolean;
  updatedAt?: number;
}

export type CopyAllocationMode =
  | "sameQuantity"
  | "multiplier"
  | "equityProportional"
  | "riskPercent";

export interface CopyTargetDraft {
  accountId: string;
  enabled: boolean;
  allocationMode: CopyAllocationMode;
  multiplier: number;
  riskBasisPoints?: number;
  maxQuantity?: number;
}

export interface CopyRoutePreviewInput {
  sourceAccountId: string;
  sourceQuantity: number;
  sourceEquity?: number;
  targets: CopyTargetDraft[];
  accounts: ExecutionAccountSummary[];
  quantitySteps?: Record<string, number>;
}

export type CopyRoutePreview =
  | {
      accountId: string;
      status: "ready";
      quantity: number;
      allocationMode: CopyAllocationMode;
    }
  | {
      accountId: string;
      status: "blocked";
      reason:
        | "TARGET_DISABLED"
        | "TARGET_NOT_FOUND"
        | "TARGET_NOT_READY"
        | "TARGET_CANNOT_TRADE"
        | "SOURCE_EQUITY_REQUIRED"
        | "TARGET_EQUITY_REQUIRED"
        | "INVALID_QUANTITY";
    };
