import type { RiskMetrics } from "@/types";
import type { Mt5SymbolInfo } from "@/types/mt5";
import {
  calculatePositionSizing,
  calculateRiskAmount,
  normalizePositionVolume as normalizeGenericVolume,
  roundMoney,
  roundMoneyDown,
  roundMoneyDownSigned,
  type PositionSizingResult,
  type RiskMode,
  type VolumeRules,
} from "./positionSizing";

/** The subset of MT5 symbol data required by the calculator. */
export type PositionLotSymbolInfo = Pick<
  Mt5SymbolInfo,
  | "tickSize"
  | "point"
  | "tickValue"
  | "tickValueLoss"
  | "tickValueProfit"
  | "minLot"
  | "maxLot"
  | "lotStep"
  | "contractSize"
  | "calcMode"
  | "currencyBase"
  | "currencyProfit"
  | "currencyMargin"
  | "marginInitial"
  | "marginMaintenance"
  | "marginHedged"
  | "spread"
  | "stopLevel"
  | "minStopDistance"
> & {
  /** Used only for conservative inference when older bridges omit calcMode. */
  chartSymbol?: string;
  brokerSymbol?: string;
  /** Optional conversion rates supplied by a broker/quote adapter. */
  lossConversionRate?: number;
  profitConversionRate?: number;
  baseToAccountRate?: number;
  profitToAccountRate?: number;
  marginToAccountRate?: number;
};

export type Mt5PositionSide = "long" | "short" | "buy" | "sell";
export type Mt5CommissionType = "currency" | "percent";
export type Mt5AccountBasis =
  | "balance"
  | "equity"
  | "balanceMinusRisk";

const DEFAULT_TICK_SIZE = 0.0001;
const DEFAULT_TICK_VALUE = 1;
const DEFAULT_MIN_LOT = 0.01;
const DEFAULT_MAX_LOT = 1;
const DEFAULT_LOT_STEP = 0.01;

function positiveNumber(
  value: number | null | undefined,
  fallback: number,
): number {
  return Number.isFinite(value) && Number(value) > 0 ? Number(value) : fallback;
}

function nonNegativeNumber(
  value: number | null | undefined,
  fallback = 0,
): number {
  return Number.isFinite(value) && Number(value) >= 0 ? Number(value) : fallback;
}

function rawNumber(value: number | null | undefined): number | undefined {
  return Number.isFinite(value) ? Number(value) : undefined;
}

function decimalPlacesFromStep(step: number): number {
  const safeStep = positiveNumber(step, DEFAULT_LOT_STEP);
  const text = safeStep.toString().toLowerCase();
  if (text.includes("e-")) {
    const exponent = Number(text.split("e-")[1]);
    return Number.isFinite(exponent) ? Math.max(0, exponent) : 0;
  }
  const dot = text.indexOf(".");
  return dot === -1 ? 0 : Math.max(0, text.length - dot - 1);
}

/** Return a usable positive trade tick size. */
export function positionTickSize(symbolInfo: PositionLotSymbolInfo): number {
  return positiveNumber(
    symbolInfo.tickSize,
    positiveNumber(symbolInfo.point, DEFAULT_TICK_SIZE),
  );
}

/**
 * Legacy-compatible single tick value accessor.  New code should prefer the
 * direction-specific loss/profit accessors below when the broker supplies
 * them.
 */
export function positionTickValue(symbolInfo: PositionLotSymbolInfo): number {
  return positiveNumber(
    symbolInfo.tickValue,
    positiveNumber(symbolInfo.tickValueLoss, DEFAULT_TICK_VALUE),
  );
}

export function positionTickValueLoss(
  symbolInfo: PositionLotSymbolInfo,
): number {
  const explicit = rawNumber(symbolInfo.tickValueLoss);
  if (explicit !== undefined) return Math.max(0, explicit);
  const shared = rawNumber(symbolInfo.tickValue);
  return shared === undefined ? DEFAULT_TICK_VALUE : Math.max(0, shared);
}

