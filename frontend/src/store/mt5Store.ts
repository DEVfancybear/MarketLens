"use client";
import { atom, getDefaultStore } from "jotai";
import { useAtomValue } from "jotai";
import { useMemo } from "react";
import { sendExecutionCommand } from "@/services/execution/runtime";
import {
  clearExecutionActivityForAccount,
  EXECUTION_ACTIVITY_CLEAR_STORAGE_KEY,
  parseExecutionActivityClearCutoffs,
  shouldAppendExecutionActivity,
} from "@/services/execution/activityLog";
import { isVolumeOnStep } from "@/services/mt5/symbolMapping";
import { selectedExecutionAccountAtom } from "./executionRegistryStore";
import { uid } from "@/utils/id";
import type {
  ExecutionMode,
  Mt5AccountSnapshot,
  Mt5CancelRequest,
  Mt5CloseAllRequest,
  Mt5CloseRequest,
  Mt5CommandLogEntry,
  Mt5ConnectionStatus,
  Mt5ModifyRequest,
  Mt5OrderRequest,
  Mt5PendingCommand,
  Mt5PendingOrder,
  Mt5Position,
  Mt5RiskSnapshot,
  Mt5SymbolInfo,
} from "@/types/mt5";
import { pushToastAtom } from "./toastStore";
import { logAtom } from "./uiStore";

const MAX_LOGS = 80;

/** MT5 is enabled by an account registered through the common execution API. */
export const mt5EnabledAtom = atom(
  (get) => get(selectedExecutionAccountAtom)?.venueKind === "metatrader5",
);
export const mt5RequireConfirmationAtom = atom(
  process.env.NEXT_PUBLIC_MT5_REQUIRE_CONFIRMATION !== "false",
);
export const mt5MaxOrderVolumeAtom = atom(
  Number(process.env.NEXT_PUBLIC_MT5_MAX_ORDER_VOLUME || 1),
);
export const executionModeAtom = atom<ExecutionMode>("simulator");
export const mt5StatusAtom = atom<Mt5ConnectionStatus>("disabled");
export const mt5AccountAtom = atom<Mt5AccountSnapshot | null>(null);
export const mt5RiskSnapshotAtom = atom<Mt5RiskSnapshot | null>(null);
export const mt5PositionsAtom = atom<Mt5Position[]>([]);
export const mt5PendingOrdersAtom = atom<Mt5PendingOrder[]>([]);
export const mt5SymbolInfoAtom = atom<Record<string, Mt5SymbolInfo>>({});
export const mt5LastHeartbeatAtom = atom<number | null>(null);
export const mt5LastErrorAtom = atom<string | null>(null);
export const mt5CommandLogAtom = atom<Mt5CommandLogEntry[]>([]);
export const mt5PendingCommandsAtom = atom<Mt5PendingCommand[]>([]);
const mt5LogClearCutoffAtom = atom<Record<string, number>>(
  loadExecutionActivityClearCutoffs(),
);

export const mt5ExecutionBlockReasonAtom = atom((get): string | null => {
  const account = get(selectedExecutionAccountAtom);
  if (!account || account.venueKind !== "metatrader5")
    return "Select an MT5 account registered by the common EA.";
  if (account.status !== "ready")
    return `${account.label} is ${account.status}.`;
  if (!account.tradeAllowed)
    return `${account.label} is not allowed to trade.`;
  return null;
});

export const setExecutionModeAtom = atom(
  null,
  (get, set, mode: ExecutionMode) => {
    if (mode === "mt5" && !get(mt5EnabledAtom)) {
      set(pushToastAtom, {
        title: "MT5 account required",
        message: "Attach the common EA and select a ready MT5 account first.",
        variant: "warn",
      });
      return;
    }
    set(executionModeAtom, mode);
  },
);

