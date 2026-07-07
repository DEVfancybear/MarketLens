import type { Mt5SymbolInfo } from "@/types/mt5";
import { getMarketSymbol } from "@/services/market-data/symbols";

export function getDefaultMt5SymbolInfo(symbol: string): Mt5SymbolInfo {
  const id = symbol.trim().toUpperCase();
  const market = getMarketSymbol(id);
  const digits = market?.pricePrecision ?? 2;
  const tickSize = market?.tickSize ?? 10 ** -Math.max(digits, 0);

  return {
    chartSymbol: id || symbol,
    brokerSymbol: market?.providerSymbol ?? (id || symbol),
    digits,
    point: tickSize,
    lotStep: 0.01,
    minLot: 0.01,
    maxLot: 100,
    tickSize,
    tickValue: 1,
    tradeMode: "full",
    updatedAt: Date.now(),
  };
}

export function isVolumeOnStep(volume: number, lotStep: number): boolean {
  if (!Number.isFinite(volume) || !Number.isFinite(lotStep) || lotStep <= 0) {
    return false;
  }
  const steps = volume / lotStep;
  return Math.abs(steps - Math.round(steps)) < 1e-8;
}
