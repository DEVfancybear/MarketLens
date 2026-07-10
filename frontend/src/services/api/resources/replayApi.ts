import { deleteJson, getJson, postJson } from "../client";

export interface ReplayDatasetSnapshot {
  id: string;
  dataKind: "bars" | "ticks";
  sourceTimeframe: string;
  baseIntervalSeconds: number;
  firstAvailableTime: string;
  lastAvailableTime: string;
  snapshotAt: string;
  rowCount: number;
  checksumSha256: string;
  status: "loading" | "ready" | "failed";
}

export interface ReplayTrackSnapshot {
  id: string;
  slot: number;
  symbol: string;
  provider: string;
  chartTimeframe: string;
  cursorSeq: number;
  visibleThrough: string;
  dataset: ReplayDatasetSnapshot;
}

export interface ReplaySessionSnapshot {
  id: string;
  status: "preparing" | "paused" | "playing" | "completed" | "closed" | "failed";
  mode: "single_chart" | "all_charts";
  generation: number;
  version: number;
  lastEventSeq: number;
  speed: number;
  replayIntervalSeconds: number;
  startTime: string;
  simulatedTime: string;
  endTime?: string;
  pauseReason?: string;
  tracks: ReplayTrackSnapshot[];
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
}

export interface ReplayCommandInput {
  idempotencyKey: string;
  expectedVersion?: number;
  type: "play" | "pause" | "step" | "seek" | "restart" | "close" | "set_speed";
  payload?: Record<string, unknown>;
}

export interface ReplayCommandResult {
  commandId: string;
  status: "applied";
  duplicate: boolean;
  snapshot: ReplaySessionSnapshot;
}

export interface ReplayEventEnvelope {
  sessionId: string;
  eventSeq: number;
  version: number;
  simulatedTime: string;
  type: "snapshot" | "state.changed" | "cursor.advanced" | "error" | string;
  payload: unknown;
}

export interface CreateReplaySessionInput {
  mode?: "single_chart";
  start: { kind: "time"; time: string };
  endTime?: string | null;
  replayInterval?: "auto";
  speed?: number;
  tracks: Array<{
    slot: 0;
    symbol: string;
    chartTimeframe: string;
  }>;
}

export function createReplaySession(
  input: CreateReplaySessionInput,
): Promise<ReplaySessionSnapshot> {
  // Dataset preparation may wait for the MT5 bridge's 60-second cold-history
  // window. Keep the browser just above the backend's 70-second request budget.
  return postJson("replay/sessions", input, {
    timeout: 75_000,
    retry: { limit: 0 },
  });
}

export function getReplaySession(
  sessionId: string,
): Promise<ReplaySessionSnapshot> {
  return getJson(`replay/sessions/${encodeURIComponent(sessionId)}`);
}

export function closeReplaySession(
  sessionId: string,
): Promise<ReplaySessionSnapshot> {
  return deleteJson(`replay/sessions/${encodeURIComponent(sessionId)}`);
}

export function sendReplayCommand(
  sessionId: string,
  input: ReplayCommandInput,
): Promise<ReplayCommandResult> {
  return postJson(
    `replay/sessions/${encodeURIComponent(sessionId)}/commands`,
    input,
    { retry: { limit: 0 } },
  );
}

export function getReplayEvents(
  sessionId: string,
  afterSeq: number,
): Promise<ReplayEventEnvelope[]> {
  return getJson(
    `replay/sessions/${encodeURIComponent(sessionId)}/events?afterSeq=${afterSeq}`,
    { retry: { limit: 0 } },
  );
}
