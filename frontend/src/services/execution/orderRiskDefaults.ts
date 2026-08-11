export const PROP_ACCOUNT_DEFAULT_RISK_PERCENT = 0.1;
export const STANDARD_ACCOUNT_DEFAULT_RISK_PERCENT = 1;
export const LEGACY_POSITION_DEFAULT_RISK_PERCENT = 25;

/** Resolve the default without branching on a provider or program name. */
export function defaultOrderRiskPercent(hasPropRiskAssignment: boolean): number {
  return hasPropRiskAssignment
    ? PROP_ACCOUNT_DEFAULT_RISK_PERCENT
    : STANDARD_ACCOUNT_DEFAULT_RISK_PERCENT;
}

/** Recognize new defaults plus the historical 25% drawing default. */
export function isDefaultPositionRisk(
  riskPercent: number | undefined,
  explicitlyDefaulted: boolean | undefined,
): boolean {
  return (
    explicitlyDefaulted === true ||
    (explicitlyDefaulted === undefined &&
      riskPercent === LEGACY_POSITION_DEFAULT_RISK_PERCENT)
  );
}
