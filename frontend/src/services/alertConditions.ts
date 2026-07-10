export type PriceAlertCondition = "above" | "below" | "crossUp" | "crossDown";

export function alertArmingRevision(
  condition: PriceAlertCondition,
  symbol: string,
  target: number,
  recurring: boolean,
  updatedAt: number,
): string {
  return [condition, symbol, target, recurring, updatedAt].join(":");
}

export function previousPriceForRevision(
  revision: string,
  previousRevision: string | undefined,
  previousPrice: number | undefined,
): number | undefined {
  return revision === previousRevision ? previousPrice : undefined;
}

export function conditionForTargetSide(
  base: PriceAlertCondition,
  target: number,
  current: number | undefined,
): PriceAlertCondition {
  if (current === undefined) return base;
  const targetIsAbove = target >= current;
  if (base === "crossUp" || base === "crossDown") {
    return targetIsAbove ? "crossUp" : "crossDown";
  }
  return targetIsAbove ? "above" : "below";
}

export function alertLineRenderKey(
  alerts: Array<{ id: string; condition: PriceAlertCondition; price: number }>,
): string {
  return alerts
    .map((alert) => `${alert.id}:${alert.condition}:${alert.price}`)
    .join("|");
}

export function hasAlertArmingChange(
  current: {
    symbol: string;
    condition: PriceAlertCondition;
    price: number;
    recurring: boolean;
    enabled: boolean;
  },
  patch: Partial<{
    symbol: string;
    condition: PriceAlertCondition;
    price: number;
    recurring: boolean;
    enabled: boolean;
  }>,
): boolean {
  return (
    (patch.symbol !== undefined && patch.symbol !== current.symbol) ||
    (patch.condition !== undefined && patch.condition !== current.condition) ||
    (patch.price !== undefined && patch.price !== current.price) ||
    (patch.recurring !== undefined && patch.recurring !== current.recurring) ||
    (patch.enabled === true && !current.enabled)
  );
}

export function isPriceConditionMet(
  condition: PriceAlertCondition,
  target: number,
  previous: number | undefined,
  current: number,
): boolean {
  if (!Number.isFinite(target) || !Number.isFinite(current)) return false;

  switch (condition) {
    case "above":
      return current >= target;
    case "below":
      return current <= target;
    case "crossUp":
      return previous !== undefined && previous < target && current >= target;
    case "crossDown":
      return previous !== undefined && previous > target && current <= target;
  }
}

export interface AlertPricePoint {
  price: number;
  timestamp: number;
}

export function findPriceConditionTrigger(
  condition: PriceAlertCondition,
  target: number,
  previousPrice: number | undefined,
  points: AlertPricePoint[],
): AlertPricePoint | undefined {
  let previous = previousPrice;
  for (const point of points) {
    if (isPriceConditionMet(condition, target, previous, point.price)) {
      return point;
    }
    previous = point.price;
  }
  return undefined;
}

/** Final persistence guard shared by live and reconciled triggers. */
export function isTriggerPriceValid(
  condition: PriceAlertCondition,
  target: number,
  triggerPrice: number,
): boolean {
  if (!Number.isFinite(target) || !Number.isFinite(triggerPrice)) return false;
  return condition === "above" || condition === "crossUp"
    ? triggerPrice >= target
    : triggerPrice <= target;
}
