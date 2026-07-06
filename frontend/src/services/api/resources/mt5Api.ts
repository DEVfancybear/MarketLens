import { getJson } from "@/services/api/client";

export interface Mt5Symbol {
  name: string;
  path?: string;
  description?: string;
  visible: boolean;
  digits: number;
  spread: number;
  trade_mode: number;
  currency_base?: string;
  currency_profit?: string;
  currency_margin?: string;
}

export interface Mt5SymbolSnapshot {
  connected: boolean;
  bridgeUrl: string;
  source: string;
  count: number;
  streamSymbols: string[];
  symbols: Mt5Symbol[];
  updatedAt?: string;
  lastError?: string;
}

export async function getMt5Symbols(): Promise<Mt5SymbolSnapshot> {
  return getJson<Mt5SymbolSnapshot>("mt5/symbols");
}
