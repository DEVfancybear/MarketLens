import { apiWebSocketUrl } from "@/services/api/client";
import {
  getReplayEvents,
  getReplaySession,
  type ReplayEventEnvelope,
  type ReplaySessionSnapshot,
} from "@/services/api/resources/replayApi";
import {
  replayClientStore,
  type ReplayClientStore,
} from "@/store/replayClientStore";

export class ReplaySocket {
  private socket: WebSocket | null = null;
  private stopped = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private applyChain = Promise.resolve();

  constructor(
    private readonly sessionId: string,
    private readonly store: ReplayClientStore = replayClientStore,
  ) {}

  async connect(): Promise<void> {
    this.stopped = false;
    this.store.setConnection("connecting");
    try {
      const snapshot = await getReplaySession(this.sessionId);
      this.store.replaceSnapshot(snapshot);
      this.open(snapshot);
    } catch (error) {
      this.store.setConnection(
        "error",
        error instanceof Error ? error.message : "replay connection failed",
      );
      throw error;
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.socket?.close();
    this.socket = null;
    this.store.setConnection("disconnected");
  }

  private open(snapshot: ReplaySessionSnapshot): void {
    if (this.stopped) return;
    const url = apiWebSocketUrl(
      `replay/sessions/${encodeURIComponent(this.sessionId)}/stream?afterSeq=${snapshot.lastEventSeq}`,
    );
    const socket = new WebSocket(url);
    this.socket = socket;
    socket.onopen = () => this.store.setConnection("connected");
    socket.onmessage = (message) => {
      this.applyChain = this.applyChain.then(() =>
        this.handle(JSON.parse(String(message.data)) as ReplayEventEnvelope),
      ).catch((error) => {
        this.store.setConnection(
          "error",
          error instanceof Error ? error.message : "invalid replay event",
        );
        socket.close();
      });
    };
    socket.onerror = () => this.store.setConnection("error", "replay socket error");
    socket.onclose = () => {
      if (this.socket === socket) this.socket = null;
      if (!this.stopped) {
        this.store.setConnection("disconnected");
        this.reconnectTimer = setTimeout(() => void this.reconnect(), 1000);
      }
    };
  }

  private async reconnect(): Promise<void> {
    if (this.stopped) return;
    try {
      const snapshot = await getReplaySession(this.sessionId);
      this.store.replaceSnapshot(snapshot);
      this.open(snapshot);
    } catch (error) {
      this.store.setConnection("error", error instanceof Error ? error.message : "reconnect failed");
      this.reconnectTimer = setTimeout(() => void this.reconnect(), 3000);
    }
  }

  private async handle(event: ReplayEventEnvelope): Promise<void> {
    if (event.type === "snapshot") {
      this.store.replaceSnapshot(event.payload as ReplaySessionSnapshot);
      return;
    }
    const result = this.store.applyEvent(event);
    if (result !== "gap") return;
    this.store.setConnection("recovering");
    const after = this.store.getState().snapshot?.lastEventSeq ?? 0;
    const recovered = await getReplayEvents(this.sessionId, after);
    for (const missing of recovered) {
      const applied = this.store.applyEvent(missing);
      if (applied === "gap" || applied === "invalid") {
        this.store.replaceSnapshot(await getReplaySession(this.sessionId));
        break;
      }
    }
    const retry = this.store.applyEvent(event);
    if (retry === "gap") this.store.replaceSnapshot(await getReplaySession(this.sessionId));
    this.store.setConnection("connected");
  }
}
