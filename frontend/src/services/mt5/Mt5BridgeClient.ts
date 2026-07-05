import {
  buildMt5Heartbeat,
  buildMt5Message,
  MT5_CLIENT_NAME,
  MT5_COMMAND_TIMEOUT_MS,
  MT5_HEARTBEAT_MS,
  MT5_RECONNECT_DELAYS_MS,
  parseMt5Message,
} from "@/services/mt5/protocol";
import type {
  Mt5AuthRequest,
  Mt5ClientCommandPayload,
  Mt5ConnectionStatus,
  Mt5Message,
} from "@/types/mt5";

interface Mt5BridgeClientOptions {
  url: string;
  token?: string;
  onMessage: (message: Mt5Message) => void;
  onStatus: (status: Mt5ConnectionStatus) => void;
  onError: (message: string) => void;
  onCommandTimeout: (requestId: string) => void;
}

export class Mt5BridgeClient {
  private ws: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private heartbeatTimer: number | null = null;
  private commandTimers = new Map<string, number>();
  private reconnectAttempt = 0;
  private manualClose = false;
  private closeAfterError = false;

  constructor(private readonly options: Mt5BridgeClientOptions) {}

  connect() {
    if (typeof window === "undefined") return;
    if (!this.options.url) {
      this.options.onStatus("error");
      this.options.onError("MT5 bridge URL is missing");
      return;
    }
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }
    this.manualClose = false;
    this.closeAfterError = false;
    this.clearReconnect();
    this.options.onStatus(this.reconnectAttempt > 0 ? "reconnecting" : "connecting");

    try {
      this.ws = new WebSocket(this.options.url);
    } catch (error) {
      this.options.onError(error instanceof Error ? error.message : String(error));
      this.scheduleReconnect();
      return;
    }

    this.ws.onmessage = (event) => this.handleRawMessage(event.data);
    this.ws.onerror = () => {
      this.options.onError("MT5 bridge socket error");
    };
    this.ws.onclose = () => {
      this.stopHeartbeat();
      this.ws = null;
      this.clearCommandTimers();
      if (this.closeAfterError) {
        this.closeAfterError = false;
        return;
      }
      if (this.manualClose) {
        this.options.onStatus("disconnected");
        return;
      }
      this.scheduleReconnect();
    };
  }

  disconnect() {
    this.manualClose = true;
    this.clearReconnect();
    this.stopHeartbeat();
    this.clearCommandTimers();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.options.onStatus("disconnected");
  }

  destroy() {
    this.disconnect();
  }

  sendCommand(type: string, payload: Mt5ClientCommandPayload): string | null {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.options.onError("MT5 bridge is not connected");
      return null;
    }
    const msg = buildMt5Message(type, payload);
    this.ws.send(JSON.stringify(msg));
    if (msg.id) {
      const timeout = window.setTimeout(() => {
        this.commandTimers.delete(msg.id!);
        this.options.onCommandTimeout(msg.id!);
      }, MT5_COMMAND_TIMEOUT_MS);
      this.commandTimers.set(msg.id, timeout);
    }
    return msg.id ?? null;
  }

  private handleRawMessage(raw: unknown) {
    if (typeof raw !== "string") return;
    let message: Mt5Message;
    try {
      message = parseMt5Message(raw);
    } catch (error) {
      this.options.onError(error instanceof Error ? error.message : String(error));
      return;
    }

    if (message.type === "hello") {
      this.reconnectAttempt = 0;
      this.options.onStatus("authenticating");
      const payload: Mt5AuthRequest = {
        clientName: MT5_CLIENT_NAME,
        ...(this.options.token ? { token: this.options.token } : {}),
      };
      this.sendAuth(payload);
    } else if (message.type === "auth.ok") {
      this.options.onStatus("connected");
      this.startHeartbeat();
    } else if (message.type === "auth.reject") {
      this.options.onStatus("error");
      this.manualClose = true;
      this.closeAfterError = true;
      this.ws?.close();
    } else if (message.type === "order.ack" || message.type === "order.reject") {
      const id = message.id || getRequestId(message.payload);
      if (id) this.clearCommandTimer(id);
    } else if (message.type === "execution.report") {
      const id = getRequestId(message.payload);
      if (id) this.clearCommandTimer(id);
    }

    this.options.onMessage(message);
  }

  private sendAuth(payload: Mt5AuthRequest) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(buildMt5Message("auth.request", payload)));
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = window.setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      this.ws.send(JSON.stringify(buildMt5Heartbeat()));
    }, MT5_HEARTBEAT_MS);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer != null) {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect() {
    this.options.onStatus("reconnecting");
    const delay =
      MT5_RECONNECT_DELAYS_MS[
        Math.min(this.reconnectAttempt, MT5_RECONNECT_DELAYS_MS.length - 1)
      ];
    this.reconnectAttempt += 1;
    this.clearReconnect();
    this.reconnectTimer = window.setTimeout(() => this.connect(), delay + jitter());
  }

  private clearReconnect() {
    if (this.reconnectTimer != null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private clearCommandTimer(id: string) {
    const timeout = this.commandTimers.get(id);
    if (timeout != null) window.clearTimeout(timeout);
    this.commandTimers.delete(id);
  }

  private clearCommandTimers() {
    this.commandTimers.forEach((timeout) => window.clearTimeout(timeout));
    this.commandTimers.clear();
  }
}

function jitter() {
  return Math.floor(Math.random() * 250);
}

function getRequestId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const requestId = (payload as { requestId?: unknown }).requestId;
  return typeof requestId === "string" ? requestId : undefined;
}
