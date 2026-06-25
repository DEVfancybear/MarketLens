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

export function conditionMet(
  condition: AlertCondition,
  target: number,
  prev: number | undefined,
  curr: number,
): boolean {
  switch (condition) {
    case 'above':
      return curr >= target;
    case 'below':
      return curr <= target;
    case 'crossUp':
      return prev !== undefined && prev < target && curr >= target;
    case 'crossDown':
      return prev !== undefined && prev > target && curr <= target;
    default:
      return false;
  }
}

export function isAlertTriggered(alert: Alert, prev: number | undefined, curr: number): boolean {
  return conditionMet(alert.condition, alert.price, prev, curr);
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