export function positionTickValueProfit(
  symbolInfo: PositionLotSymbolInfo,
): number {
  const explicit = rawNumber(symbolInfo.tickValueProfit);
  if (explicit !== undefined) return Math.max(0, explicit);
  const shared = rawNumber(symbolInfo.tickValue);
  return shared === undefined ? DEFAULT_TICK_VALUE : Math.max(0, shared);
}

export function positionStopTicks(
  entryPrice: number,
  stopPrice: number,
  symbolInfo: PositionLotSymbolInfo,
): number {
  if (
    !Number.isFinite(entryPrice) ||
    !Number.isFinite(stopPrice) ||
    entryPrice <= 0 ||
    stopPrice <= 0
  ) {
    return 0;
  }
  const tickSize = positionTickSize(symbolInfo);
  return Math.max(0, Math.round(Math.abs(entryPrice - stopPrice) / tickSize));
}

export function normalizePositionVolume(
  value: number,
  symbolInfo: PositionLotSymbolInfo,
): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return normalizeGenericVolume(value, volumeRules(symbolInfo));
}

export function formatPositionVolume(
  value: number,
  symbolInfo: PositionLotSymbolInfo,
): string {
  const lotStep = positiveNumber(symbolInfo.lotStep, DEFAULT_LOT_STEP);
  const decimals = Math.min(Math.max(decimalPlacesFromStep(lotStep), 0), 8);
  const fixed = normalizePositionVolume(value, symbolInfo).toFixed(decimals);
  return fixed.includes(".") ? fixed.replace(/\.?0+$/, "") : fixed;
}

export function positionRiskAmount(
  accountSize: number | null | undefined,
  riskValue: number | null | undefined,
  riskUnit: "%" | "amount" | null | undefined,
): number | null {
  if (!Number.isFinite(riskValue) || Number(riskValue) <= 0) return null;
  if ((riskUnit ?? "%") === "amount") return Number(riskValue);
  if (!Number.isFinite(accountSize) || Number(accountSize) <= 0) return null;
  return calculateRiskAmount({
    accountSize: Number(accountSize),
    riskValue: Number(riskValue),
    riskMode: "percent",
  });
}

export function calculatePositionVolumeFromRisk({
  entryPrice,
  stopPrice,
  riskAmount,
  symbolInfo,
}: {
  entryPrice: number;
  stopPrice: number;
  riskAmount: number;
  symbolInfo: PositionLotSymbolInfo;
}): number | null {
  if (!Number.isFinite(riskAmount) || riskAmount <= 0) return null;
  const stopTicks = positionStopTicks(entryPrice, stopPrice, symbolInfo);
  const moneyPerLotAtStop =
    stopTicks * positionTickValueLoss(symbolInfo);
  if (moneyPerLotAtStop <= 0) return null;
  return normalizePositionVolume(riskAmount / moneyPerLotAtStop, symbolInfo);
}

export interface Mt5PositionSizerInput {
  entryPrice?: number;
  stopPrice?: number;
  targetPrice?: number;
  side?: Mt5PositionSide;
  riskPct?: number;
  riskValue?: number;
  riskUnit?: "%" | "amount";
  accountSize?: number;
  balance?: number;
  equity?: number;
  accountBasis?: Mt5AccountBasis;
  /** Existing portfolio loss used by MT5's balance-minus-risk mode. */
  existingRiskMoney?: number;
  freeMargin?: number;
  accountCurrency?: string;
  lossConversionRate?: number;
  profitConversionRate?: number;
  baseToAccountRate?: number;
  profitToAccountRate?: number;
  marginToAccountRate?: number;
  commission?: number;
  commissionPerLot?: number;
  commissionType?: Mt5CommissionType;
  volumeOverride?: number;
  customLeverage?: number;
  leverage?: number;
  marginRate?: number;
  maxPositionSizeByMargin?: number;
  capByMargin?: boolean;
  bidPrice?: number;
  askPrice?: number;
  spreadPrice?: number;
  spreadAdjustmentSL?: boolean;
  spreadAdjustmentTP?: boolean;
  moneyPrecision?: number;
  /** If true, a missing stop returns the broker minimum for compatibility. */
  fallbackToMinimumWithoutStop?: boolean;
  symbolInfo: PositionLotSymbolInfo;
}

