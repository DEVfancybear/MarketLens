import type { Mt5Symbol } from "@/services/api/resources/mt5Api";
import type { AssetClass, MarketSymbol } from "@/types";

/**
 * Runtime symbol registry.
 *
 * This file intentionally does not seed any hardcoded symbols. The MT5 bridge
 * owns the catalog, the Go backend exposes it through /api/v1/mt5/symbols, and
 * frontend stores replace this registry after the API call succeeds. Keeping a
 * single mutable registry lets legacy imports keep working while avoiding a
 * second client-side source of truth.
 */
export const MARKET_SYMBOLS: MarketSymbol[] = [];

let byId = new Map<string, MarketSymbol>();

export function getAllMarketSymbols(): MarketSymbol[] {
  return [...MARKET_SYMBOLS];
}

export function replaceMarketSymbols(symbols: MarketSymbol[]): void {
  const normalized = normalizeUniqueSymbols(symbols);
  MARKET_SYMBOLS.splice(0, MARKET_SYMBOLS.length, ...normalized);
  byId = new Map(normalized.map((symbol) => [symbol.id.toUpperCase(), symbol]));
}

export function getMarketSymbol(id: string): MarketSymbol | undefined {
  return byId.get(id.trim().toUpperCase());
}

export function marketSymbolFromMt5(
  input: Mt5Symbol,
  streamable?: boolean,
): MarketSymbol {
  const rawName = input.name.trim();
  const id = rawName.toUpperCase();
  const base = normalizeCurrency(input.currency_base) ?? inferBase(id);
  const quote = normalizeCurrency(input.currency_profit) ?? inferQuote(id);
  const digits = Number.isFinite(input.digits) ? Math.max(input.digits, 0) : 5;
  const point =
    Number.isFinite(input.point) && input.point > 0
      ? input.point
      : 10 ** -digits;

  return {
    id,
    name: input.description?.trim() || formatSymbolName(id, base, quote),
    provider: "mt5",
    assetClass: inferAssetClass(input, base, quote),
    exchange: "MT5",
    base,
    quote,
    pricePrecision: digits,
    tickSize: point,
    providerSymbol: rawName,
    streamable: streamable ?? false,
  };
}

/**
 * Compatibility helper for older provider code. With the MT5 catalog active,
 * callers should not reach TwelveData, so this simply returns the provider
 * symbol already supplied by the runtime registry.
 */
export function twelveDataSymbol(symbol: string): string {
  return getMarketSymbol(symbol)?.providerSymbol ?? symbol;
}

export function twelveDataSymbolMap(): Record<string, string> {
  return Object.fromEntries(
    MARKET_SYMBOLS.map((symbol) => [symbol.id, symbol.providerSymbol]),
  );
}

/** Compatibility helper for older alert/OANDA code. */
export function oandaInstrument(symbol: string): string {
  return getMarketSymbol(symbol)?.providerSymbol ?? symbol;
}

function normalizeUniqueSymbols(symbols: MarketSymbol[]): MarketSymbol[] {
  const seen = new Set<string>();
  const normalized: MarketSymbol[] = [];

  for (const symbol of symbols) {
    const id = symbol.id.trim().toUpperCase();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    normalized.push({
      ...symbol,
      id,
      providerSymbol: symbol.providerSymbol || id,
      streamable: symbol.streamable !== false,
    });
  }

  return normalized;
}

function normalizeCurrency(value?: string): string | undefined {
  const trimmed = value?.trim().toUpperCase();
  return trimmed || undefined;
}

function inferAssetClass(
  input: Mt5Symbol,
  base?: string,
  quote?: string,
): AssetClass {
  const text = `${input.path ?? ""} ${input.description ?? ""} ${input.name}`.toLowerCase();
  if (base === "XAU" || base === "XAG" || text.includes("metal")) return "metal";
  if (text.includes("crypto") || base === "BTC" || base === "ETH") return "crypto";
  if (
    text.includes("index") ||
    text.includes("indices") ||
    text.includes("indice")
  ) {
    return "index";
  }
  if (base && quote) return "forex";
  return "commodity";
}

function inferBase(symbol: string): string | undefined {
  return symbol.length >= 6 ? symbol.slice(0, 3) : undefined;
}

function inferQuote(symbol: string): string | undefined {
  return symbol.length >= 6 ? symbol.slice(3, 6) : undefined;
}

function formatSymbolName(
  symbol: string,
  base?: string,
  quote?: string,
): string {
  return base && quote ? `${base} / ${quote}` : symbol;
}
