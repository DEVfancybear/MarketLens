import type { Mt5ClientCommandPayload } from "@/types/mt5";

export type Mt5CommandSender = (
  type: string,
  payload: Mt5ClientCommandPayload,
) => string | null;

interface Mt5RuntimeHandlers {
  send: Mt5CommandSender;
  connect: () => void;
  disconnect: () => void;
}

let handlers: Mt5RuntimeHandlers | null = null;

export function setMt5RuntimeHandlers(next: Mt5RuntimeHandlers | null) {
  handlers = next;
}

export function sendMt5Command(
  type: string,
  payload: Mt5ClientCommandPayload,
): string | null {
  return handlers?.send(type, payload) ?? null;
}

export function connectMt5Bridge() {
  handlers?.connect();
}

export function disconnectMt5Bridge() {
  handlers?.disconnect();
}
