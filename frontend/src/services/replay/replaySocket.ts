import { apiWebSocketUrl } from "@/services/api/client";
import {
  getReplayEvents,
  getReplaySession,
  getReplayTrackBars,
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
      await this.hydrateBars(snapshot);
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
      await this.hydrateBars(snapshot);
      this.open(snapshot);
    } catch (error) {
      this.store.setConnection("error", error instanceof Error ? error.message : "reconnect failed");
      this.reconnectTimer = setTimeout(() => void this.reconnect(), 3000);
    }
  }

  private async handle(event: ReplayEventEnvelope): Promise<void> {
    if (event.type === "snapshot") {
      const snapshot = event.payload as ReplaySessionSnapshot;
      this.store.replaceSnapshot(snapshot);
      await this.hydrateBars(snapshot);
      return;
    }
    const result = this.store.applyEvent(event);
    if (result !== "gap") {
      if (result === "applied" && event.type === "track.reset") {
        const trackId = (event.payload as { trackId?: string }).trackId;
        if (trackId) await this.hydrateTrack(trackId);
      }
      if (result === "applied" && isTradingEvent(event.type)) {
        await this.replaceFromServer();
      }
      return;
    }
    this.store.setConnection("recovering");
    const after = this.store.getState().snapshot?.lastEventSeq ?? 0;
    const recovered = await getReplayEvents(this.sessionId, after);
    for (const missing of recovered) {
      const applied = this.store.applyEvent(missing);
      if (applied === "gap" || applied === "invalid") {
        await this.replaceFromServer();
        break;
      }
      if (applied === "applied" && missing.type === "track.reset") {
        const trackId = (missing.payload as { trackId?: string }).trackId;
        if (trackId) await this.hydrateTrack(trackId);
      }
    }
    const retry = this.store.applyEvent(event);
    if (retry === "gap") await this.replaceFromServer();
    this.store.setConnection("connected");
  }

  private async replaceFromServer(): Promise<void> {
    const snapshot = await getReplaySession(this.sessionId);
    this.store.replaceSnapshot(snapshot);
    await this.hydrateBars(snapshot);
  }

  private async hydrateBars(snapshot: ReplaySessionSnapshot): Promise<void> {
    await Promise.all(snapshot.tracks.map((track) => this.hydrateTrack(track.id)));
  }

  private async hydrateTrack(trackId: string): Promise<void> {
    const response = await getReplayTrackBars(this.sessionId, trackId);
    this.store.replaceBars(response.sessionId, response.trackId, response.bars);
  }
}

function isTradingEvent(type: string): boolean {
  return type.startsWith("order.") || type === "fill.created" ||
    type === "position.updated" || type === "account.updated" ||
    type === "trading.reset";
}
