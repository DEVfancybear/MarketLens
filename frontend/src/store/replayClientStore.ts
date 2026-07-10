import type {
  ReplayBar,
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
  barsByTrack: Record<string, ReplayBar[]>;
  connection: ReplayConnectionState;
  error: string | null;
}

type Listener = (projection: ReplayClientProjection) => void;

export class ReplayClientStore {
  private projection: ReplayClientProjection = {
    snapshot: null,
    barsByTrack: {},
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
    const trackIds = new Set(snapshot.tracks.map((track) => track.id));
    const barsByTrack = Object.fromEntries(
      Object.entries(this.projection.barsByTrack).filter(([trackId]) => trackIds.has(trackId)),
    );
    this.projection = { ...this.projection, snapshot, barsByTrack, error: null };
    this.emit();
  }

  replaceBars(sessionId: string, trackId: string, bars: ReplayBar[]): boolean {
    if (this.projection.snapshot?.id !== sessionId) return false;
    this.projection = {
      ...this.projection,
      barsByTrack: { ...this.projection.barsByTrack, [trackId]: [...bars] },
      error: null,
    };
    this.emit();
    return true;
  }

  clear(): void {
    this.projection = { snapshot: null, barsByTrack: {}, connection: "idle", error: null };
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
    } else if (event.type === "track.bar.upsert") {
      const payload = event.payload as { trackId?: string; bar?: ReplayBar };
      if (!payload.trackId || !isReplayBar(payload.bar)) return "invalid";
      const existing = this.projection.barsByTrack[payload.trackId] ?? [];
      const index = existing.findIndex((bar) => bar.time === payload.bar!.time);
      const bars = index >= 0
        ? existing.map((bar, currentIndex) => currentIndex === index ? payload.bar! : bar)
        : [...existing, payload.bar].sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
      this.projection = {
        ...this.projection,
        barsByTrack: { ...this.projection.barsByTrack, [payload.trackId]: bars },
      };
    } else if (event.type === "track.reset") {
      const payload = event.payload as { trackId?: string };
      if (!payload.trackId) return "invalid";
      this.projection = {
        ...this.projection,
        barsByTrack: { ...this.projection.barsByTrack, [payload.trackId]: [] },
      };
    } else if (event.type === "state.changed") {
      const payload = event.payload as {
        status?: ReplaySessionSnapshot["status"];
        speed?: number;
        pauseReason?: string | null;
        replayIntervalSeconds?: number;
      };
      if (!payload.status || typeof payload.speed !== "number") return "invalid";
      next = {
        ...next,
        status: payload.status,
        speed: payload.speed,
        pauseReason: payload.pauseReason ?? undefined,
        replayIntervalSeconds: payload.replayIntervalSeconds ?? next.replayIntervalSeconds,
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

function isReplayBar(value: ReplayBar | undefined): value is ReplayBar {
  return !!value && typeof value.time === "string" &&
    [value.open, value.high, value.low, value.close, value.volume].every(Number.isFinite) &&
    typeof value.complete === "boolean";
}
