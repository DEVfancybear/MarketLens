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
import {
  conditionForTargetSide,
  isPriceConditionMet,
} from "@/services/alertConditions";
import {
  evaluateTechnicalAlert,
  type TechnicalAlertEvaluation,
  type TechnicalPricePoint,
} from "@/services/dynamicAlertTargets";
import type { TechnicalAlertEvidence } from "@/types/technicalAlerts";

export interface AlertPriceSnapshot {
  current: number;
  open?: number;
  high?: number;
  low?: number;
  candleTime?: number;
  candleHigh?: number;
  candleLow?: number;
  timestamp?: number;
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
  previousPoint?: TechnicalPricePoint,
): boolean {
  return evaluateAlert(alert, prev, price, previousPoint).triggered;
}

export function evaluateAlert(
  alert: Alert,
  prev: number | undefined,
  price: number | AlertPriceSnapshot,
  previousPoint?: TechnicalPricePoint,
): TechnicalAlertEvaluation {
  const current = typeof price === "number"
    ? { price, timestamp: Date.now() }
    : {
        price: price.current,
        timestamp: price.timestamp ?? price.candleTime ?? Date.now(),
      };
  if (!alert.technicalTarget) {
    const triggered = conditionMet(alert.condition, alert.price, prev, price);
    const evidence: TechnicalAlertEvidence = {
      ...(previousPoint
        ? {
            previous: {
              price: previousPoint.price,
              timestamp: previousPoint.timestamp >= 100_000_000_000
                ? previousPoint.timestamp / 1000
                : previousPoint.timestamp,
            },
          }
        : {}),
      current: {
        price: current.price,
        timestamp: current.timestamp >= 100_000_000_000
          ? current.timestamp / 1000
          : current.timestamp,
      },
    };
    return {
      triggered,
      targetPrice: alert.price,
      active: true,
      ...(triggered ? { evidence } : {}),
    };
  }
  return evaluateTechnicalAlert(alert.condition, alert.technicalTarget, previousPoint, current);
}

/**
 * Default condition for a one-click alert at `target`, inferred from the current
 * price: a target above current means "cross up", below means "cross down".
 * Used by the chart context menu, mirroring TradingView's quick-alert behaviour.
 */
export function inferCondition(target: number, current: number | undefined): AlertCondition {
  return conditionForTargetSide("crossUp", target, current);
}
