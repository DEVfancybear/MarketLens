import type {
  Mt5CancelRequest,
  Mt5ClientCommandPayload,
  Mt5CloseAllRequest,
  Mt5CloseRequest,
  Mt5Message,
  Mt5ModifyRequest,
  Mt5OrderRequest,
} from "@/types/mt5";

export const MT5_PROTOCOL_VERSION = 1 as const;
export const MT5_CLIENT_NAME = "smc-trading-terminal";
export const MT5_HEARTBEAT_MS = 5_000;
export const MT5_STALE_AFTER_MS = 20_000;
export const MT5_COMMAND_TIMEOUT_MS = 10_000;
export const MT5_RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000];

let requestSeq = 0;
let clientOrderSeq = 0;

export function makeRequestId(prefix = "mt5_req"): string {
  requestSeq += 1;
  return `${prefix}_${Date.now().toString(36)}_${requestSeq.toString(36)}`;
}

export function makeClientOrderId(prefix = "mt5_ord"): string {
  clientOrderSeq += 1;
  return `${prefix}_${Date.now().toString(36)}_${clientOrderSeq.toString(36)}`;
}

export function buildMt5Message<T extends Mt5ClientCommandPayload>(
  type: string,
  payload: T,
  id = makeRequestId(),
): Mt5Message<T> {
  return {
    id,
    type,
    version: MT5_PROTOCOL_VERSION,
    ts: Date.now(),
    payload,
  };
}

export function buildMt5Heartbeat(): Mt5Message<{ ts: number }> {
  return {
    type: "heartbeat",
    version: MT5_PROTOCOL_VERSION,
    ts: Date.now(),
    payload: { ts: Date.now() },
  };
}

export function isMt5Message(value: unknown): value is Mt5Message {
  if (!value || typeof value !== "object") return false;
  const msg = value as Partial<Mt5Message>;
  return (
    typeof msg.type === "string" &&
    msg.version === MT5_PROTOCOL_VERSION &&
    typeof msg.ts === "number" &&
    "payload" in msg
  );
}

export function parseMt5Message(raw: string): Mt5Message {
  const parsed = JSON.parse(raw) as unknown;
  if (!isMt5Message(parsed)) {
    throw new Error("Invalid or unsupported MT5 bridge message");
  }
  return parsed;
}

export function normalizeMt5Side(side: "long" | "short"): "buy" | "sell" {
  return side === "long" ? "buy" : "sell";
}

export type Mt5CommandPayloadByType = {
  "order.place": Mt5OrderRequest;
  "order.modify": Mt5ModifyRequest;
  "order.close": Mt5CloseRequest;
  "order.closeAll": Mt5CloseAllRequest;
  "order.cancel": Mt5CancelRequest;
};
