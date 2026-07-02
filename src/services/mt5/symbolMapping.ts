import type { Mt5SymbolInfo } from "@/types/mt5";

const DEFAULT_SYMBOLS: Record<string, Mt5SymbolInfo> = {
  BTCUSDT: {
    chartSymbol: "BTCUSDT",
    brokerSymbol: "BTCUSD",
    digits: 2,
    point: 0.01,
    lotStep: 0.01,
    minLot: 0.01,
    maxLot: 10,
    tradeMode: "full",
    updatedAt: 0,
  },
  ETHUSDT: {
    chartSymbol: "ETHUSDT",
    brokerSymbol: "ETHUSD",
    digits: 2,
    point: 0.01,
    lotStep: 0.01,
    minLot: 0.01,
    maxLot: 50,
    tradeMode: "full",
    updatedAt: 0,
  },
  EURUSD: {
    chartSymbol: "EURUSD",
    brokerSymbol: "EURUSD",
    digits: 5,
    point: 0.00001,
    lotStep: 0.01,
    minLot: 0.01,
    maxLot: 100,
    tradeMode: "full",
    updatedAt: 0,
  },
  GBPUSD: {
    chartSymbol: "GBPUSD",
    brokerSymbol: "GBPUSD",
    digits: 5,
    point: 0.00001,
    lotStep: 0.01,
    minLot: 0.01,
    maxLot: 100,
    tradeMode: "full",
    updatedAt: 0,
  },
  XAUUSD: {
    chartSymbol: "XAUUSD",
    brokerSymbol: "XAUUSD",
    digits: 2,
    point: 0.01,
    lotStep: 0.01,
    minLot: 0.01,
    maxLot: 50,
    tradeMode: "full",
    updatedAt: 0,
  },
};

export function getDefaultMt5SymbolInfo(symbol: string): Mt5SymbolInfo {
  const known = DEFAULT_SYMBOLS[symbol.toUpperCase()];
  if (known) return { ...known, updatedAt: Date.now() };
  return {
    chartSymbol: symbol,
    brokerSymbol: symbol,
    digits: 2,
    point: 0.01,
    lotStep: 0.01,
    minLot: 0.01,
    maxLot: 1,
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
