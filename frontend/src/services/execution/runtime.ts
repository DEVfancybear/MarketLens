import type {
  Mt5CancelRequest,
  Mt5CloseAllRequest,
  Mt5CloseRequest,
  Mt5ModifyRequest,
  Mt5OrderRequest,
} from "@/types/mt5";

export type ExecutionClientCommandPayload =
  | Mt5OrderRequest
  | Mt5ModifyRequest
  | Mt5CloseRequest
  | Mt5CloseAllRequest
  | Mt5CancelRequest;

/**
 * Temporary UI boundary while the authenticated execution API is connected.
 * It is venue-neutral: MT5 EA and native exchange adapters register through the
 * same command transport.
 */
export type ExecutionCommandSender = (
  type: string,
  payload: ExecutionClientCommandPayload,
) => string | null;

interface ExecutionRuntimeHandlers {
  send: ExecutionCommandSender;
  connect: () => void;
  disconnect: () => void;
}

let handlers: ExecutionRuntimeHandlers | null = null;

export function setExecutionRuntimeHandlers(
  next: ExecutionRuntimeHandlers | null,
) {
  handlers = next;
}

export function sendExecutionCommand(
  type: string,
  payload: ExecutionClientCommandPayload,
): string | null {
  return handlers?.send(type, payload) ?? null;
}

export function connectExecutionGateway() {
  handlers?.connect();
}

export function disconnectExecutionGateway() {
  handlers?.disconnect();
}