export const clearMt5LogAtom = atom(null, (get, set, accountId?: string) => {
  const scope = accountId ?? get(selectedExecutionAccountAtom)?.id;
  if (!scope) {
    set(mt5CommandLogAtom, []);
    return;
  }
  const cutoff = get(mt5CommandLogAtom)
    .filter((entry) => entry.accountId === scope)
    .reduce((latest, entry) => Math.max(latest, entry.time), Date.now());
  set(mt5LogClearCutoffAtom, (current) => {
    const next = parseExecutionActivityClearCutoffs(
      JSON.stringify({ ...current, [scope]: cutoff }),
    );
    persistExecutionActivityClearCutoffs(next);
    return next;
  });
  set(mt5CommandLogAtom, (current) =>
    clearExecutionActivityForAccount(current, scope),
  );
});

export const addMt5LogAtom = atom(
  null,
  (
    get,
    set,
    entry: Omit<Mt5CommandLogEntry, "id" | "time"> & { time?: number },
  ) => {
    const accountId =
      entry.accountId ?? get(selectedExecutionAccountAtom)?.id;
    const time = entry.time ?? Date.now();
    set(mt5CommandLogAtom, (prev) => {
      const next = {
        id: uid("mt5log"),
        time,
        accountId,
        dedupeKey: entry.dedupeKey,
        level: entry.level,
        direction: entry.direction,
        type: entry.type,
        message: entry.message,
        requestId: entry.requestId,
        clientOrderId: entry.clientOrderId,
      };
      return shouldAppendExecutionActivity(
        prev,
        next,
        get(mt5LogClearCutoffAtom),
      )
        ? [next, ...prev].slice(0, MAX_LOGS)
        : prev;
    });
  },
);

export const placeMt5OrderAtom = atom(
  null,
  (get, set, order: Mt5OrderRequest): boolean => {
    const error = validateMt5OrderState({
      enabled: get(mt5EnabledAtom),
      executionMode: get(executionModeAtom),
      status: get(mt5StatusAtom),
      account: get(mt5AccountAtom),
      symbolInfo: get(mt5SymbolInfoAtom)[order.chartSymbol],
      order,
    });
    if (error) {
      set(pushToastAtom, {
        title: "MT5 order blocked",
        message: error,
        variant: "warn",
      });
      set(addMt5LogAtom, {
        level: "warn",
        direction: "client",
        type: "order.place",
        message: error,
        clientOrderId: order.clientOrderId,
      });
      return false;
    }

    const requestId = sendExecutionCommand("order.place", order);
    if (!requestId) {
      set(pushToastAtom, {
        title: "Execution gateway unavailable",
        message: "The command was not sent.",
        variant: "error",
      });
      return false;
    }
    set(mt5PendingCommandsAtom, (prev) => [
      {
        id: requestId,
        type: "order.place",
        clientOrderId: order.clientOrderId,
        sentAt: Date.now(),
        status: "sent",
      },
      ...prev,
    ]);
    set(addMt5LogAtom, {
      level: "info",
      direction: "client",
      type: "order.place",
      message: `${order.side.toUpperCase()} ${order.chartSymbol} ${order.volume}`,
      requestId,
      clientOrderId: order.clientOrderId,
    });
    set(logAtom, "info", `MT5 order sent: ${order.side} ${order.chartSymbol}`);
    return true;
  },
);

export const closeMt5PositionAtom = atom(
  null,
  (get, set, request: Mt5CloseRequest): boolean => {
    const accessError = get(mt5ExecutionBlockReasonAtom);
    if (accessError || get(mt5StatusAtom) !== "connected") {
      set(pushToastAtom, {
        title: "MT5 close blocked",
        message: accessError ?? "Execution agent is not connected.",
        variant: "warn",
      });
      return false;
    }
    const requestId = sendExecutionCommand("order.close", request);
    if (!requestId) return false;
    set(mt5PendingCommandsAtom, (prev) => [
      {
        id: requestId,
        type: "order.close",
        clientOrderId: request.clientOrderId,
        sentAt: Date.now(),
        status: "sent",
      },
      ...prev,
    ]);
    set(addMt5LogAtom, {
      level: "info",
      direction: "client",
      type: "order.close",
      message: `Close ticket ${request.ticket}`,
      requestId,
      clientOrderId: request.clientOrderId,
    });
    return true;
  },
);

