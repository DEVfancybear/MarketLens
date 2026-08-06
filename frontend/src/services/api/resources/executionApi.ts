import { deleteJson, getJson, postJson } from "@/services/api/client";
import type {
  ExecutionAccountSummary,
  ContinuousCopyGroupActionInput,
  ContinuousCopyGroupUpsertInput,
  ContinuousCopyGroupView,
  PropRiskActions,
  PropRiskAssignment,
  PropRiskGuard,
  PropRiskProfile,
  PropRiskRules,
} from "@/types/execution";
import type { ExecutionOrderWireRequest } from "@/services/execution/orderRouting";
import {
  normalizePropRiskEvaluation,
  propRiskDecimal,
  type PropRiskEvaluationWire,
} from "@/services/execution/propRiskEvaluation";
import {
  normalizeExecutionOrderResponse,
  type ExecutionOrderResponse,
  type ExecutionTargetSubmission,
} from "@/services/execution/orderResponse";
import { authorizeTradeTransaction } from "@/services/security/tradePassword";
import {
  continuousCopyActionAuthorizationPayload,
  continuousCopyActionRequiresTradeAuthorization,
  continuousCopyGroupAuthorizationPayload,
  continuousCopyGroupRequiresTradeAuthorization,
} from "@/services/execution/continuousCopier";

export type { ExecutionOrderResponse, ExecutionTargetSubmission };

interface ExecutionAccountsResponse {
  accounts: ExecutionAccountSummary[];
}

export interface ExecutionAccountLayout {
  itemIds: string[];
  revision: number;
  updatedAtMs: number;
}

export interface ExecutionPairingToken {
  token: string;
  expiresAtMs: number;
}

export async function getExecutionAccounts(): Promise<
  ExecutionAccountSummary[]
> {
  const response = await getJson<ExecutionAccountsResponse>(
    "execution/accounts",
    {
      retry: { limit: 1, methods: ["get"] },
    },
  );
  return response.accounts;
}

export const getExecutionAccountLayout = (): Promise<ExecutionAccountLayout> =>
  getJson<ExecutionAccountLayout>("execution/account-layout", {
    retry: { limit: 1, methods: ["get"] },
  });

export const updateExecutionAccountLayout = (
  itemIds: string[],
  expectedRevision: number,
): Promise<ExecutionAccountLayout> =>
  postJson<ExecutionAccountLayout>(
    "execution/account-layout",
    { itemIds, expectedRevision },
    { retry: { limit: 0 } },
  );

export const issueExecutionPairingToken = (
  expiresInSeconds = 300,
): Promise<ExecutionPairingToken> =>
  postJson<ExecutionPairingToken>("execution/pairing-tokens", {
    expiresInSeconds,
  });

export const disconnectExecutionAccount = (
  accountId: string,
): Promise<{ ok: true }> =>
  postJson<{ ok: true }>(
    `execution/accounts/${encodeURIComponent(accountId)}/disconnect`,
    undefined,
    { retry: { limit: 0 } },
  );

export const removeExecutionAccount = (
  accountId: string,
): Promise<{ ok: true }> =>
  deleteJson<{ ok: true }>(
    `execution/accounts/${encodeURIComponent(accountId)}`,
    { retry: { limit: 0 } },
  );

export interface ExecutionPositionWire {
  brokerPositionId: string;
  canonicalSymbol: string;
  venueSymbol: string;
  side: "buy" | "sell";
  quantity: string;
  openPrice: string;
  currentPrice: string;
  stopLoss?: string;
  takeProfit?: string;
  profit: string;
  swap: string;
  commission: string;
  magic: number;
  comment: string;
  openedAtMs: number;
  observedAtMs: number;
}

export interface ExecutionPendingOrderWire {
  brokerOrderId: string;
  canonicalSymbol: string;
  venueSymbol: string;
  side: "buy" | "sell";
  kind: "limit" | "stop";
  quantity: string;
  price: string;
  stopLoss?: string;
  takeProfit?: string;
  magic: number;
  comment: string;
  createdAtMs: number;
  observedAtMs: number;
}