export interface Mt5PositionRiskMetrics extends RiskMetrics {
  accountSize: number;
  riskUnit: "%" | "amount";
  riskMoney: number;
  targetRisk: number;
  rawPositionSize: number;
  stopTicks: number;
  targetTicks: number;
  stopDistance: number;
  targetDistance: number;
  lossTickValue: number;
  profitTickValue: number;
  lossPerPriceUnit: number;
  profitPerPriceUnit: number;
  lossPerLot: number;
  rewardPerLot: number;
  commissionPerLot: number;
  commissionRoundTrip: number;
  grossRewardAmount: number;
  marginPerLot: number;
  positionMargin: number;
  maxPositionSizeByMargin: number | null;
  marginCapped: boolean;
  minVolumeApplied: boolean;
  maxVolumeApplied: boolean;
  side: "long" | "short" | null;
  warnings: string[];
}

/** Alias with a descriptive name for callers that are not tied to the old API. */
export function calculateMt5PositionSizer(
  input: Mt5PositionSizerInput,
): Mt5PositionRiskMetrics {
  return computeMt5PositionRiskMetrics(input);
}

/**
 * Position Sizer-compatible MT5 calculation.
 *
 * The adapter translates MT5's tick/contract metadata into the common
 * price-unit representation and delegates the arithmetic to
 * `positionSizing.ts`.  This keeps commission, volume-step, and rounding
 * behavior identical for every consumer.
 */
