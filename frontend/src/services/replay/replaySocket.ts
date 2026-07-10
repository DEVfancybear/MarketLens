import { apiWebSocketUrl } from "@/services/api/client";
import {
  closeReplaySession,
  createReplaySession,
  forkReplaySession,
  getReplayEvents,
  getReplaySession,
  getReplayTrackBars,
  sendReplayCommand,
  type CreateReplaySessionInput,
  type ReplayCommandInput,
  type ReplayCommandResult,
  type ReplayEventEnvelope,
  type ReplaySessionSnapshot,
} from "@/services/api/resources/replayApi";
import {
  replayClientStore,
  type ReplayClientStore,
} from "@/store/replayClientStore";
import { withReplayVersionRetry } from "./replayCommandRetry";

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

let activeSocket: ReplaySocket | null = null;
let lifecycleVersion = 0;
let commandSequence = 0;
let commandQueue = Promise.resolve<unknown>(undefined);
let desiredSpeed: { sessionId: string; speed: number } | null = null;
let speedFlush: Promise<void> | null = null;

function commandKey(type: string): string {
  commandSequence += 1;
  return `replay:${type}:${Date.now().toString(36)}:${commandSequence}`;
}

export async function sendVersionedReplayCommand(
  sessionId: string,
  type: ReplayCommandInput["type"],
  payload?: Record<string, unknown>,
  scope = "control",
): Promise<ReplayCommandResult> {
  const snapshot = replayClientStore.getState().snapshot;
  if (!snapshot || snapshot.id !== sessionId) {
    throw new Error("Replay session is unavailable");
  }
  return withReplayVersionRetry(
    snapshot.version,
    (expectedVersion, attempt) => sendReplayCommand(sessionId, {
      idempotencyKey: commandKey(`${scope}:${type}:${attempt}`),
      expectedVersion,
      type,
      payload,
    }),
    async () => {
      const fresh = await getReplaySession(sessionId);
      replayClientStore.replaceSnapshot(fresh);
      return fresh.version;
    },
  );
}

async function hydrateSnapshotBars(snapshot: ReplaySessionSnapshot): Promise<void> {
  await Promise.all(snapshot.tracks.map(async (track) => {
    const response = await getReplayTrackBars(snapshot.id, track.id);
    replayClientStore.replaceBars(response.sessionId, response.trackId, response.bars);
  }));
}

async function activateSnapshot(
  snapshot: ReplaySessionSnapshot,
  expectedLifecycle: number,
): Promise<void> {
  if (expectedLifecycle !== lifecycleVersion) {
    await closeReplaySession(snapshot.id).catch(() => undefined);
    return;
  }
  replayClientStore.replaceSnapshot(snapshot);
  const socket = new ReplaySocket(snapshot.id);
  activeSocket = socket;
  await socket.connect();
}

/** Create the only active backend-owned Replay session. */
export async function startReplaySession(
  input: CreateReplaySessionInput,
): Promise<void> {
  const expectedLifecycle = ++lifecycleVersion;
  const previousId = replayClientStore.getState().snapshot?.id;
  activeSocket?.stop();
  activeSocket = null;
  replayClientStore.clear();
  replayClientStore.setConnection("connecting");
  if (previousId) void closeReplaySession(previousId).catch(() => undefined);

  try {
    const snapshot = await createReplaySession(input);
    await activateSnapshot(snapshot, expectedLifecycle);
  } catch (error) {
    if (expectedLifecycle !== lifecycleVersion) return;
    replayClientStore.setConnection(
      "error",
      error instanceof Error ? error.message : "Replay session could not be created",
    );
    throw error;
  }
}

/** Stop transport, clear the projection, and close the server session. */
export async function exitReplaySession(): Promise<void> {
  lifecycleVersion += 1;
  const sessionId = replayClientStore.getState().snapshot?.id;
  activeSocket?.stop();
  activeSocket = null;
  replayClientStore.clear();
  if (sessionId) await closeReplaySession(sessionId).catch(() => undefined);
}

