/**
 * Canonical market symbol registry (Phase 1, Step 6).
 *
 * This is **configuration**, not mock market data — it defines which provider
 * serves each symbol and how the canonical app id maps to the provider's native
 * id (Binance "BTCUSDT", OANDA "EUR_USD", TwelveData "EUR/USD").
 * The MarketDataService uses it to route subscriptions; the watchlist/symbol-search
 * will consume it in Steps 10+.
 *
 * Crypto → BinanceProvider (no key).
 * Forex/metals/indices → OandaProvider (needs NEXT_PUBLIC_OANDA_API_KEY).
 *   Falls back to TwelveDataProvider if OANDA key is unavailable.
 */
import type { MarketSymbol } from "@/types";

export const MARKET_SYMBOLS: MarketSymbol[] = [
  // ---- Crypto (Binance) — providerSymbol === canonical id ----
  {
    id: "BTCUSDT",
    name: "Bitcoin / TetherUS",
    provider: "binance",
    assetClass: "crypto",
    exchange: "BINANCE",
    base: "BTC",
    quote: "USDT",
    pricePrecision: 2,
    tickSize: 0.01,
    providerSymbol: "BTCUSDT",
    streamable: true,
  },
  {
    id: "ETHUSDT",
    name: "Ethereum / TetherUS",
    provider: "binance",
    assetClass: "crypto",
    exchange: "BINANCE",
    base: "ETH",
    quote: "USDT",
    pricePrecision: 2,
    tickSize: 0.01,
    providerSymbol: "ETHUSDT",
    streamable: true,
  },
  {
    id: "SOLUSDT",
    name: "Solana / TetherUS",
    provider: "binance",
    assetClass: "crypto",
    exchange: "BINANCE",
    base: "SOL",
    quote: "USDT",
    pricePrecision: 2,
    tickSize: 0.01,
    providerSymbol: "SOLUSDT",
    streamable: true,
  },
  {
    id: "BNBUSDT",
    name: "BNB / TetherUS",
    provider: "binance",
    assetClass: "crypto",
    exchange: "BINANCE",
    base: "BNB",
    quote: "USDT",
    pricePrecision: 2,
    tickSize: 0.01,
    providerSymbol: "BNBUSDT",
    streamable: true,
  },
  {
    id: "XRPUSDT",
    name: "XRP / TetherUS",
    provider: "binance",
    assetClass: "crypto",
    exchange: "BINANCE",
    base: "XRP",
    quote: "USDT",
    pricePrecision: 4,
    tickSize: 0.0001,
    providerSymbol: "XRPUSDT",
    streamable: true,
  },
  {
    id: "ADAUSDT",
    name: "Cardano / TetherUS",
    provider: "binance",
    assetClass: "crypto",
    exchange: "BINANCE",
    base: "ADA",
    quote: "USDT",
    pricePrecision: 4,
    tickSize: 0.0001,
    providerSymbol: "ADAUSDT",
    streamable: true,
  },
  {
    id: "DOGEUSDT",
    name: "Dogecoin / TetherUS",
    provider: "binance",
    assetClass: "crypto",
    exchange: "BINANCE",
    base: "DOGE",
    quote: "USDT",
    pricePrecision: 5,
    tickSize: 0.00001,
    providerSymbol: "DOGEUSDT",
    streamable: true,
  },

  // ---- Forex (OANDA primary; providerSymbol = OANDA underscore format) ----
  {
    id: "EURUSD",
    name: "Euro / US Dollar",
    provider: "oanda",
    assetClass: "forex",
    exchange: "FX",
    base: "EUR",
    quote: "USD",
    pricePrecision: 5,
    tickSize: 0.00001,
    providerSymbol: "EUR_USD",
    streamable: true,
  },
  {
    id: "GBPUSD",
    name: "British Pound / US Dollar",
    provider: "oanda",
    assetClass: "forex",
    exchange: "FX",
    base: "GBP",
    quote: "USD",
    pricePrecision: 5,
    tickSize: 0.00001,
    providerSymbol: "GBP_USD",
    streamable: true,
  },
  {
    id: "USDJPY",
    name: "US Dollar / Japanese Yen",
    provider: "oanda",
    assetClass: "forex",
    exchange: "FX",
    base: "USD",
    quote: "JPY",
    pricePrecision: 3,
    tickSize: 0.001,
    providerSymbol: "USD_JPY",
    streamable: true,
  },
  {
    id: "AUDUSD",
    name: "Australian Dollar / US Dollar",
    provider: "oanda",
    assetClass: "forex",
    exchange: "FX",
    base: "AUD",
    quote: "USD",
    pricePrecision: 5,
    tickSize: 0.00001,
    providerSymbol: "AUD_USD",
    streamable: true,
  },
  {
    id: "USDCAD",
    name: "US Dollar / Canadian Dollar",
    provider: "oanda",
    assetClass: "forex",
    exchange: "FX",
    base: "USD",
    quote: "CAD",
    pricePrecision: 5,
    tickSize: 0.00001,
    providerSymbol: "USD_CAD",
    streamable: true,
  },
  {
    id: "USDCHF",
    name: "US Dollar / Swiss Franc",
    provider: "oanda",
    assetClass: "forex",
    exchange: "FX",
    base: "USD",
    quote: "CHF",
    pricePrecision: 5,
    tickSize: 0.00001,
    providerSymbol: "USD_CHF",
    streamable: true,
  },

  // ---- Metals (OANDA primary) ----
  {
    id: "XAUUSD",
    name: "Gold / US Dollar",
    provider: "oanda",
    assetClass: "metal",
    exchange: "OANDA",
    base: "XAU",
    quote: "USD",
    pricePrecision: 2,
    tickSize: 0.01,
    providerSymbol: "XAU_USD",
    streamable: true,
  },
  {
    id: "XAGUSD",
    name: "Silver / US Dollar",
    provider: "oanda",
    assetClass: "metal",
    exchange: "OANDA",
    base: "XAG",
    quote: "USD",
    pricePrecision: 3,
    tickSize: 0.001,
    providerSymbol: "XAG_USD",
    streamable: true,
  },

  // ---- Indices (OANDA primary — CFD instruments) ----
  {
    id: "SPX500",
    name: "S&P 500 Index",
    provider: "oanda",
    assetClass: "index",
    exchange: "INDEX",
    pricePrecision: 2,
    tickSize: 0.1,
    providerSymbol: "US_SPX500",
    streamable: true,
  },
  {
    id: "NAS100",
    name: "Nasdaq 100 Index",
    provider: "oanda",
    assetClass: "index",
    exchange: "INDEX",
    pricePrecision: 2,
    tickSize: 0.1,
    providerSymbol: "US_NAS100",
    streamable: true,
  },
];

const byId = new Map(MARKET_SYMBOLS.map((s) => [s.id, s]));

export function getMarketSymbol(id: string): MarketSymbol | undefined {
  return byId.get(id);
}

/**
 * Canonical → TwelveData providerSymbol map (for TwelveDataProvider.symbolMap).
 * Only symbols that still route via TwelveData (OANDA replacement means this
 * map is now empty by default, kept for backward compat if TwelveData is used
 * as a fallback).
 */
export function twelveDataSymbolMap(): Record<string, string> {
  return Object.fromEntries(
    MARKET_SYMBOLS.filter((s) => s.provider === "twelvedata").map((s) => [
      s.id,
      s.providerSymbol,
    ]),
  );
}

/** Canonical → OANDA instrument name (underscore format). */
export function oandaInstrument(symbol: string): string {
  return getMarketSymbol(symbol)?.providerSymbol ?? symbol;
}