export function computeMt5PositionRiskMetrics(
  input: Mt5PositionSizerInput & {
    /** Backward-compatible legacy field. */
    riskPct?: number;
  },
): Mt5PositionRiskMetrics {
  const info = input.symbolInfo;
  const entry = rawNumber(input.entryPrice) ?? 0;
  const stop = rawNumber(input.stopPrice);
  const target = rawNumber(input.targetPrice);
  const accountSize = resolveAccountSize(input);
  const riskUnit: "%" | "amount" = input.riskUnit === "amount" ? "amount" : "%";
  const riskValue = rawNumber(input.riskValue) ?? rawNumber(input.riskPct) ?? 0;
  const side = resolveSide(input.side, entry, stop);
  const warnings: string[] = [];
  const tickSize = positionTickSize(info);
  const stopDistanceRaw =
    stop !== undefined && stop > 0 && entry > 0 ? Math.abs(entry - stop) : 0;
  const targetDistanceRaw =
    target !== undefined && target > 0 && entry > 0
      ? Math.abs(target - entry)
      : 0;
  const stopValid = stopDistanceRaw > 0;
  const targetValid = targetDistanceRaw > 0;

  if (!stopValid) warnings.push("STOP_LOSS_REQUIRED");
  if (side && stopValid && !isStopOnCorrectSide(side, entry, stop!)) {
    warnings.push("STOP_LOSS_WRONG_SIDE");
  }
  if (side && targetValid && !isTargetOnCorrectSide(side, entry, target!)) {
    warnings.push("TAKE_PROFIT_WRONG_SIDE");
  }
  const minimumStopDistance = Math.max(
    nonNegativeNumber(info.minStopDistance, 0),
    nonNegativeNumber(info.stopLevel, 0) * positiveNumber(info.point, 0),
  );
  if (stopValid && minimumStopDistance > 0 && stopDistanceRaw < minimumStopDistance) {
    warnings.push("STOP_LOSS_TOO_CLOSE");
  }
  if (targetValid && minimumStopDistance > 0 && targetDistanceRaw < minimumStopDistance) {
    warnings.push("TAKE_PROFIT_TOO_CLOSE");
  }

  const spread = resolveSpread(input);
  const stopDistance =
    stopDistanceRaw + (input.spreadAdjustmentSL ? spread : 0);
  const targetDistance = Math.max(
    0,
    targetDistanceRaw - (input.spreadAdjustmentTP ? spread : 0),
  );
  const unitCosts = resolveUnitCosts(input, entry, stop, target, side, warnings);
  const commissionPerLot = resolveCommission(input, entry, warnings);
  const marginPerLot = resolveMarginPerLot(input, entry, side);
  const maxPositionSizeByMargin = resolveMarginVolumeCap(
    input,
    marginPerLot,
    warnings,
  );
  const rules = volumeRules(info);
  const sizing = calculatePositionSizing({
    accountSize,
    riskValue,
    riskMode: riskUnit === "amount" ? "money" : "percent",
    stopDistance,
    targetDistance:
      stopValid &&
      targetValid &&
      !warnings.includes("TAKE_PROFIT_WRONG_SIDE")
      ? targetDistance
      : 0,
    lossPerPriceUnit: unitCosts.lossPerPriceUnit,
    profitPerPriceUnit: unitCosts.profitPerPriceUnit,
    commissionPerVolumePerSide: commissionPerLot,
    volume:
      rawNumber(input.volumeOverride) !== undefined &&
      Number(input.volumeOverride) > 0
        ? Number(input.volumeOverride)
        : undefined,
    volumeRules: rules,
    maxVolume:
      input.capByMargin === false
        ? undefined
        : maxPositionSizeByMargin ?? undefined,
    moneyPrecision: input.moneyPrecision ?? 2,
    rewardRounding: "down",
  });

  let positionSize = sizing.volume;
  // The old web ticket displayed the broker minimum while a stop was still
  // being entered. Keep that affordance, but make the missing-stop warning
  // explicit so it cannot be mistaken for a risk-safe size.
  if (
    !stopValid &&
    input.fallbackToMinimumWithoutStop !== false &&
    !input.volumeOverride
  ) {
    positionSize = normalizePositionVolume(
      positiveNumber(info.minLot, DEFAULT_MIN_LOT),
      info,
    );
  }
  const lossPerLot = stopValid
    ? stopDistance * unitCosts.lossPerPriceUnit + sizing.roundTripCommission
    : 0;
  const validTargetForReward =
    stopValid &&
    targetDistance > 0 &&
    !warnings.includes("TAKE_PROFIT_WRONG_SIDE");
  const rewardPerLot = validTargetForReward
    ? targetDistance * unitCosts.profitPerPriceUnit - sizing.roundTripCommission
    : 0;
  const actualRisk = stopValid
    ? roundMoney(positionSize * lossPerLot, input.moneyPrecision ?? 2)
    : 0;
  const grossRewardAmount = validTargetForReward
    ? roundMoneyDown(
        positionSize * targetDistance * unitCosts.profitPerPriceUnit,
        input.moneyPrecision ?? 2,
      )
    : 0;
  const rewardAmount = validTargetForReward
    ? roundMoneyDownSigned(positionSize * rewardPerLot, input.moneyPrecision ?? 2)
    : 0;
  const riskPct = accountSize > 0 ? (actualRisk / accountSize) * 100 : 0;
  const marginCapped =
    sizing.marginCapped && input.capByMargin !== false;
  const allWarnings = uniqueWarnings([
    ...warnings,
    ...sizing.warnings,
    ...(marginCapped ? ["MARGIN_VOLUME_CAPPED"] : []),
  ]);
  return {
    positionSize,
    riskPct,
    riskAmount: actualRisk,
    rewardAmount,
    riskReward: actualRisk > 0 ? rewardAmount / actualRisk : 0,
    accountSize,
    riskUnit,
    // `riskMoney` mirrors the Position Sizer input field; `riskAmount` above
    // is the actual post-step result after broker normalization.
    riskMoney: stopValid ? sizing.targetRisk : 0,
    targetRisk: sizing.targetRisk,
    rawPositionSize: sizing.rawVolume,
    stopTicks: stopValid ? Math.max(0, Math.round(stopDistance / tickSize)) : 0,
    targetTicks: targetValid
      ? Math.max(0, Math.round(targetDistance / tickSize))
      : 0,
    stopDistance,
    targetDistance,
    lossTickValue: unitCosts.lossTickValue,
    profitTickValue: unitCosts.profitTickValue,
    lossPerPriceUnit: unitCosts.lossPerPriceUnit,
    profitPerPriceUnit: unitCosts.profitPerPriceUnit,
    lossPerLot,
    rewardPerLot,
    commissionPerLot,
    commissionRoundTrip: sizing.roundTripCommission,
    grossRewardAmount,
    marginPerLot,
    positionMargin: marginPerLot * positionSize,
    maxPositionSizeByMargin,
    marginCapped,
    minVolumeApplied: sizing.minVolumeApplied,
    maxVolumeApplied: sizing.maxVolumeApplied,
    side,
    warnings: allWarnings,
  };
}

