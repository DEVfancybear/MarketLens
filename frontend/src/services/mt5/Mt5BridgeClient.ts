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
  getToken: () => Promise<string>;
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
  private authenticated = false;
  private authSequence = 0;

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
    this.authenticated = false;
    this.authSequence += 1;
    this.clearReconnect();
    this.options.onStatus(this.reconnectAttempt > 0 ? "reconnecting" : "connecting");

    try {
      this.ws = new WebSocket(this.options.url);
    } catch (error) {
      this.options.onError(error instanceof Error ? error.message : String(error));
      this.scheduleReconnect();
      return;
    }

    this.ws.onmessage = (event) => void this.handleRawMessage(event.data);
    this.ws.onerror = () => void this.reportSocketError();
    this.ws.onclose = () => {
      this.stopHeartbeat();
      this.authenticated = false;
      this.authSequence += 1;
      this.ws = null;
      this.clearCommandTimers();
      if (this.manualClose) {
        this.options.onStatus("disconnected");
        return;
      }
      this.scheduleReconnect();
    };
  }

  disconnect() {
    this.manualClose = true;
    this.authenticated = false;
    this.authSequence += 1;
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
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.authenticated) {
      this.options.onError("MT5 Connector is not authenticated");
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

  private async handleRawMessage(raw: unknown) {
    if (typeof raw !== "string") return;
    let message: Mt5Message;
    try {
      message = parseMt5Message(raw);
    } catch (error) {
      this.options.onError(error instanceof Error ? error.message : String(error));
      return;
    }

    if (message.type === "hello") {
      this.options.onStatus("authenticating");
      await this.authenticate();
    } else if (message.type === "auth.ok") {
      this.reconnectAttempt = 0;
      this.authenticated = true;
      this.options.onStatus("connected");
      this.startHeartbeat();
    } else if (message.type === "auth.reject") {
      this.authenticated = false;
      this.options.onStatus("error");
      this.options.onError(authRejectMessage(message.payload));
      this.ws?.close();
    } else if (message.type === "order.reject") {
      const id = message.id || getRequestId(message.payload);
      if (id) this.clearCommandTimer(id);
    } else if (message.type === "execution.report") {
      const id = getRequestId(message.payload);
      if (id) this.clearCommandTimer(id);
    }

    this.options.onMessage(message);
  }

  private async authenticate() {
    const socket = this.ws;
    const sequence = this.authSequence;
    try {
      const token = (await this.options.getToken()).trim();
      if (!token) throw new Error("empty pairing ticket");
      if (
        sequence !== this.authSequence ||
        socket !== this.ws ||
        !socket ||
        socket.readyState !== WebSocket.OPEN
      ) {
        return;
      }
      const payload: Mt5AuthRequest = {
        clientName: MT5_CLIENT_NAME,
        token,
      };
      this.sendAuth(payload);
    } catch {
      if (sequence !== this.authSequence || socket !== this.ws) return;
      this.options.onStatus("error");
      this.options.onError(
        "Unable to pair MT5 Connector with this account. Verify MT5 and try again.",
      );
      socket?.close();
    }
  }

  private async reportSocketError() {
    const permission = await loopbackPermissionState();
    if (permission === "denied") {
      this.options.onError(
        "Local device access is blocked. Allow Local Network Access for this site, then reconnect MT5 Connector.",
      );
      return;
    }
    this.options.onError(
      "MT5 Connector is not reachable. Start the Connector and allow the browser's Local Network Access prompt.",
    );
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

function authRejectMessage(payload: unknown): string {
  const reason =
    payload && typeof payload === "object"
      ? (payload as { reason?: unknown }).reason
      : undefined;
  if (reason === "account_mismatch") {
    return "The MT5 Connector is attached to a different account. Open the verified account in MT5 and reconnect.";
  }
  if (reason === "account_unavailable") {
    return "Open MetaTrader 5, sign in with the verified account, then reconnect the Connector.";
  }
  return "MT5 Connector pairing was rejected. Reconnect to request a new secure ticket.";
}

async function loopbackPermissionState(): Promise<PermissionState | null> {
  if (typeof navigator === "undefined" || !navigator.permissions) return null;
  try {
    const permissions = navigator.permissions as Permissions & {
      query(descriptor: { name: string }): Promise<PermissionStatus>;
    };
    const status = await permissions.query({ name: "loopback-network" });
    return status.state;
  } catch {
    try {
      const permissions = navigator.permissions as Permissions & {
        query(descriptor: { name: string }): Promise<PermissionStatus>;
      };
      const status = await permissions.query({ name: "local-network-access" });
      return status.state;
    } catch {
      return null;
    }
  }
}
