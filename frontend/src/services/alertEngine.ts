/**
 * Alert Engine — pure condition evaluation (Phase 2).
 *
 * No state, no I/O. Given an alert and the previous/current price, decide
 * whether it should fire. The React layer (`hooks/useAlertEngine.ts`) owns the
 * price stream (from `marketDataStore`), the previous-price memory, and the
 * once-only / re-arm gating.
 *
 *  above      → current ≥ target                      (level; fires when first met)
 *  below      → current ≤ target
 *  crossUp    → previous < target AND current ≥ target (edge; needs a prev tick)
 *  crossDown  → previous > target AND current ≤ target
 */
import type { Alert, AlertCondition } from '@/store/alertStore';
import { isPriceConditionMet } from "@/services/alertConditions";

export interface AlertPriceSnapshot {
  current: number;
  open?: number;
  high?: number;
  low?: number;
  candleTime?: number;
  candleHigh?: number;
  candleLow?: number;
}

export function conditionMet(
  condition: AlertCondition,
  target: number,
  prev: number | undefined,
  price: number | AlertPriceSnapshot,
): boolean {
  const current = typeof price === "number" ? price : price.current;
  return isPriceConditionMet(condition, target, prev, current);
}

export function isAlertTriggered(
  alert: Alert,
  prev: number | undefined,
  price: number | AlertPriceSnapshot,
): boolean {
  return conditionMet(alert.condition, alert.price, prev, price);
}

/**
 * Default condition for a one-click alert at `target`, inferred from the current
 * price: a target above current means "cross up", below means "cross down".
 * Used by the chart context menu, mirroring TradingView's quick-alert behaviour.
 */
export function inferCondition(target: number, current: number | undefined): AlertCondition {
  if (current === undefined) return 'crossUp';
  return target >= current ? 'crossUp' : 'crossDown';
}