interface UnitCosts {
  lossTickValue: number;
  profitTickValue: number;
  lossPerPriceUnit: number;
  profitPerPriceUnit: number;
}

function volumeRules(info: PositionLotSymbolInfo): VolumeRules {
  return {
    min: positiveNumber(info.minLot, DEFAULT_MIN_LOT),
    max: positiveNumber(info.maxLot, DEFAULT_MAX_LOT),
    step: positiveNumber(info.lotStep, DEFAULT_LOT_STEP),
    clampToMin: true,
  };
}

function resolveAccountSize(input: Mt5PositionSizerInput): number {
  const basis = input.accountBasis ?? "equity";
  const fallback = rawNumber(input.accountSize) ?? 0;
  const balance = rawNumber(input.balance);
  const equity = rawNumber(input.equity);
  let value =
    basis === "balance"
      ? balance ?? equity ?? fallback
      : basis === "balanceMinusRisk"
        ? balance ?? equity ?? fallback
        : equity ?? balance ?? fallback;
  if (basis === "balanceMinusRisk") {
    value -= nonNegativeNumber(input.existingRiskMoney);
  }
  return Math.max(0, value);
}

function normalizeSide(side: Mt5PositionSide | undefined): "long" | "short" | null {
  if (side === "long" || side === "buy") return "long";
  if (side === "short" || side === "sell") return "short";
  return null;
}

function resolveSide(
  side: Mt5PositionSide | undefined,
  entry: number,
  stop: number | undefined,
): "long" | "short" | null {
  const explicit = normalizeSide(side);
  if (explicit) return explicit;
  if (stop !== undefined && stop < entry) return "long";
  if (stop !== undefined && stop > entry) return "short";
  return null;
}

function isStopOnCorrectSide(
  side: "long" | "short",
  entry: number,
  stop: number,
): boolean {
  return side === "long" ? stop < entry : stop > entry;
}

function isTargetOnCorrectSide(
  side: "long" | "short",
  entry: number,
  target: number,
): boolean {
  return side === "long" ? target > entry : target < entry;
}

function normalizeCalcMode(mode: string | number | undefined): string | number | undefined {
  if (typeof mode === "number" && Number.isFinite(mode)) return mode;
  if (typeof mode !== "string") return undefined;
  return mode.toLowerCase().replace(/[\s_-]+/g, "");
}

