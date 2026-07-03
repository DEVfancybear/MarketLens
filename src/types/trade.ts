/** Trade simulator & journal types. */

export type Side = 'long' | 'short';
export type OrderType = 'market' | 'limit' | 'stop';
export type PositionStatus = 'pending' | 'open' | 'closed' | 'cancelled';

export interface OrderRequest {
  symbol: string;
  side: Side;
  type: OrderType;
  /** Required for limit/stop; for market it is filled at current price. */
  price?: number;
  stopLoss?: number;
  takeProfit?: number;
  /** Risk as a percent of account equity. Drives position sizing. */
  riskPct?: number;
  /** Explicit quantity overrides risk-based sizing if provided. */
  quantity?: number;
  notes?: string;
}

export interface Fill {
  time: number;
  price: number;
  quantity: number;
  /** Negative quantity = partial/full close. */
  kind: 'open' | 'partial' | 'close';
}

export interface Position {
  id: string;
  symbol: string;
  side: Side;
  type: OrderType;
  status: PositionStatus;
  /** Average entry price. */
  entry: number;
  quantity: number;
  /** Remaining open quantity. */
  remaining: number;
  stopLoss?: number;
  takeProfit?: number;
  riskPct?: number;
  riskAmount: number;
  openTime: number;
  closeTime?: number;
  /** Realized P/L on closed portions, account currency. */
  realizedPnl: number;
  /** Mark-to-market P/L on open remainder. */
  unrealizedPnl: number;
  fills: Fill[];
  notes?: string;
}

/** Partial order used to pre-fill the order ticket (e.g. from the chart context menu). */
export interface OrderPrefill {
  side?: Side;
  type?: OrderType;
  price?: number;
  stopLoss?: number;
  takeProfit?: number;
  riskPct?: number;
  quantity?: number;
  drawingId?: string;
  source?: 'context-menu' | 'position-drawing';
}

export interface RiskMetrics {
  positionSize: number;
  riskPct: number;
  riskAmount: number;
  rewardAmount: number;
  riskReward: number;
}

export interface JournalEntry {
  id: string;
  symbol: string;
  side: Side;
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  pnl: number;
  /** Realized R multiple. */
  rr: number;
  riskAmount: number;
  notes?: string;
  tags?: string[];
  /** IndexedDB keys of attached screenshots. */
  screenshots?: ScreenshotRef[];
}

export type ScreenshotPhase = 'before' | 'after-entry' | 'after-exit';

export interface ScreenshotRef {
  id: string;
  phase: ScreenshotPhase;
  /** Object URL or data URL. */
  thumb: string;
  createdAt: number;
}
