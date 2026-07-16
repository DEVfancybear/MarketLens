/**
 * Broker-agnostic position-sizing primitives.
 *
 * The MT5 Position Sizer keeps the risk calculation deliberately simple:
 * money risked by one lot is the stop distance multiplied by the monetary
 * value of one price unit, plus the round-trip commission.  This module owns
 * that arithmetic so adapters (MT5, the simulator, and chart tools) do not
 * each grow subtly different versions of the same formula.
 */

export type RiskMode = "percent" | "money";
export type RewardRounding = "nearest" | "down";

export interface VolumeRules {
  min?: number;
  max?: number;
  step?: number;
  /** MT5's main calculator raises a below-minimum result to min volume. */
  clampToMin?: boolean;
}

export interface PositionSizingInput {
  accountSize: number;
  riskValue: number;
  riskMode?: RiskMode;
  stopDistance: number;
  targetDistance?: number;
  /** Money made/lost by one volume unit for one price unit. */
  lossPerPriceUnit: number;
  profitPerPriceUnit?: number;
  /** One-way commission for one volume unit, in account currency. */
  commissionPerVolumePerSide?: number;
  volume?: number;
  volumeRules?: VolumeRules;
  /** Optional hard cap (for example, free-margin capacity). */
  maxVolume?: number;
  /** Set false for unit-based simulators that do not have broker lot rules. */
  normalizeVolume?: boolean;
  /** Number of account-currency decimals used by MT5's risk display. */
  moneyPrecision?: number;
  /** MT5 rounds displayed reward down; generic consumers may prefer nearest. */
  rewardRounding?: RewardRounding;
}

export interface PositionSizingResult {
  accountSize: number;
  targetRisk: number;
  riskMode: RiskMode;
  stopDistance: number;
  targetDistance: number;
  lossPerPriceUnit: number;
  profitPerPriceUnit: number;
  commissionPerVolumePerSide: number;
  roundTripCommission: number;
  lossPerVolume: number;
  rewardPerVolume: number;
  rawVolume: number;
  volume: number;
  actualRisk: number;
  grossReward: number;
  reward: number;
  riskReward: number;
  marginCapped: boolean;
  minVolumeApplied: boolean;
  maxVolumeApplied: boolean;
  warnings: string[];
}

const DEFAULT_MIN_VOLUME = 0.01;
const DEFAULT_MAX_VOLUME = Number.POSITIVE_INFINITY;
const DEFAULT_VOLUME_STEP = 0.01;

function finitePositive(value: number | null | undefined, fallback: number): number {
  return Number.isFinite(value) && Number(value) > 0 ? Number(value) : fallback;
}

function finiteNonNegative(value: number | null | undefined, fallback = 0): number {
  return Number.isFinite(value) && Number(value) >= 0 ? Number(value) : fallback;
}

/** Round a positive monetary amount down to the requested currency precision. */
export function roundMoneyDown(value: number, precision = 2): number {
  if (!Number.isFinite(value)) return 0;
  const places = Math.min(Math.max(Math.trunc(precision), 0), 12);
  const factor = 10 ** places;
  return Math.floor((Math.max(0, value) + Number.EPSILON * factor) * factor) / factor;
}

/** Round a monetary amount using normal nearest rounding. */
export function roundMoney(value: number, precision = 2): number {
  if (!Number.isFinite(value)) return 0;
  const places = Math.min(Math.max(Math.trunc(precision), 0), 12);
  return Number(value.toFixed(places));
}

/** Round a signed monetary value toward negative infinity (MT5 RoundDown). */
export function roundMoneyDownSigned(value: number, precision = 2): number {
  if (!Number.isFinite(value)) return 0;
  if (value >= 0) return roundMoneyDown(value, precision);
  const places = Math.min(Math.max(Math.trunc(precision), 0), 12);
  const factor = 10 ** places;
  const scaled = value * factor;
  const nearest = Math.round(scaled);
  const stable = Math.abs(nearest - scaled) < 1e-8 ? nearest : Math.floor(scaled);
  return stable / factor;
}

/** Convert a percentage or money risk input to account currency. */
export function calculateRiskAmount({
  accountSize,
  riskValue,
  riskMode = "percent",
  moneyPrecision = 2,
}: {
  accountSize: number;
  riskValue: number;
  riskMode?: RiskMode;
  moneyPrecision?: number;
}): number {
  const account = finiteNonNegative(accountSize);
  const value = finiteNonNegative(riskValue);
  const amount = riskMode === "money" ? value : (account * value) / 100;
  // Position Sizer rounds percentage-derived risk down to the account
  // currency precision.  In money mode the value is already denominated in
  // the account currency and is kept as entered (the result is rounded when
  // displaying actual risk).
  return riskMode === "money" ? amount : roundMoneyDown(amount, moneyPrecision);
}

function floorToStep(value: number, step: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (!Number.isFinite(step) || step <= 0) return value;
  const steps = value / step;
  const nearest = Math.round(steps);
  const stable = Math.abs(nearest - steps) < 1e-8 ? nearest : Math.floor(steps);
  // A few guard digits prevent 0.3 becoming 0.29999999999999999 while still
  // preserving non-decimal steps such as 0.25.
  return Number((Math.max(0, stable) * step).toPrecision(15));
}

function finiteMax(value: number | null | undefined, fallback: number): number {
  if (value === Number.POSITIVE_INFINITY) return Number.POSITIVE_INFINITY;
  return Number.isFinite(value) && Number(value) >= 0 ? Number(value) : fallback;
}