export const closeAllMt5Atom = atom(
  null,
  (get, set, request: Mt5CloseAllRequest): boolean => {
    const accessError = get(mt5ExecutionBlockReasonAtom);
    if (accessError || get(mt5StatusAtom) !== "connected") {
      set(pushToastAtom, {
        title: "MT5 close-all blocked",
        message: accessError ?? "Execution agent is not connected.",
        variant: "warn",
      });
      return false;
    }
    const requestId = sendExecutionCommand("order.closeAll", request);
    if (!requestId) return false;
    set(mt5PendingCommandsAtom, (prev) => [
      {
        id: requestId,
        type: "order.closeAll",
        clientOrderId: request.clientOrderId,
        sentAt: Date.now(),
        status: "sent",
      },
      ...prev,
    ]);
    set(addMt5LogAtom, {
      level: "warn",
      direction: "client",
      type: "order.closeAll",
      message: "Close all sent",
      requestId,
      clientOrderId: request.clientOrderId,
    });
    return true;
  },
);

export const modifyMt5OrderAtom = atom(
  null,
  (get, set, request: Mt5ModifyRequest): boolean => {
    const accessError = get(mt5ExecutionBlockReasonAtom);
    if (accessError || get(mt5StatusAtom) !== "connected") {
      set(pushToastAtom, {
        title: "MT5 modify blocked",
        message: accessError ?? "Execution agent is not connected.",
        variant: "warn",
      });
      return false;
    }
    const requestId = sendExecutionCommand("order.modify", request);
    if (!requestId) return false;
    set(mt5PendingCommandsAtom, (prev) => [
      {
        id: requestId,
        type: "order.modify",
        clientOrderId: request.clientOrderId,
        sentAt: Date.now(),
        status: "sent",
      },
      ...prev,
    ]);
    set(addMt5LogAtom, {
      level: "info",
      direction: "client",
      type: "order.modify",
      message: `Modify ticket ${request.ticket}`,
      requestId,
      clientOrderId: request.clientOrderId,
    });
    return true;
  },
);

export const cancelMt5OrderAtom = atom(
  null,
  (get, set, request: Mt5CancelRequest): boolean => {
    const accessError = get(mt5ExecutionBlockReasonAtom);
    if (accessError || get(mt5StatusAtom) !== "connected") {
      set(pushToastAtom, {
        title: "MT5 cancel blocked",
        message: accessError ?? "Execution agent is not connected.",
        variant: "warn",
      });
      return false;
    }
    const requestId = sendExecutionCommand("order.cancel", request);
    if (!requestId) return false;
    set(mt5PendingCommandsAtom, (prev) => [
      {
        id: requestId,
        type: "order.cancel",
        clientOrderId: request.clientOrderId,
        sentAt: Date.now(),
        status: "sent",
      },
      ...prev,
    ]);
    set(addMt5LogAtom, {
      level: "info",
      direction: "client",
      type: "order.cancel",
      message: `Cancel ticket ${request.ticket}`,
      requestId,
      clientOrderId: request.clientOrderId,
    });
    return true;
  },
);

const mt5CombinedAtom = atom((get) => ({
  enabled: get(mt5EnabledAtom),
  requireConfirmation: get(mt5RequireConfirmationAtom),
  maxOrderVolume: get(mt5MaxOrderVolumeAtom),
  executionMode: get(executionModeAtom),
  status: get(mt5StatusAtom),
  account: get(mt5AccountAtom),
  riskSnapshot: get(mt5RiskSnapshotAtom),
  positions: get(mt5PositionsAtom),
  pendingOrders: get(mt5PendingOrdersAtom),
  symbolInfo: get(mt5SymbolInfoAtom),
  lastHeartbeat: get(mt5LastHeartbeatAtom),
  lastError: get(mt5LastErrorAtom),
  commandLog: get(mt5CommandLogAtom),
  pendingCommands: get(mt5PendingCommandsAtom),
}));

export function useMt5Store(): ReturnType<typeof getMt5State>;
export function useMt5Store<T>(
  selector: (state: ReturnType<typeof getMt5State>) => T,
): T;
export function useMt5Store<T>(
  selector?: (state: ReturnType<typeof getMt5State>) => T,
): ReturnType<typeof getMt5State> | T {
  const state = useAtomValue(mt5CombinedAtom);
  if (!selector) return state;
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useMemo(() => selector(state), [state, selector]);
}
export function getMt5State() {
  return getDefaultStore().get(mt5CombinedAtom);
}

