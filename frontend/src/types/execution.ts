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
  eaVersion?: string;
  statusReason?: "ea_update_required" | "broker_trading_disabled";
}

export interface PropRiskRules {
  dailyLossLimitBasisPoints: number;
  maxLossLimitBasisPoints: number;
  maxRiskPerTradeBasisPoints: number;
  maxTotalOpenRiskBasisPoints: number;
  requireStopLoss: boolean;
  warningBufferBasisPoints: number;
  emergencyBufferBasisPoints: number;
  dailyProfitTargetBasisPoints?: number | null;
}

export interface PropRiskActions {
  blockNewOrders: boolean;
  cancelPendingOrders: boolean;
  closeOpenPositions: boolean;
  lockAfterProfitTarget: boolean;
  failClosedOnStaleData: boolean;
}

export type PropRiskStatus = "protected" | "warning" | "locked" | "breached";

export type PropRiskReason =
  | "DAILY_LOSS_WARNING"
  | "MAX_LOSS_WARNING"
  | "DAILY_LOSS_SAFETY_BUFFER"
  | "MAX_LOSS_SAFETY_BUFFER"
  | "DAILY_LOSS_LIMIT_BREACHED"
  | "MAX_LOSS_LIMIT_BREACHED"
  | "DAILY_PROFIT_TARGET_REACHED"
  | "UNPROTECTED_EXPOSURE"
  | "TELEMETRY_STALE"
  | "STATE_UNAVAILABLE";

export interface PropRiskEvaluation {
  status: PropRiskStatus;
  reason?: PropRiskReason;
  canOpenNewOrders: boolean;
  shouldCancelPendingOrders: boolean;
  shouldCloseOpenPositions: boolean;
  dailyLossLimit: number;
  dailyLossUsed: number;
  dailyLossRemaining: number;
  maxLossLimit: number;
  maxLossUsed: number;
  maxLossRemaining: number;
  dailyProfitTarget?: number | null;
  dailyProfitRemaining?: number | null;
  balance: number;
  equity: number;
}

export interface PropRiskProfile {
  id: string;
  version: number;
  providerCode: string;
  programCode: string;
  displayName: string;
  timezone: string;
  rulesLocked: boolean;
  capitalMode: "referenceBalances" | "manual";
  referenceBalances: number[];
  rules: PropRiskRules;
  actions: PropRiskActions;
}

export interface PropRiskAssignment
  extends Omit<
    PropRiskProfile,
    "id" | "version" | "rulesLocked" | "capitalMode" | "referenceBalances"
  > {
  accountId: string;
  enabled: boolean;
  profileId: string;
  profileVersion: number;
  initialBalance: number;
  tradingDay?: string;
  evaluation?: PropRiskEvaluation;
  updatedAtMs: number;
}

export interface PropRiskGuard {
  profiles: PropRiskProfile[];
  assignment: PropRiskAssignment | null;
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
      status: "waiting";
      expiresInMs: number;
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