/** MT5 modes whose tick-value fields are the authoritative unit cost. */
function usesTickValueCalcMode(info: PositionLotSymbolInfo): boolean {
  const mode = normalizeCalcMode(info.calcMode);
  if (typeof mode === "number") {
    // ENUM_SYMBOL_CALC_MODE: FOREX=0, FOREX_NO_LEVERAGE=1, FUTURES=2,
    // EXCH_FUTURES=7, EXCH_FUTURES_FORTS=11.  CFDs/stocks/bonds use
    // tick-size * contract-size instead, as in the upstream EA.
    return [0, 1, 2, 7, 11].includes(mode);
  }
  if (typeof mode === "string") {
    return (
      mode.includes("forex") ||
      mode.includes("future") ||
      mode === "forts"
    );
  }
  // Older bridge payloads only contain tick value. Treat those as Forex-like
  // because tick value is already account-currency-per-tick in MT5, except
  // for symbols whose name clearly identifies a CFD/metal/crypto contract.
  const symbol = `${info.chartSymbol ?? ""} ${info.brokerSymbol ?? ""}`.toUpperCase();
  if (/(XAU|XAG|BTC|ETH|US30|NAS100|SPX500|GER40|UK100)/.test(symbol)) {
    return false;
  }
  return !(positiveNumber(info.contractSize, 0) > 0);
}

/** Future-rate correction is only defined for Forex/Forex-no-leverage. */
function isForexPair(info: PositionLotSymbolInfo): boolean {
  const mode = normalizeCalcMode(info.calcMode);
  if (typeof mode === "number") return mode === 0 || mode === 1;
  if (typeof mode === "string") return mode.includes("forex");
  return usesTickValueCalcMode(info);
}

function conversionRate(
  input: Mt5PositionSizerInput,
  info: PositionLotSymbolInfo,
  kind: "loss" | "profit" | "base" | "margin",
): number {
  const candidates =
    kind === "loss"
      ? [info.lossConversionRate, input.lossConversionRate]
      : kind === "profit"
        ? [info.profitConversionRate, input.profitConversionRate]
        : kind === "base"
          ? [
              info.baseToAccountRate,
              info.profitToAccountRate,
              input.baseToAccountRate,
              input.profitToAccountRate,
            ]
          : [info.marginToAccountRate, input.marginToAccountRate];
  for (const candidate of candidates) {
    if (Number.isFinite(candidate) && Number(candidate) > 0) return Number(candidate);
  }
  return 1;
}

function futureRateFactor(
  input: Mt5PositionSizerInput,
  entry: number,
  future: number | undefined,
  side: "long" | "short" | null,
  info: PositionLotSymbolInfo,
): number {
  if (!future || future <= 0) return 1;
  const account = (input.accountCurrency ?? "").trim().toUpperCase();
  const base = (info.currencyBase ?? "").trim().toUpperCase();
  if (!account || !base || account !== base || !isForexPair(info)) return 1;
  const current =
    side === "long"
      ? rawNumber(input.askPrice) ?? entry
      : rawNumber(input.bidPrice) ?? entry;
  return current > 0 ? current / future : 1;
}

function resolveUnitCosts(
  input: Mt5PositionSizerInput,
  entry: number,
  stop: number | undefined,
  target: number | undefined,
  side: "long" | "short" | null,
  warnings: string[],
): UnitCosts {
  const info = input.symbolInfo;
  const tickSize = positionTickSize(info);
  // Do not invent a tick value for the MT5 path.  The legacy accessor keeps a
  // small default for chart-prefill callers, but risk sizing must surface a
  // missing broker value instead of silently approving a trade.
  const lossTick =
    rawNumber(info.tickValueLoss) ?? rawNumber(info.tickValue) ?? 0;
  const profitTick =
    rawNumber(info.tickValueProfit) ?? rawNumber(info.tickValue) ?? 0;
  const tickValueMode = usesTickValueCalcMode(info);
  let lossTickValue = lossTick;
  let profitTickValue = profitTick;
  if (tickValueMode) {
    lossTickValue *= futureRateFactor(input, entry, stop, side, info);
    profitTickValue *= futureRateFactor(input, entry, target, side, info);
  } else {
    const contract = positiveNumber(info.contractSize, 0);
    if (contract > 0) {
      lossTickValue = tickSize * contract * conversionRate(input, info, "loss");
      profitTickValue = tickSize * contract * conversionRate(input, info, "profit");
    } else if (lossTickValue <= 0 || profitTickValue <= 0) {
      warnings.push("TICK_VALUE_UNAVAILABLE");
    }
  }
  if (lossTickValue <= 0 || profitTickValue <= 0) {
    warnings.push("TICK_VALUE_UNAVAILABLE");
  }
  return {
    lossTickValue,
    profitTickValue,
    lossPerPriceUnit: tickSize > 0 ? lossTickValue / tickSize : 0,
    profitPerPriceUnit: tickSize > 0 ? profitTickValue / tickSize : 0,
  };
}