function validateMt5OrderState(input: {
  enabled: boolean;
  executionMode: ExecutionMode;
  status: Mt5ConnectionStatus;
  account: Mt5AccountSnapshot | null;
  symbolInfo?: Mt5SymbolInfo;
  order: Mt5OrderRequest;
}): string | null {
  const {
    enabled,
    executionMode,
    status,
    account,
    symbolInfo,
    order,
  } = input;
  if (!enabled) return "No MT5 execution account is selected.";
  if (executionMode !== "mt5") return "Execution mode is not MT5.";
  if (status !== "connected") return "The MT5 execution account is not connected.";
  if (!account) return "MT5 account snapshot is missing.";
  if (!account.tradeAllowed) return "MT5 account is not allowed to trade.";
  if (!symbolInfo) return `MT5 symbol info missing for ${order.chartSymbol}.`;
  if (symbolInfo.tradeMode === "disabled") {
    return `${symbolInfo.brokerSymbol} trading is disabled.`;
  }
  if (symbolInfo.tradeMode === "longOnly" && order.side === "sell") {
    return `${symbolInfo.brokerSymbol} only allows long trades.`;
  }
  if (symbolInfo.tradeMode === "shortOnly" && order.side === "buy") {
    return `${symbolInfo.brokerSymbol} only allows short trades.`;
  }
  if (!Number.isFinite(order.volume) || order.volume <= 0) {
    return "Order volume must be positive.";
  }
  if (order.volume < symbolInfo.minLot || order.volume > symbolInfo.maxLot) {
    return `Volume must be between ${symbolInfo.minLot} and ${symbolInfo.maxLot}.`;
  }
  const stopError = validateMt5Stops(order, symbolInfo);
  if (stopError) return stopError;
  if (!isVolumeOnStep(order.volume, symbolInfo.lotStep)) {
    return `Volume must align to lot step ${symbolInfo.lotStep}.`;
  }
  return null;
}

function validateMt5Stops(
  order: Mt5OrderRequest,
  symbolInfo: Mt5SymbolInfo,
): string | null {
  if (order.sl == null && order.tp == null) return null;
  const entry = order.price ?? order.marketPrice;
  if (!Number.isFinite(entry) || !entry || entry <= 0) {
    return "Entry price is required to validate MT5 stops.";
  }
  const minDistance = Math.max(
    0,
    symbolInfo.minStopDistance ?? (symbolInfo.stopLevel ?? 0) * symbolInfo.point,
  );
  const side = order.side.toUpperCase();
  const hasMinDistance = minDistance > 0;
  if (order.side === "buy") {
    if (
      (order.sl != null && (entry - order.sl <= 0 || (hasMinDistance && entry - order.sl < minDistance))) ||
      (order.tp != null && (order.tp - entry <= 0 || (hasMinDistance && order.tp - entry < minDistance)))
    ) {
      return `${side} stops invalid: SL must be below entry and TP above entry.`;
    }
    return null;
  }
  if (
    (order.sl != null && (order.sl - entry <= 0 || (hasMinDistance && order.sl - entry < minDistance))) ||
    (order.tp != null && (entry - order.tp <= 0 || (hasMinDistance && entry - order.tp < minDistance)))
  ) {
    return `${side} stops invalid: SL must be above entry and TP below entry.`;
  }
  return null;
}

function loadExecutionActivityClearCutoffs(): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    return parseExecutionActivityClearCutoffs(
      window.localStorage.getItem(EXECUTION_ACTIVITY_CLEAR_STORAGE_KEY),
    );
  } catch {
    return {};
  }
}

function persistExecutionActivityClearCutoffs(
  cutoffs: Record<string, number>,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      EXECUTION_ACTIVITY_CLEAR_STORAGE_KEY,
      JSON.stringify(cutoffs),
    );
  } catch {
    // Local persistence is best effort; the in-memory cutoff still prevents
    // the active poll loop from restoring cleared rows.
  }
}