export interface ExecutionAccountStateWire {
  accountId: string;
  positions: ExecutionPositionWire[];
  pendingOrders: ExecutionPendingOrderWire[];
  commandOutcomes: ExecutionCommandOutcomeWire[];
}

export interface ExecutionCommandOutcomeWire {
  commandId: string;
  parentCommandId: string;
  status:
    | "waiting"
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
  expiresAtMs?: number;
  updatedAtMs: number;
}

export interface ExecutionInstrumentWire {
  canonicalSymbol: string;
  venueSymbol: string;
  quantityUnit: "lots" | "baseAsset" | "contracts";
  quantityStep: string;
  minQuantity: string;
  maxQuantity: string;
  priceTick: string;
  tickValuePerQuantity?: string | null;
  minStopDistance?: string | null;
  tradeAllowed: boolean;
}

export interface ExecutionSymbolMappingWire {
  canonicalSymbol: string;
  venueSymbol: string;
  mappingSource: "exact" | "user" | "broker_adapter";
}

export interface ExecutionAccountInstrumentsWire {
  accountId: string;
  instruments: ExecutionInstrumentWire[];
  mappings: ExecutionSymbolMappingWire[];
}

export const getExecutionAccountState = (
  accountId: string,
): Promise<ExecutionAccountStateWire> =>
  getJson<ExecutionAccountStateWire>(
    `execution/account-state?accountId=${encodeURIComponent(accountId)}`,
    { retry: { limit: 1, methods: ["get"] } },
  );

export const getContinuousCopyGroups = (
  groupId?: string,
): Promise<ContinuousCopyGroupView[]> =>
  getJson<ContinuousCopyGroupView[]>(
    groupId
      ? `execution/copy-groups?groupId=${encodeURIComponent(groupId)}`
      : "execution/copy-groups",
    { retry: { limit: 1, methods: ["get"] }, cache: "no-store" },
  );

export const saveContinuousCopyGroup = (
  input: ContinuousCopyGroupUpsertInput,
): Promise<ContinuousCopyGroupView> => {
  const request = () =>
    postJson<ContinuousCopyGroupView>("execution/copy-groups", input, {
      retry: { limit: 0 },
      timeout: 15_000,
    });
  if (!continuousCopyGroupRequiresTradeAuthorization(input)) return request();
  return authorizeTradeTransaction("copyGroup", continuousCopyGroupAuthorizationPayload(input)).then(
    (authorization) =>
      postJson<ContinuousCopyGroupView>("execution/copy-groups", input, {
        headers: { "X-Trade-Authorization": authorization },
        retry: { limit: 0 },
        timeout: 15_000,
      }),
  );
};

export const runContinuousCopyGroupAction = (
  input: ContinuousCopyGroupActionInput,
): Promise<ContinuousCopyGroupView> => {
  const request = () =>
    postJson<ContinuousCopyGroupView>("execution/copy-groups/actions", input, {
      retry: { limit: 0 },
      timeout: 15_000,
    });
  if (!continuousCopyActionRequiresTradeAuthorization(input)) return request();
  return authorizeTradeTransaction("copyGroup", continuousCopyActionAuthorizationPayload(input)).then(
    (authorization) =>
      postJson<ContinuousCopyGroupView>("execution/copy-groups/actions", input, {
        headers: { "X-Trade-Authorization": authorization },
        retry: { limit: 0 },
        timeout: 15_000,
      }),
  );
};

interface PropRiskAssignmentWire
  extends Omit<PropRiskAssignment, "initialBalance" | "evaluation"> {
  initialBalance: string;
  evaluation?: PropRiskEvaluationWire;
}

interface PropRiskProfileWire
  extends Omit<
    PropRiskProfile,
    "rulesLocked" | "capitalMode" | "referenceBalances"
  > {
  rulesLocked?: boolean;
  capitalMode?: PropRiskProfile["capitalMode"];
  referenceBalances?: number[];
}

