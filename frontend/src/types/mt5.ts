export type ExecutionMode = "simulator" | "mt5";

export type Mt5ConnectionStatus =
  | "disabled"
  | "disconnected"
  | "connecting"
  | "authenticating"
  | "connected"
  | "reconnecting"
  | "stale"
  | "error";

export type Mt5AccountMode = "demo" | "live" | "unknown";

export interface Mt5Message<T = unknown> {
  id?: string;
  type: string;
  version: 1;
  ts: number;
  payload: T;
}

export interface Mt5HelloPayload {
  bridgeId: string;
  bridgeVersion: string;
  serverTime: number;
  accountMode: Mt5AccountMode;
}

export interface Mt5AuthRequest {
  clientName: string;
  token?: string;
}

export interface Mt5AuthOkPayload {
  sessionId: string;
  expiresAt?: number;
}

export interface Mt5AuthRejectPayload {
  reason: string;
}

export interface Mt5ErrorPayload {
  code: string;
  message: string;
  requestId?: string;
}

export interface Mt5HeartbeatPayload {
  ts: number;
}

export interface Mt5AccountSnapshot {
  accountId: string;
  broker: string;
  server: string;
  mode: Mt5AccountMode;
  currency: string;
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  marginLevel?: number;
  leverage: number;
  tradeAllowed: boolean;
  updatedAt: number;
}

/** Optional FTMO/Position Sizer portfolio-risk snapshot from the bridge. */
export interface Mt5RiskSnapshot {
  accountSize?: number;
  accountSizeSource?: "fixed" | "equity";
  dailyLossLimit?: number;
  maxLossLimit?: number;
  dailyLossUsed?: number;
  dailyLossRemaining?: number;
  maxLossRemaining?: number;
  openRiskAtStops?: number;
  maxRiskPerTrade?: number;
  dailyOrderCount?: number;
  maxDailyOrders?: number;
  canTrade?: boolean;
  reason?: string | null;
  updatedAt?: number;
}

export interface Mt5SymbolInfo {
  chartSymbol: string;
  brokerSymbol: string;
  digits: number;
  point: number;
  lotStep: number;
  minLot: number;
  maxLot: number;
  brokerMaxLot?: number;
  bridgeMaxLot?: number;
  maxLotReason?: "broker" | "bridge";
  tickSize?: number;
  tickValue?: number;
  /** MT5 exposes direction-specific values for a tick.  Brokers may leave
   * these fields out, in which case the calculator falls back to tickValue. */
  tickValueLoss?: number;
  tickValueProfit?: number;
  /** Contract/margin metadata used by the Position Sizer-compatible math. */
  contractSize?: number;
  calcMode?: string | number;
  currencyBase?: string;
  currencyProfit?: string;
  currencyMargin?: string;
  marginInitial?: number;
  marginMaintenance?: number;
  marginHedged?: number;
  /** Optional broker spread in price units/points (metadata only). */
  spread?: number;
  stopLevel?: number;
  freezeLevel?: number;
  minStopDistance?: number;
  tradeMode: "disabled" | "longOnly" | "shortOnly" | "full";
  updatedAt: number;
}

export interface Mt5Position {
  ticket: string;
  symbol: string;
  brokerSymbol: string;
  side: "long" | "short";
  volume: number;
  openPrice: number;
  currentPrice: number;
  sl?: number;
  tp?: number;
  profit: number;
  swap?: number;
  commission?: number;
  magic?: number;
  comment?: string;
  openedAt: number;
  updatedAt: number;
}

export interface Mt5PendingOrder {
  ticket: string;
  symbol: string;
  brokerSymbol: string;
  side: "buy" | "sell";
  type: "limit" | "stop";
  volume: number;
  price: number;
  sl?: number;
  tp?: number;
  createdAt: number;
  updatedAt: number;
}

export interface Mt5OrderRequest {
  clientOrderId: string;
  chartSymbol: string;
  brokerSymbol: string;
  side: "buy" | "sell";
  type: "market" | "limit" | "stop";
  volume: number;
  price?: number;
  marketPrice?: number;
  sl?: number;
  tp?: number;
  deviationPoints?: number;
  comment?: string;
}

export interface Mt5ModifyRequest {
  clientOrderId: string;
  ticket: string;
  target: "position" | "pendingOrder";
  sl?: number;
  tp?: number;
  price?: number;
}

export interface Mt5CloseRequest {
  clientOrderId: string;
  ticket: string;
  volume?: number;
  deviationPoints?: number;
}

export interface Mt5CloseAllRequest {
  clientOrderId: string;
  chartSymbol?: string;
  brokerSymbol?: string;
  side?: "long" | "short";
  deviationPoints?: number;
}

export interface Mt5CancelRequest {
  clientOrderId: string;
  ticket: string;
}

export interface Mt5OrderAck {
  requestId: string;
  clientOrderId: string;
  acceptedAt: number;
}

export interface Mt5OrderReject {
  requestId: string;
  clientOrderId?: string;
  code: string;
  message: string;
}

export interface Mt5ExecutionReport {
  requestId?: string;
  clientOrderId?: string;
  ticket?: string;
  dealId?: string;
  symbol: string;
  brokerSymbol: string;
  status:
    | "filled"
    | "partiallyFilled"
    | "rejected"
    | "cancelled"
    | "modified"
    | "closed";
  side?: "buy" | "sell";
  volume?: number;
  price?: number;
  profit?: number;
  code?: string;
  message?: string;
  executedAt: number;
}

export type Mt5ClientCommandPayload =
  | Mt5AuthRequest
  | Mt5OrderRequest
  | Mt5ModifyRequest
  | Mt5CloseRequest
  | Mt5CloseAllRequest
  | Mt5CancelRequest
  | Mt5HeartbeatPayload;

export interface Mt5CommandLogEntry {
  id: string;
  time: number;
  level: "info" | "warn" | "error";
  direction: "client" | "bridge";
  type: string;
  message: string;
  requestId?: string;
  clientOrderId?: string;
}

export interface Mt5PendingCommand {
  id: string;
  type: string;
  clientOrderId?: string;
  sentAt: number;
  status: "sent" | "acked";
}
