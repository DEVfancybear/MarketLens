/**
 * Trade engine — pure position-sizing, risk and P/L math. No state; the store
 * owns positions and calls these helpers.
 */
import type { Candle, OrderRequest, Position, RiskMetrics, Side } from '../types';

export const dirSign = (side: Side): number => (side === 'long' ? 1 : -1);

/**
 * Compute risk metrics for a prospective order. Position size is derived from
 * the risk percentage and the stop distance; if no stop is given we fall back
 * to an explicit quantity (or 1 unit).
 */
export function computeRisk(
  order: Pick<OrderRequest, 'side' | 'price' | 'stopLoss' | 'takeProfit' | 'riskPct' | 'quantity'>,
  entryPrice: number,
  equity: number,
): RiskMetrics {
  const entry = Number.isFinite(order.price)
    ? Number(order.price)
    : Number.isFinite(entryPrice)
      ? Number(entryPrice)
      : 0;
  const riskPct = Number.isFinite(order.riskPct) ? Number(order.riskPct) : 1;
  const accountEquity = Number.isFinite(equity) ? Number(equity) : 0;
  const riskAmount = (accountEquity * riskPct) / 100;
  const stopLoss = Number.isFinite(order.stopLoss)
    ? Number(order.stopLoss)
    : undefined;
  const takeProfit = Number.isFinite(order.takeProfit)
    ? Number(order.takeProfit)
    : undefined;
  const stopDist =
    stopLoss != null && entry > 0 ? Math.abs(entry - stopLoss) : 0;

  let positionSize: number;
  if (Number.isFinite(order.quantity)) positionSize = Number(order.quantity);
  else if (stopDist > 0) positionSize = riskAmount / stopDist;
  else if (entry > 0)
    positionSize = riskAmount / Math.max(entry * 0.01, 1e-9); // 1% fallback stop
  else positionSize = 0;

  const rewardDist =
    takeProfit != null && entry > 0 ? Math.abs(takeProfit - entry) : 0;
  const rewardAmount = rewardDist * positionSize;
  const realRisk = stopDist > 0 ? stopDist * positionSize : riskAmount;
  const riskReward = realRisk > 0 ? rewardAmount / realRisk : 0;

  return {
    positionSize,
    riskPct,
    riskAmount: stopDist > 0 ? stopDist * positionSize : riskAmount,
    rewardAmount,
    riskReward,
  };
}

/** Mark-to-market unrealized P/L for an open position at a given price. */
export function unrealized(pos: Position, price: number): number {
  return (price - pos.entry) * pos.remaining * dirSign(pos.side);
}

/** Realized P/L for closing `qty` of a position at `price`. */
export function realizedFor(pos: Position, price: number, qty: number): number {
  return (price - pos.entry) * qty * dirSign(pos.side);
}

/** R-multiple of a closed trade given its initial risk amount. */
export function rMultiple(pnl: number, riskAmount: number): number {
  return riskAmount > 0 ? pnl / riskAmount : 0;
}

export type TriggerResult =
  | { type: 'fill'; price: number }
  | { type: 'stop'; price: number }
  | { type: 'target'; price: number }
  | null;

/**
 * Given a newly revealed candle, decide whether a PENDING order fills.
 * Uses the candle's high/low range — conservative intrabar assumption.
 */
export function checkPendingTrigger(pos: Position, candle: Candle): TriggerResult {
  if (pos.status !== 'pending' || pos.type === 'market') return null;
  const { high, low } = candle;
  if (pos.type === 'limit') {
    // Long limit fills if price drops to/through it; short limit if price rises to it.
    if (pos.side === 'long' && low <= pos.entry) return { type: 'fill', price: pos.entry };
    if (pos.side === 'short' && high >= pos.entry) return { type: 'fill', price: pos.entry };
  } else if (pos.type === 'stop') {
    // Stop entry: long fills on break above, short on break below.
    if (pos.side === 'long' && high >= pos.entry) return { type: 'fill', price: pos.entry };
    if (pos.side === 'short' && low <= pos.entry) return { type: 'fill', price: pos.entry };
  }
  return null;
}

/**
 * For an OPEN position, decide whether the candle hit the stop or target.
 * If both are within range we assume the stop is hit first (worst case).
 */
export function checkExit(pos: Position, candle: Candle): TriggerResult {
  if (pos.status !== 'open') return null;
  const { high, low } = candle;
  const sl = pos.stopLoss;
  const tp = pos.takeProfit;

  if (pos.side === 'long') {
    if (sl != null && low <= sl) return { type: 'stop', price: sl };
    if (tp != null && high >= tp) return { type: 'target', price: tp };
  } else {
    if (sl != null && high >= sl) return { type: 'stop', price: sl };
    if (tp != null && low <= tp) return { type: 'target', price: tp };
  }
  return null;
}