/**
 * Apply broker volume constraints using the same order as MT5's
 * AdjustPositionSizeByMinMaxStep: clamp first, then floor to volume step.
 */
export function normalizePositionVolume(
  value: number,
  rules: VolumeRules = {},
): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const min = finitePositive(rules.min, DEFAULT_MIN_VOLUME);
  const max = finiteMax(rules.max, DEFAULT_MAX_VOLUME);
  const step = finitePositive(rules.step, DEFAULT_VOLUME_STEP);
  const clampToMin = rules.clampToMin !== false;
  let bounded = value;
  if (bounded < min) bounded = clampToMin ? min : 0;
  if (bounded > max) bounded = max;
  if (bounded <= 0) return 0;
  return floorToStep(bounded, step);
}

/**
 * Calculate risk, reward, and broker-normalized volume.  `volume` switches to
 * MT5's reverse mode: the supplied lot size is kept and the resulting risk is
 * reported instead of deriving a new size from the requested risk.
 */
export function calculatePositionSizing(
  input: PositionSizingInput,
): PositionSizingResult {
  const warnings: string[] = [];
  const accountSize = finiteNonNegative(input.accountSize);
  const riskMode: RiskMode = input.riskMode === "money" ? "money" : "percent";
  const targetRisk = calculateRiskAmount({
    accountSize,
    riskValue: input.riskValue,
    riskMode,
    moneyPrecision: input.moneyPrecision,
  });
  const stopDistance = finiteNonNegative(input.stopDistance);
  const targetDistance = finiteNonNegative(input.targetDistance);
  const lossPerPriceUnit = finiteNonNegative(input.lossPerPriceUnit);
  const profitPerPriceUnit = finiteNonNegative(
    input.profitPerPriceUnit,
    lossPerPriceUnit,
  );
  const commissionPerVolumePerSide = finiteNonNegative(
    input.commissionPerVolumePerSide,
  );
  const roundTripCommission = commissionPerVolumePerSide * 2;
  const lossPerVolume = stopDistance * lossPerPriceUnit + roundTripCommission;
  const rewardPerVolume =
    targetDistance > 0
      ? targetDistance * profitPerPriceUnit - roundTripCommission
      : 0;
  const rawVolume =
    stopDistance > 0 &&
    lossPerPriceUnit > 0 &&
    lossPerVolume > 0 &&
    targetRisk > 0
      ? targetRisk / lossPerVolume
      : 0;
  const rules = input.volumeRules ?? {};
  const maxByMargin = finiteMax(input.maxVolume, Number.POSITIVE_INFINITY);
  const maxBeforeNormalize = Math.min(
    finitePositive(rules.max, DEFAULT_MAX_VOLUME),
    maxByMargin,
  );
  const hasManualVolume =
    Number.isFinite(input.volume) && Number(input.volume) > 0;
  const candidateVolume = hasManualVolume ? Number(input.volume) : rawVolume;
  const maxVolumeApplied =
    Number.isFinite(maxBeforeNormalize) && candidateVolume > maxBeforeNormalize;
  const requestedVolume =
    hasManualVolume
      ? Number(input.volume)
      : Math.min(rawVolume, maxBeforeNormalize);
  const min = finitePositive(rules.min, DEFAULT_MIN_VOLUME);
  const minVolumeApplied =
    requestedVolume > 0 && requestedVolume < min && rules.clampToMin !== false;
  const shouldNormalize = input.normalizeVolume !== false;
  const volume = shouldNormalize
    ? normalizePositionVolume(requestedVolume, {
        ...rules,
        max: maxBeforeNormalize,
      })
    : Math.max(0, requestedVolume);
  const marginCapped =
    Number.isFinite(maxByMargin) &&
    maxByMargin < finitePositive(rules.max, DEFAULT_MAX_VOLUME) &&
    candidateVolume > maxByMargin;
  if (!lossPerPriceUnit || !stopDistance) warnings.push("STOP_DISTANCE_UNAVAILABLE");
  if (minVolumeApplied) warnings.push("MIN_VOLUME_INCREASED_RISK");
  if (maxVolumeApplied) warnings.push("MAX_VOLUME_CAPPED");
  if (marginCapped) warnings.push("MARGIN_VOLUME_CAPPED");
  if (input.volume != null && Number.isFinite(input.volume) && input.volume > 0) {
    warnings.push("RISK_FROM_VOLUME");
  }
  const actualRisk = roundMoney(volume * lossPerVolume, input.moneyPrecision);
  const roundReward =
    input.rewardRounding === "down" ? roundMoneyDownSigned : roundMoney;
  const grossReward = roundReward(
    volume * targetDistance * profitPerPriceUnit,
    input.moneyPrecision,
  );
  const reward = roundReward(volume * rewardPerVolume, input.moneyPrecision);
  return {
    accountSize,
    targetRisk,
    riskMode,
    stopDistance,
    targetDistance,
    lossPerPriceUnit,
    profitPerPriceUnit,
    commissionPerVolumePerSide,
    roundTripCommission,
    lossPerVolume,
    rewardPerVolume,
    rawVolume,
    volume,
    actualRisk,
    grossReward,
    reward,
    riskReward: actualRisk > 0 ? reward / actualRisk : 0,
    marginCapped,
    minVolumeApplied,
    maxVolumeApplied,
    warnings,
  };
}