interface PropRiskGuardWire {
  profiles: PropRiskProfileWire[];
  assignment: PropRiskAssignmentWire | null;
}

export interface UpdatePropRiskGuardInput {
  accountId: string;
  enabled: boolean;
  profileId: string;
  initialBalance: number;
  timezone: string;
  rules: PropRiskRules;
  actions: PropRiskActions;
  displayName?: string;
  providerCode?: string;
  programCode?: string;
}

export const getExecutionPropRisk = (accountId: string): Promise<PropRiskGuard> =>
  getJson<PropRiskGuardWire>(
    `execution/prop-risk?accountId=${encodeURIComponent(accountId)}`,
    { retry: { limit: 1, methods: ["get"] }, cache: "no-store" },
  ).then(normalizePropRiskGuard);

export const updateExecutionPropRisk = (
  input: UpdatePropRiskGuardInput,
): Promise<PropRiskGuard> =>
  postJson<PropRiskGuardWire>(
    "execution/prop-risk",
    { ...input, initialBalance: String(input.initialBalance) },
    { retry: { limit: 0 } },
  ).then(normalizePropRiskGuard);

function normalizePropRiskGuard(value: PropRiskGuardWire): PropRiskGuard {
  const assignment = value.assignment;
  return {
    profiles: value.profiles.map(normalizePropRiskProfile),
    assignment: assignment
      ? {
          ...assignment,
          initialBalance: propRiskDecimal(
            assignment.initialBalance,
            "initialBalance",
          ),
          evaluation: assignment.evaluation
            ? normalizePropRiskEvaluation(assignment.evaluation)
            : undefined,
        }
      : null,
  };
}

function normalizePropRiskProfile(value: PropRiskProfileWire): PropRiskProfile {
  if (
    typeof value.rulesLocked !== "boolean" ||
    (value.capitalMode !== "referenceBalances" && value.capitalMode !== "manual") ||
    !Array.isArray(value.referenceBalances) ||
    value.referenceBalances.some(
      (balance) => !Number.isSafeInteger(balance) || balance <= 0,
    ) ||
    (value.capitalMode === "referenceBalances" && value.referenceBalances.length === 0)
  ) {
    throw new Error("Prop risk profile capital metadata is unavailable");
  }
  return {
    ...value,
    rulesLocked: value.rulesLocked,
    capitalMode: value.capitalMode,
    referenceBalances: [...value.referenceBalances],
  };
}

export const submitExecutionCommand = (
  command: Record<string, unknown>,
): Promise<{ ok: true }> => {
  const payload = { command };
  return authorizeTradeTransaction("command", payload).then((authorization) =>
    postJson<{ ok: true }>("execution/commands", payload, {
      headers: { "X-Trade-Authorization": authorization },
      retry: { limit: 0 },
      timeout: 15_000,
    }),
  );
};

export const getExecutionInstruments = (
  accountId: string,
): Promise<ExecutionAccountInstrumentsWire> =>
  getJson<ExecutionAccountInstrumentsWire>(
    `execution/instruments?accountId=${encodeURIComponent(accountId)}`,
    { retry: { limit: 1, methods: ["get"] } },
  );

export const upsertExecutionSymbolMapping = (input: {
  accountId: string;
  canonicalSymbol: string;
  venueSymbol: string;
}): Promise<ExecutionSymbolMappingWire> =>
  postJson<ExecutionSymbolMappingWire>("execution/symbol-mappings", input, {
    retry: { limit: 0 },
  });

export const routeExecutionOrder = (
  request: ExecutionOrderWireRequest,
): Promise<ExecutionOrderResponse> =>
  authorizeTradeTransaction(
    "order",
    request as unknown as Record<string, unknown>,
  ).then((authorization) =>
    postJson<unknown>("execution/orders", request, {
      headers: { "X-Trade-Authorization": authorization },
      retry: { limit: 0 },
      timeout: 15_000,
    }).then(normalizeExecutionOrderResponse),
  );