/** Serialize commands so every request uses the latest authoritative version. */
export function runReplayCommand(
  type: ReplayCommandInput["type"],
  payload?: Record<string, unknown>,
): Promise<void> {
  const requestedSessionId = replayClientStore.getState().snapshot?.id;
  if (!requestedSessionId) return Promise.reject(new Error("Replay session is unavailable"));
  const run = async () => {
    const snapshot = replayClientStore.getState().snapshot;
    if (snapshot?.id !== requestedSessionId) return;
    if (!snapshot || snapshot.status === "closed" || snapshot.status === "failed") {
      throw new Error("Replay session is unavailable");
    }
    const result = await sendVersionedReplayCommand(snapshot.id, type, payload);
    replayClientStore.replaceSnapshot(result.snapshot);
    if (type === "step" || type === "seek" || type === "restart") {
      await hydrateSnapshotBars(result.snapshot);
    }
  };
  const next = commandQueue.then(run, run);
  commandQueue = next.catch((error) => {
    const current = replayClientStore.getState();
    replayClientStore.setConnection(
      current.connection,
      error instanceof Error ? error.message : "Replay command failed",
    );
  });
  return next;
}

/** Coalesce noisy range-input events so Play never waits behind stale speed commands. */
export function setActiveReplaySpeed(speed: number): Promise<void> {
  const snapshot = replayClientStore.getState().snapshot;
  if (!snapshot) return Promise.reject(new Error("Replay session is unavailable"));
  if (!Number.isFinite(speed) || speed <= 0 || speed > 100) {
    return Promise.reject(new Error("Replay speed must be between 0 and 100"));
  }
  if (!speedFlush && snapshot.speed === speed) return Promise.resolve();

  desiredSpeed = { sessionId: snapshot.id, speed };
  if (!speedFlush) {
    speedFlush = flushReplaySpeed().finally(() => {
      speedFlush = null;
      desiredSpeed = null;
    });
  }
  return speedFlush;
}

async function flushReplaySpeed(): Promise<void> {
  while (desiredSpeed) {
    const request = desiredSpeed;
    desiredSpeed = null;
    const snapshot = replayClientStore.getState().snapshot;
    if (!snapshot || snapshot.id !== request.sessionId) continue;
    if (snapshot.speed === request.speed) continue;
    await runReplayCommand("set_speed", { speed: request.speed });
  }
}

/** Fork at a new UTC time; backward movement never restores a local clock. */
export async function forkActiveReplay(time: string): Promise<void> {
  const current = replayClientStore.getState().snapshot;
  if (!current) throw new Error("Replay session is unavailable");
  const expectedLifecycle = ++lifecycleVersion;
  replayClientStore.setConnection("connecting");
  try {
    const snapshot = await forkReplaySession(current.id, time);
    activeSocket?.stop();
    activeSocket = null;
    await activateSnapshot(snapshot, expectedLifecycle);
    void closeReplaySession(current.id).catch(() => undefined);
  } catch (error) {
    if (expectedLifecycle === lifecycleVersion) {
      replayClientStore.setConnection(
        activeSocket ? "connected" : "error",
        error instanceof Error ? error.message : "Replay fork failed",
      );
    }
    throw error;
  }
}

export function stepActiveReplay(count: number): Promise<void> {
  if (count > 0) return runReplayCommand("step", { count });
  const projection = replayClientStore.getState();
  const track = projection.snapshot?.tracks[0];
  if (!track) return Promise.reject(new Error("Replay track is unavailable"));
  const bars = projection.barsByTrack[track.id] ?? [];
  const currentIndex = bars.findLastIndex(
    (bar) => Date.parse(bar.time) <= Date.parse(track.visibleThrough),
  );
  const target = bars[Math.max(0, currentIndex + count)];
  if (!target) return Promise.resolve();
  const trading = projection.snapshot?.trading;
  const hasTradingState = Boolean(
    trading?.fills.length ||
    trading?.orders.length ||
    trading?.positions.some((position) => Math.abs(position.netQuantity) > 1e-12),
  );
  return hasTradingState
    ? forkActiveReplay(target.time)
    : runReplayCommand("seek", { time: target.time });
}

function isTradingEvent(type: string): boolean {
  return type.startsWith("order.") || type === "fill.created" ||
    type === "position.updated" || type === "account.updated" ||
    type === "trading.reset";
}
