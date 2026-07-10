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

export interface ReplayBar {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  complete: boolean;
}

export interface ReplayRevealedBarsSnapshot {
  sessionId: string;
  trackId: string;
  chartTimeframe: string;
  cursorSeq: number;
  visibleThrough: string;
  bars: ReplayBar[];
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
  trading?: ReplayTradingSnapshot;
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
}

export interface ReplayAccountSnapshot {
  baseCurrency: string;
  startingEquity: number;
  balance: number;
  equity: number;
}

export interface ReplayOrderSnapshot {
  id: string;
  trackId: string;
  clientOrderId: string;
  side: "buy" | "sell";
  orderType: "market" | "limit" | "stop" | "stop_limit";
  status: "pending" | "partially_filled" | "filled" | "cancelled" | "rejected";
  quantity: number;
  filledQuantity: number;
  limitPrice?: number;
  stopPrice?: number;
  takeProfit?: number;
  stopLoss?: number;
  submittedAt: string;
}

export interface ReplayFillSnapshot {
  id: string;
  orderId: string;
  trackId: string;
  datasetSeq: number;
  simulatedAt: string;
  price: number;
  quantity: number;
  commission: number;
}

export interface ReplayPositionSnapshot {
  id: string;
  trackId: string;
  symbol: string;
  netQuantity: number;
  averagePrice: number;
  realizedPnl: number;
  unrealizedPnl: number;
  stopLoss?: number;
  takeProfit?: number;
}

export interface ReplayTradingSnapshot {
  account: ReplayAccountSnapshot;
  orders: ReplayOrderSnapshot[];
  fills: ReplayFillSnapshot[];
  positions: ReplayPositionSnapshot[];
}

export interface ReplayReport {
  sessionId: string;
  generatedAt: string;
  account: ReplayAccountSnapshot;
  closedTrades: number;
  winningTrades: number;
  losingTrades: number;
  netPnl: number;
  maxDrawdown: number;
  fills: ReplayFillSnapshot[];
}

export interface ReplayCommandInput {
  idempotencyKey: string;
  expectedVersion?: number;
  type: "play" | "pause" | "step" | "seek" | "restart" | "close" | "set_speed" | "set_replay_interval" |
    "place_order" | "cancel_order" | "close_position" | "update_order" | "reset_trading";
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
  replayInterval?: "auto" | "1m" | "3m" | "5m" | "15m" | "30m" | "1H" | "2H" | "4H" | "1D" | "1W";
  speed?: number;
  tracks: Array<{
    slot: 0;
    symbol: string;
    chartTimeframe: string;
  }>;
  trading?: {
    enabled: boolean;
    startingEquity?: string;
    baseCurrency?: string;
    commission?: { kind: "per_unit"; value: string };
    barPathModel?: "conservative_ohlc";
  };
}

export function getReplayReport(sessionId: string): Promise<ReplayReport> {
  return getJson(`replay/sessions/${encodeURIComponent(sessionId)}/report`);
}

export function forkReplaySession(
  sessionId: string,
  time: string,
): Promise<ReplaySessionSnapshot> {
  return postJson(`replay/sessions/${encodeURIComponent(sessionId)}/fork`, { time }, {
    retry: { limit: 0 },
  });
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

export function getReplayTrackBars(
  sessionId: string,
  trackId: string,
  timeframe?: string,
): Promise<ReplayRevealedBarsSnapshot> {
  const query = timeframe ? `?timeframe=${encodeURIComponent(timeframe)}` : "";
  return getJson(
    `replay/sessions/${encodeURIComponent(sessionId)}/tracks/${encodeURIComponent(trackId)}/bars${query}`,
    { retry: { limit: 0 } },
  );
}
