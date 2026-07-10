export type PriceAlertCondition = "above" | "below" | "crossUp" | "crossDown";

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
