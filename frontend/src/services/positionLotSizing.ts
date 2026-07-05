import type { RiskMetrics } from "@/types";
import type { Mt5SymbolInfo } from "@/types/mt5";

export type PositionLotSymbolInfo = Pick<
  Mt5SymbolInfo,
  "tickSize" | "point" | "tickValue" | "minLot" | "maxLot" | "lotStep"
>;

const DEFAULT_TICK_SIZE = 0.0001;
const DEFAULT_TICK_VALUE = 1;
const DEFAULT_MIN_LOT = 0.01;
const DEFAULT_MAX_LOT = 1;
const DEFAULT_LOT_STEP = 0.01;

function positiveNumber(value: number | null | undefined, fallback: number) {
  return Number.isFinite(value) && Number(value) > 0 ? Number(value) : fallback;
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

export function positionRiskAmount(
  accountSize: number | null | undefined,
  riskValue: number | null | undefined,
  riskUnit: "%" | "amount" | null | undefined,
): number | null {
  if (!Number.isFinite(riskValue)) return null;
  const risk = Number(riskValue);
  if ((riskUnit ?? "%") === "amount") return risk > 0 ? risk : null;
  if (!Number.isFinite(accountSize) || Number(accountSize) <= 0) return null;
  return risk > 0 ? (Number(accountSize) * risk) / 100 : null;
}

export function positionTickSize(symbolInfo: PositionLotSymbolInfo): number {
  return positiveNumber(
    symbolInfo.tickSize,
    positiveNumber(symbolInfo.point, DEFAULT_TICK_SIZE),
  );
}

export function positionTickValue(symbolInfo: PositionLotSymbolInfo): number {
  return positiveNumber(symbolInfo.tickValue, DEFAULT_TICK_VALUE);
}

export function positionStopTicks(
  entryPrice: number,
  stopPrice: number,
  symbolInfo: PositionLotSymbolInfo,
): number {
  if (!Number.isFinite(entryPrice) || !Number.isFinite(stopPrice)) return 0;
  const tickSize = positionTickSize(symbolInfo);
  return Math.max(0, Math.round(Math.abs(entryPrice - stopPrice) / tickSize));
}

export function normalizePositionVolume(
  value: number,
  symbolInfo: PositionLotSymbolInfo,
): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const minLot = positiveNumber(symbolInfo.minLot, DEFAULT_MIN_LOT);
  const maxLot = positiveNumber(symbolInfo.maxLot, DEFAULT_MAX_LOT);
  const lotStep = positiveNumber(symbolInfo.lotStep, DEFAULT_LOT_STEP);
  const bounded = Math.min(Math.max(value, minLot), maxLot);
  const decimals = Math.min(Math.max(decimalPlacesFromStep(lotStep), 0), 8);
  const rounded = Math.floor((bounded + Number.EPSILON) / lotStep) * lotStep;
  return Number(rounded.toFixed(decimals));
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
  const moneyPerLotAtStop = stopTicks * positionTickValue(symbolInfo);
  if (moneyPerLotAtStop <= 0) return null;
  return normalizePositionVolume(riskAmount / moneyPerLotAtStop, symbolInfo);
}

export function computeMt5PositionRiskMetrics({
  entryPrice,
  stopPrice,
  targetPrice,
  riskPct,
  equity,
  symbolInfo,
  volumeOverride,
}: {
  entryPrice?: number;
  stopPrice?: number;
  targetPrice?: number;
  riskPct: number;
  equity: number;
  symbolInfo: PositionLotSymbolInfo;
  volumeOverride?: number;
}): RiskMetrics {
  const riskMoney = (equity * riskPct) / 100;
  const safeEntry = entryPrice && Number.isFinite(entryPrice) ? entryPrice : 0;
  const stopTicks =
    stopPrice != null && safeEntry > 0
      ? positionStopTicks(safeEntry, stopPrice, symbolInfo)
      : 0;
  const tickValue = positionTickValue(symbolInfo);
  const moneyPerLotAtStop = stopTicks * tickValue;
  const rawLots =
    moneyPerLotAtStop > 0
      ? riskMoney / moneyPerLotAtStop
      : positiveNumber(symbolInfo.minLot, DEFAULT_MIN_LOT);
  const positionSize =
    volumeOverride != null && Number.isFinite(volumeOverride) && volumeOverride > 0
      ? volumeOverride
      : normalizePositionVolume(rawLots, symbolInfo);
  const actualRisk =
    moneyPerLotAtStop > 0 ? moneyPerLotAtStop * positionSize : riskMoney;
  const rewardTicks =
    targetPrice != null && safeEntry > 0
      ? positionStopTicks(safeEntry, targetPrice, symbolInfo)
      : 0;
  const rewardAmount = rewardTicks > 0 ? rewardTicks * tickValue * positionSize : 0;
  return {
    positionSize,
    riskPct,
    riskAmount: actualRisk,
    rewardAmount,
    riskReward: actualRisk > 0 ? rewardAmount / actualRisk : 0,
  };
}
