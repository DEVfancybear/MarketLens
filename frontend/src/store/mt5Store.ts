"use client";
import { atom, getDefaultStore } from "jotai";
import { useAtomValue } from "jotai";
import { useMemo } from "react";
import {
  connectMt5Bridge,
  disconnectMt5Bridge,
  sendMt5Command,
} from "@/services/mt5/runtime";
import {
  mt5AccountMismatchReason,
  sameMt5ExpectedAccount,
  type Mt5ExpectedAccount,
} from "@/services/mt5/accountAccess";
import { isVolumeOnStep } from "@/services/mt5/symbolMapping";
import { uid } from "@/utils/id";
import type {
  ExecutionMode,
  Mt5AccountSnapshot,
  Mt5CancelRequest,
  Mt5CloseAllRequest,
  Mt5CloseRequest,
  Mt5CommandLogEntry,
  Mt5ConnectionStatus,
  Mt5ErrorPayload,
  Mt5ExecutionReport,
  Mt5Message,
  Mt5ModifyRequest,
  Mt5OrderAck,
  Mt5OrderReject,
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

/** Per-user execution access, hydrated from backend-verified integration settings. */
export const mt5EnabledAtom = atom(false);
export const mt5BridgeUrlAtom = atom(
  process.env.NEXT_PUBLIC_MT5_BRIDGE_URL || "ws://localhost:8787",
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
export const mt5ExpectedAccountAtom = atom<Mt5ExpectedAccount | null>(null);
export const mt5VerifiedAtAtom = atom<string | null>(null);
export const mt5RiskSnapshotAtom = atom<Mt5RiskSnapshot | null>(null);
export const mt5PositionsAtom = atom<Mt5Position[]>([]);
export const mt5PendingOrdersAtom = atom<Mt5PendingOrder[]>([]);
export const mt5SymbolInfoAtom = atom<Record<string, Mt5SymbolInfo>>({});
export const mt5LastHeartbeatAtom = atom<number | null>(null);
export const mt5LastErrorAtom = atom<string | null>(null);
export const mt5CommandLogAtom = atom<Mt5CommandLogEntry[]>([]);
export const mt5PendingCommandsAtom = atom<Mt5PendingCommand[]>([]);

export const mt5ExecutionBlockReasonAtom = atom((get): string | null => {
  if (!get(mt5EnabledAtom)) {
    return "Verify MT5 credentials in Connections & notifications to enable MT5 execution.";
  }
  const expected = get(mt5ExpectedAccountAtom);
  if (!expected) {
    return "The verified MT5 account is unavailable. Verify the credentials again.";
  }
  return mt5AccountMismatchReason(expected, get(mt5AccountAtom));
});

/** Clear all user-scoped bridge data before logout or an identity change. */
export const resetMt5IntegrationAtom = atom(null, (_get, set) => {
  disconnectMt5Bridge();
  set(mt5EnabledAtom, false);
  set(mt5ExpectedAccountAtom, null);
  set(mt5VerifiedAtAtom, null);
  set(executionModeAtom, "simulator");
  set(mt5StatusAtom, "disabled");
  set(mt5AccountAtom, null);
  set(mt5RiskSnapshotAtom, null);
  set(mt5PositionsAtom, []);
  set(mt5PendingOrdersAtom, []);
  set(mt5SymbolInfoAtom, {});
  set(mt5LastHeartbeatAtom, null);
  set(mt5LastErrorAtom, null);
  set(mt5CommandLogAtom, []);
  set(mt5PendingCommandsAtom, []);
});

export const syncMt5IntegrationAtom = atom(
  null,
  (
    get,
    set,
    value: {
      login: string;
      server: string;
      verified: boolean;
      verifiedAt?: string | null;
    },
  ) => {
    const login = value.login.trim();
    const server = value.server.trim();
    if (!value.verified || !login || !server) {
      set(resetMt5IntegrationAtom);
      return;
    }

    const expected: Mt5ExpectedAccount = {
      login,
      server,
      verifiedAt: value.verifiedAt ?? null,
    };
    const accountChanged = !sameMt5ExpectedAccount(
      get(mt5ExpectedAccountAtom),
      expected,
    );
    if (accountChanged) {
      set(executionModeAtom, "simulator");
      set(mt5StatusAtom, "disconnected");
      set(mt5AccountAtom, null);
      set(mt5RiskSnapshotAtom, null);
      set(mt5PositionsAtom, []);
      set(mt5PendingOrdersAtom, []);
      set(mt5SymbolInfoAtom, {});
      set(mt5LastHeartbeatAtom, null);
      set(mt5LastErrorAtom, null);
      set(mt5PendingCommandsAtom, []);
    } else if (get(mt5StatusAtom) === "disabled") {
      set(mt5StatusAtom, "disconnected");
    }
    set(mt5ExpectedAccountAtom, expected);
    set(mt5VerifiedAtAtom, expected.verifiedAt);
    set(mt5EnabledAtom, true);
  },
);

export const setExecutionModeAtom = atom(
  null,
  (get, set, mode: ExecutionMode) => {
    if (mode === "mt5" && !get(mt5EnabledAtom)) {
      set(pushToastAtom, {
        title: "MT5 verification required",
        message:
          "Verify this user's MT5 credentials in Connections & notifications first.",
        variant: "warn",
      });
      return;
    }
    set(executionModeAtom, mode);
  },
);

export const setMt5StatusAtom = atom(
  null,
  (_get, set, status: Mt5ConnectionStatus) => {
    set(mt5StatusAtom, status);
  },
);

export const setMt5ErrorAtom = atom(null, (_get, set, message: string) => {
  set(mt5LastErrorAtom, message);
  set(addMt5LogAtom, {
    level: "error",
    direction: "bridge",
    type: "error",
    message,
  });
});

export const connectMt5Atom = atom(null, (get, set) => {
  if (!get(mt5EnabledAtom)) {
    set(pushToastAtom, {
      title: "MT5 verification required",
      message: "Save and verify this user's MT5 credentials before connecting.",
      variant: "warn",
    });
    return;
  }
  connectMt5Bridge();
});

export const disconnectMt5Atom = atom(null, () => {
  disconnectMt5Bridge();
});

export const clearMt5LogAtom = atom(null, (_get, set) => {
  set(mt5CommandLogAtom, []);
});

export const addMt5LogAtom = atom(
  null,
  (
    get,
    set,
    entry: Omit<Mt5CommandLogEntry, "id" | "time"> & { time?: number },
  ) => {
    set(mt5CommandLogAtom, (prev) =>
      [
        {
          id: uid("mt5log"),
          time: entry.time ?? Date.now(),
          level: entry.level,
          direction: entry.direction,
          type: entry.type,
          message: entry.message,
          requestId: entry.requestId,
          clientOrderId: entry.clientOrderId,
        },
        ...prev,
      ].slice(0, MAX_LOGS),
    );
  },
);

export const markMt5CommandTimeoutAtom = atom(
  null,
  (get, set, requestId: string) => {
    const pending = get(mt5PendingCommandsAtom).find(
      (cmd) => cmd.id === requestId,
    );
    set(mt5PendingCommandsAtom, (prev) =>
      prev.filter((cmd) => cmd.id !== requestId),
    );
    const msg = `${pending?.type ?? "MT5 command"} timed out`;
    set(mt5LastErrorAtom, msg);
    set(addMt5LogAtom, {
      level: "error",
      direction: "bridge",
      type: "timeout",
      message: msg,
      requestId,
      clientOrderId: pending?.clientOrderId,
    });
    set(pushToastAtom, {
      title: "MT5 command timeout",
      message: msg,
      variant: "error",
    });
  },
);

export const applyMt5MessageAtom = atom(null, (get, set, message: Mt5Message) => {
  switch (message.type) {
    case "hello":
      set(addMt5LogAtom, {
        level: "info",
        direction: "bridge",
        type: message.type,
        message: "Bridge hello received",
      });
      break;
    case "auth.ok":
      set(mt5LastHeartbeatAtom, Date.now());
      set(addMt5LogAtom, {
        level: "info",
        direction: "bridge",
        type: message.type,
        message: "MT5 bridge authenticated",
        requestId: message.id,
      });
      break;
    case "auth.reject": {
      const reason = getReason(message.payload);
      set(mt5LastErrorAtom, reason);
      set(addMt5LogAtom, {
        level: "error",
        direction: "bridge",
        type: message.type,
        message: `Auth rejected: ${reason}`,
        requestId: message.id,
      });
      set(pushToastAtom, {
        title: "MT5 auth rejected",
        message: reason,
        variant: "error",
      });
      break;
    }
    case "heartbeat":
      set(mt5LastHeartbeatAtom, Date.now());
      if (get(mt5StatusAtom) === "stale") set(mt5StatusAtom, "connected");
      break;
    case "error": {
      const payload = message.payload as Mt5ErrorPayload;
      const text = payload.message || payload.code || "MT5 bridge error";
      set(mt5LastErrorAtom, text);
      set(addMt5LogAtom, {
        level: "error",
        direction: "bridge",
        type: message.type,
        message: text,
        requestId: payload.requestId,
      });
      set(pushToastAtom, {
        title: "MT5 bridge error",
        message: text,
        variant: "error",
      });
      break;
    }
    case "account.snapshot": {
      const account = message.payload as Mt5AccountSnapshot;
      set(mt5AccountAtom, account);
      break;
    }
    case "risk.snapshot":
      set(mt5RiskSnapshotAtom, message.payload as Mt5RiskSnapshot);
      break;
    case "positions.snapshot":
      set(
        mt5PositionsAtom,
        Array.isArray((message.payload as { positions?: unknown }).positions)
          ? ((message.payload as { positions: Mt5Position[] }).positions ?? [])
          : [],
      );
      break;
    case "positions.update": {
      const payload = message.payload as {
        action: "upsert" | "remove";
        position: Mt5Position;
      };
      set(mt5PositionsAtom, (prev) => {
        if (!payload.position?.ticket) return prev;
        if (payload.action === "remove") {
          return prev.filter((p) => p.ticket !== payload.position.ticket);
        }
        const next = prev.filter((p) => p.ticket !== payload.position.ticket);
        return [payload.position, ...next];
      });
      break;
    }
    case "orders.snapshot":
      set(
        mt5PendingOrdersAtom,
        Array.isArray((message.payload as { orders?: unknown }).orders)
          ? ((message.payload as { orders: Mt5PendingOrder[] }).orders ?? [])
          : [],
      );
      break;
    case "orders.update": {
      const payload = message.payload as {
        action: "upsert" | "remove";
        order: Mt5PendingOrder;
      };
      set(mt5PendingOrdersAtom, (prev) => {
        if (!payload.order?.ticket) return prev;
        if (payload.action === "remove") {
          return prev.filter((order) => order.ticket !== payload.order.ticket);
        }
        const next = prev.filter((order) => order.ticket !== payload.order.ticket);
        return [payload.order, ...next];
      });
      break;
    }
    case "symbol.info": {
      const info = message.payload as Mt5SymbolInfo;
      if (info.chartSymbol) {
        set(mt5SymbolInfoAtom, (prev) => ({
          ...prev,
          [info.chartSymbol]: info,
        }));
      }
      break;
    }
    case "order.ack": {
      const payload = message.payload as Mt5OrderAck;
      set(mt5PendingCommandsAtom, (prev) =>
        prev.map((cmd) =>
          cmd.id === payload.requestId ? { ...cmd, status: "acked" } : cmd,
        ),
      );
      set(addMt5LogAtom, {
        level: "info",
        direction: "bridge",
        type: message.type,
        message: "Command accepted by bridge",
        requestId: payload.requestId,
        clientOrderId: payload.clientOrderId,
      });
      break;
    }
    case "order.reject": {
      const payload = message.payload as Mt5OrderReject;
      set(mt5PendingCommandsAtom, (prev) =>
        prev.filter((cmd) => cmd.id !== payload.requestId),
      );
      set(mt5LastErrorAtom, payload.message);
      set(addMt5LogAtom, {
        level: "error",
        direction: "bridge",
        type: message.type,
        message: payload.message,
        requestId: payload.requestId,
        clientOrderId: payload.clientOrderId,
      });
      set(pushToastAtom, {
        title: "MT5 order rejected",
        message: payload.message,
        variant: "error",
      });
      break;
    }
    case "execution.report": {
      const report = message.payload as Mt5ExecutionReport;
      if (report.clientOrderId) {
        set(mt5PendingCommandsAtom, (prev) =>
          prev.filter((cmd) => cmd.clientOrderId !== report.clientOrderId),
        );
      }
      set(addMt5LogAtom, {
        level: report.status === "rejected" ? "error" : "info",
        direction: "bridge",
        type: message.type,
        message: `${report.symbol} ${report.status}`,
        requestId: report.requestId,
        clientOrderId: report.clientOrderId,
      });
      break;
    }
    default:
      set(addMt5LogAtom, {
        level: "warn",
        direction: "bridge",
        type: message.type,
        message: `Unhandled MT5 message: ${message.type}`,
        requestId: message.id,
      });
  }
});

export const placeMt5OrderAtom = atom(
  null,
  (get, set, order: Mt5OrderRequest): boolean => {
    const error = validateMt5OrderState({
      enabled: get(mt5EnabledAtom),
      executionMode: get(executionModeAtom),
      status: get(mt5StatusAtom),
      account: get(mt5AccountAtom),
      expectedAccount: get(mt5ExpectedAccountAtom),
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

    const requestId = sendMt5Command("order.place", order);
    if (!requestId) {
      set(pushToastAtom, {
        title: "MT5 bridge unavailable",
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
        message: accessError ?? "Bridge is not connected.",
        variant: "warn",
      });
      return false;
    }
    const requestId = sendMt5Command("order.close", request);
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
        message: accessError ?? "Bridge is not connected.",
        variant: "warn",
      });
      return false;
    }
    const requestId = sendMt5Command("order.closeAll", request);
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
        message: accessError ?? "Bridge is not connected.",
        variant: "warn",
      });
      return false;
    }
    const requestId = sendMt5Command("order.modify", request);
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
        message: accessError ?? "Bridge is not connected.",
        variant: "warn",
      });
      return false;
    }
    const requestId = sendMt5Command("order.cancel", request);
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
  bridgeUrl: get(mt5BridgeUrlAtom),
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
  expectedAccount: get(mt5ExpectedAccountAtom),
  verifiedAt: get(mt5VerifiedAtAtom),
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
  expectedAccount: Mt5ExpectedAccount | null;
  symbolInfo?: Mt5SymbolInfo;
  order: Mt5OrderRequest;
}): string | null {
  const {
    enabled,
    executionMode,
    status,
    account,
    expectedAccount,
    symbolInfo,
    order,
  } = input;
  if (!enabled) return "MT5 bridge is disabled.";
  if (executionMode !== "mt5") return "Execution mode is not MT5.";
  if (status !== "connected") return "MT5 bridge is not connected.";
  if (!account) return "MT5 account snapshot is missing.";
  if (!expectedAccount) return "MT5 account has not been verified for this user.";
  const accountMismatch = mt5AccountMismatchReason(expectedAccount, account);
  if (accountMismatch) return accountMismatch;
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

function getReason(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "unknown";
  const reason = (payload as { reason?: unknown }).reason;
  return typeof reason === "string" ? reason : "unknown";
}
