import { deleteJson, getJson, postJson } from "@/services/api/client";
import type { ExecutionAccountSummary } from "@/types/execution";
import type { ExecutionOrderWireRequest } from "@/services/execution/orderRouting";

interface ExecutionAccountsResponse {
  accounts: ExecutionAccountSummary[];
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

export type ExecutionTargetSubmission =
  | {
      status: "queued";
      accountId: string;
      commandId: string;
      warnings: string[];
    }
  | {
      status: "rejected" | "unavailable";
      accountId: string;
      code: string;
      message: string;
    };

export interface ExecutionOrderResponse {
  commandId: string;
  targets: ExecutionTargetSubmission[];
}

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

export const submitExecutionCommand = (
  command: Record<string, unknown>,
): Promise<{ ok: true }> =>
  postJson<{ ok: true }>("execution/commands", { command }, {
    retry: { limit: 0 },
    timeout: 15_000,
  });

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
  postJson<ExecutionOrderResponse>("execution/orders", request, {
    retry: { limit: 0 },
    timeout: 15_000,
  });