function resolveCommission(
  input: Mt5PositionSizerInput,
  entry: number,
  warnings: string[],
): number {
  const value =
    rawNumber(input.commissionPerLot) ?? rawNumber(input.commission) ?? 0;
  if (value <= 0) return 0;
  if ((input.commissionType ?? "currency") !== "percent") return value;
  const info = input.symbolInfo;
  const contract = positiveNumber(info.contractSize, 0);
  if (contract <= 0) {
    warnings.push("PERCENT_COMMISSION_NEEDS_CONTRACT_SIZE");
    return 0;
  }
  const account = (input.accountCurrency ?? "").trim().toUpperCase();
  const base = (info.currencyBase ?? "").trim().toUpperCase();
  const profit = (info.currencyProfit ?? "").trim().toUpperCase();
  const ask = rawNumber(input.askPrice) ?? entry;
  let contractValue: number;
  if (isForexPair(info) && base && account && base === account) {
    contractValue = contract;
  } else if (profit && account && profit === account) {
    contractValue = contract * Math.max(ask, 0);
  } else {
    contractValue = contract * conversionRate(input, info, "base");
  }
  return roundMoney(Math.max(0, (contractValue * value) / 100), 8);
}

function resolveMarginPerLot(
  input: Mt5PositionSizerInput,
  entry: number,
  side: "long" | "short" | null,
): number {
  const info = input.symbolInfo;
  const explicit = rawNumber(info.marginMaintenance) ?? rawNumber(info.marginInitial);
  if (explicit !== undefined && explicit > 0) {
    return explicit * conversionRate(input, info, "margin");
  }
  const contract = positiveNumber(info.contractSize, 0);
  const leverage = positiveNumber(
    input.customLeverage ?? input.leverage,
    0,
  );
  if (contract <= 0 || leverage <= 0) return 0;
  const price =
    side === "long"
      ? rawNumber(input.askPrice) ?? entry
      : rawNumber(input.bidPrice) ?? entry;
  const rate = nonNegativeNumber(input.marginRate, 1) || 1;
  return (contract * Math.max(price, 0) * rate * conversionRate(input, info, "margin")) /
    leverage;
}

function resolveMarginVolumeCap(
  input: Mt5PositionSizerInput,
  marginPerLot: number,
  warnings: string[],
): number | null {
  const explicit = rawNumber(input.maxPositionSizeByMargin);
  if (explicit !== undefined && explicit >= 0) return explicit;
  const freeMargin = rawNumber(input.freeMargin);
  if (freeMargin === undefined || freeMargin < 0 || marginPerLot <= 0) return null;
  const cap = freeMargin / marginPerLot;
  if (!Number.isFinite(cap)) {
    warnings.push("MARGIN_CAP_UNAVAILABLE");
    return null;
  }
  return cap;
}

function resolveSpread(input: Mt5PositionSizerInput): number {
  const explicit = rawNumber(input.spreadPrice);
  if (explicit !== undefined && explicit >= 0) return explicit;
  const ask = rawNumber(input.askPrice);
  const bid = rawNumber(input.bidPrice);
  if (ask !== undefined && bid !== undefined) return Math.max(0, ask - bid);
  const point = positiveNumber(input.symbolInfo.point, 0);
  const spreadPoints = nonNegativeNumber(input.symbolInfo.spread, 0);
  return point * spreadPoints;
}

function uniqueWarnings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

// Keep this import used in generated declaration output when consumers narrow
// the result to the common engine's shape.
export type CommonPositionSizingResult = PositionSizingResult;
export type { RiskMode };
