import type {
  ReplayEventEnvelope,
  ReplaySessionSnapshot,
} from "@/services/api/resources/replayApi";

export type ReplayConnectionState =
  | "idle"
  | "connecting"
  | "connected"
  | "recovering"
  | "disconnected"
  | "error";

export type ReplayEventApplyResult = "applied" | "duplicate" | "gap" | "invalid";

export interface ReplayClientProjection {
  snapshot: ReplaySessionSnapshot | null;
  connection: ReplayConnectionState;
  error: string | null;
}

type Listener = (projection: ReplayClientProjection) => void;

export class ReplayClientStore {
  private projection: ReplayClientProjection = {
    snapshot: null,
    connection: "idle",
    error: null,
  };
  private listeners = new Set<Listener>();

  getState(): ReplayClientProjection {
    return this.projection;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setConnection(connection: ReplayConnectionState, error: string | null = null): void {
    this.projection = { ...this.projection, connection, error };
    this.emit();
  }

  replaceSnapshot(snapshot: ReplaySessionSnapshot): void {
    this.projection = { ...this.projection, snapshot, error: null };
    this.emit();
  }

  clear(): void {
    this.projection = { snapshot: null, connection: "idle", error: null };
    this.emit();
  }

  applyEvent(event: ReplayEventEnvelope): ReplayEventApplyResult {
    const current = this.projection.snapshot;
    if (!current || current.id !== event.sessionId) return "invalid";
    const expected = current.lastEventSeq + 1;
    if (event.eventSeq < expected) return "duplicate";
    if (event.eventSeq > expected) return "gap";

    let next: ReplaySessionSnapshot = {
      ...current,
      version: event.version,
      lastEventSeq: event.eventSeq,
      simulatedTime: event.simulatedTime,
    };
    if (event.type === "cursor.advanced") {
      const payload = event.payload as {
        trackId?: string;
        cursorSeq?: number;
        visibleThrough?: string;
      };
      if (!payload.trackId || typeof payload.cursorSeq !== "number" || !payload.visibleThrough) {
        return "invalid";
      }
      next = {
        ...next,
        tracks: next.tracks.map((track) =>
          track.id === payload.trackId
            ? { ...track, cursorSeq: payload.cursorSeq!, visibleThrough: payload.visibleThrough! }
            : track,
        ),
      };
    } else if (event.type === "state.changed") {
      const payload = event.payload as {
        status?: ReplaySessionSnapshot["status"];
        speed?: number;
        pauseReason?: string | null;
      };
      if (!payload.status || typeof payload.speed !== "number") return "invalid";
      next = {
        ...next,
        status: payload.status,
        speed: payload.speed,
        pauseReason: payload.pauseReason ?? undefined,
      };
    }
    this.projection = { ...this.projection, snapshot: next, error: null };
    this.emit();
    return "applied";
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.projection);
  }
}

export const replayClientStore = new ReplayClientStore();
