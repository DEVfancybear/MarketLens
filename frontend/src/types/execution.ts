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

export type PropRiskDailyLossReference =
  | "startOfDayBalance"
  | "initialBalance";

export type PropRiskMaxLossMode = "static" | "endOfDayTrailing";

export interface PropRiskRules {
  dailyLossLimitBasisPoints: number;
  maxLossLimitBasisPoints: number;
  dailyLossReference: PropRiskDailyLossReference;
  maxLossMode: PropRiskMaxLossMode;
  maxRiskPerTradeBasisPoints: number;
  maxTotalOpenRiskBasisPoints: number;
  requireStopLoss: boolean;
  warningBufferBasisPoints: number;
  emergencyBufferBasisPoints: number;
  dailyProfitTargetBasisPoints?: number | null;
  profitTargetBasisPoints?: number | null;
  bestDayLimitBasisPoints?: number | null;
  minimumTradingDays?: number | null;
}

export interface PropRiskActions {
  blockNewOrders: boolean;
  cancelPendingOrders: boolean;
  closeOpenPositions: boolean;
  lockAfterProfitTarget: boolean;
  failClosedOnStaleData: boolean;
}

export type PropRiskStatus = "protected" | "warning" | "locked" | "breached";

export type PropRiskHistoryQuality =
  | "trackedSinceGuardEnabled"
  | "authoritative";

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
  modelVersion: number;
  historyQuality: PropRiskHistoryQuality;
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
  maxLossReferenceBalance: number;
  dailyLossResult: number;
  maxLossResult: number;
  dailyProfitTarget?: number | null;
  dailyProfitRemaining?: number | null;
  profitTarget?: number | null;
  profitTargetResult?: number | null;
  profitTargetRemaining?: number | null;
  profitTargetMet?: boolean | null;
  positiveDaysProfit?: number | null;
  bestDayProfit?: number | null;
  bestDayRatioBasisPoints?: number | null;
  bestDayMet?: boolean | null;
  minimumTradingDays?: number | null;
  tradingDays?: number | null;
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
  officialSourceUrl?: string;
  verifiedAt?: string;
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
  | "fixedQuantity"
  | "multiplier"
  | "equityProportional"
  | "riskPercent";

export interface CopyTargetDraft {
  accountId: string;
  enabled: boolean;
  allocationMode: CopyAllocationMode;
  multiplier: number;
  fixedQuantity?: number;
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

export type ContinuousCopyGroupRuntimeStatus =
  | "inactive"
  | "starting"
  | "active"
  | "paused"
  | "degraded"
  | "error";

export type ContinuousCopyTargetRuntimeStatus =
  | "inactive"
  | "connecting"
  | "active"
  | "waiting"
  | "degraded"
  | "error";

export interface ContinuousCopyConfig {
  copyMarketOrders: boolean;
  copyPendingOrders: boolean;
  copyStopLossTakeProfit: boolean;
  copyModifications: boolean;
  copyPartialCloses: boolean;
  sourceMagicFilter?: number;
  sourceCommentPrefix?: string;
  maxSlippagePoints: number;
  staleAfterMs: number;
  reconciliationIntervalMs: number;
}

export type ContinuousCopyAllocation =
  | { mode: "sameQuantity" }
  | { mode: "fixedQuantity"; quantity: string; unit: "lots" }
  | { mode: "multiplier"; multiplier: string }
  | { mode: "equityProportional"; multiplier: string }
  | { mode: "riskPercent"; basisPoints: number };

export interface BrokerMarginCap {
  basis: "equity" | "balance";
  basisPoints: number;
  alert: boolean;
}

export interface ContinuousCopyProtectionConfig {
  brokerMarginCap?: BrokerMarginCap;
  maxDrawdownBasisPoints?: number;
  trailingStopPoints: number;
  trailingStepPoints: number;
  trailingStartPoints: number;
  breakevenTriggerPoints: number;
  breakevenOffsetPoints: number;
}

export interface ContinuousCopyTargetConfig {
  allocation: ContinuousCopyAllocation;
  maxQuantity?: string;
  reverseTrade: boolean;
  symbolMapping: Record<string, string>;
  protection: ContinuousCopyProtectionConfig;
}

export interface ContinuousCopyGroupDefinition {
  id: string;
  ownerId: string;
  name: string;
  sourceAccountId: string;
  enabled: boolean;
  revision: number;
  appliedRevision: number;
  runtimeStatus: ContinuousCopyGroupRuntimeStatus;
  config: ContinuousCopyConfig;
  statusMessage?: string;
  updatedAtMs: number;
}

export interface ContinuousCopyTargetDefinition {
  groupId: string;
  accountId: string;
  enabled: boolean;
  revision: number;
  appliedRevision: number;
  runtimeStatus: ContinuousCopyTargetRuntimeStatus;
  config: ContinuousCopyTargetConfig;
  statusMessage?: string;
  updatedAtMs: number;
}

export interface ContinuousCopyGroupView {
  group: ContinuousCopyGroupDefinition;
  targets: ContinuousCopyTargetDefinition[];
  pendingWork: number;
  unresolvedErrors: number;
  activeLinks: number;
}

export interface ContinuousCopyGroupWrite {
  expectedRevision?: number;
  name: string;
  sourceAccountId: string;
  enabled: boolean;
  config: ContinuousCopyConfig;
}

export interface ContinuousCopyTargetWrite {
  expectedRevision?: number;
  accountId: string;
  enabled: boolean;
  config: ContinuousCopyTargetConfig;
}

export interface ContinuousCopyGroupUpsertInput {
  groupId?: string;
  group: ContinuousCopyGroupWrite;
  targets: ContinuousCopyTargetWrite[];
}

export type ContinuousCopyGroupAction =
  | "pause"
  | "resume"
  | "reconcile"
  | "archive";

export interface ContinuousCopyGroupActionInput {
  groupId: string;
  expectedRevision: number;
  action: ContinuousCopyGroupAction;
}
