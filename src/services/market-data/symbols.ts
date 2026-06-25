/**
 * Canonical market symbol registry (Phase 1, Step 6).
 *
 * This is **configuration**, not mock market data — it defines which provider
 * serves each symbol and how the canonical app id maps to the provider's native
 * id (Binance "BTCUSDT", TwelveData "XAU/USD"). The MarketDataService uses it to
 * route subscriptions; the watchlist/symbol-search will consume it in Steps 10+.
 *
 * Crypto → BinanceProvider (no key). Forex/metals/indices → TwelveDataProvider
 * (needs NEXT_PUBLIC_TWELVEDATA_API_KEY). Index `providerSymbol`s are best-effort
 * and may need refinement per the TwelveData plan.
 */
import type { MarketSymbol } from '@/types';

export const MARKET_SYMBOLS: MarketSymbol[] = [
  // ---- Crypto (Binance) — providerSymbol === canonical id ----
  { id: 'BTCUSDT', name: 'Bitcoin / TetherUS', provider: 'binance', assetClass: 'crypto', exchange: 'BINANCE', base: 'BTC', quote: 'USDT', pricePrecision: 2, tickSize: 0.01, providerSymbol: 'BTCUSDT', streamable: true },
  { id: 'ETHUSDT', name: 'Ethereum / TetherUS', provider: 'binance', assetClass: 'crypto', exchange: 'BINANCE', base: 'ETH', quote: 'USDT', pricePrecision: 2, tickSize: 0.01, providerSymbol: 'ETHUSDT', streamable: true },
  { id: 'SOLUSDT', name: 'Solana / TetherUS', provider: 'binance', assetClass: 'crypto', exchange: 'BINANCE', base: 'SOL', quote: 'USDT', pricePrecision: 2, tickSize: 0.01, providerSymbol: 'SOLUSDT', streamable: true },
  { id: 'BNBUSDT', name: 'BNB / TetherUS', provider: 'binance', assetClass: 'crypto', exchange: 'BINANCE', base: 'BNB', quote: 'USDT', pricePrecision: 2, tickSize: 0.01, providerSymbol: 'BNBUSDT', streamable: true },
  { id: 'XRPUSDT', name: 'XRP / TetherUS', provider: 'binance', assetClass: 'crypto', exchange: 'BINANCE', base: 'XRP', quote: 'USDT', pricePrecision: 4, tickSize: 0.0001, providerSymbol: 'XRPUSDT', streamable: true },
  { id: 'ADAUSDT', name: 'Cardano / TetherUS', provider: 'binance', assetClass: 'crypto', exchange: 'BINANCE', base: 'ADA', quote: 'USDT', pricePrecision: 4, tickSize: 0.0001, providerSymbol: 'ADAUSDT', streamable: true },
  { id: 'DOGEUSDT', name: 'Dogecoin / TetherUS', provider: 'binance', assetClass: 'crypto', exchange: 'BINANCE', base: 'DOGE', quote: 'USDT', pricePrecision: 5, tickSize: 0.00001, providerSymbol: 'DOGEUSDT', streamable: true },

  // ---- Forex (TwelveData) ----
  { id: 'EURUSD', name: 'Euro / US Dollar', provider: 'twelvedata', assetClass: 'forex', exchange: 'FX', base: 'EUR', quote: 'USD', pricePrecision: 5, tickSize: 0.00001, providerSymbol: 'EUR/USD', streamable: true },
  { id: 'GBPUSD', name: 'British Pound / US Dollar', provider: 'twelvedata', assetClass: 'forex', exchange: 'FX', base: 'GBP', quote: 'USD', pricePrecision: 5, tickSize: 0.00001, providerSymbol: 'GBP/USD', streamable: true },
  { id: 'USDJPY', name: 'US Dollar / Japanese Yen', provider: 'twelvedata', assetClass: 'forex', exchange: 'FX', base: 'USD', quote: 'JPY', pricePrecision: 3, tickSize: 0.001, providerSymbol: 'USD/JPY', streamable: true },
  { id: 'AUDUSD', name: 'Australian Dollar / US Dollar', provider: 'twelvedata', assetClass: 'forex', exchange: 'FX', base: 'AUD', quote: 'USD', pricePrecision: 5, tickSize: 0.00001, providerSymbol: 'AUD/USD', streamable: true },

  // ---- Metals (TwelveData) ----
  { id: 'XAUUSD', name: 'Gold / US Dollar', provider: 'twelvedata', assetClass: 'metal', exchange: 'OANDA', base: 'XAU', quote: 'USD', pricePrecision: 2, tickSize: 0.01, providerSymbol: 'XAU/USD', streamable: true },
  { id: 'XAGUSD', name: 'Silver / US Dollar', provider: 'twelvedata', assetClass: 'metal', exchange: 'OANDA', base: 'XAG', quote: 'USD', pricePrecision: 3, tickSize: 0.001, providerSymbol: 'XAG/USD', streamable: true },

  // ---- Indices (TwelveData; providerSymbol best-effort) ----
  { id: 'SPX500', name: 'S&P 500 Index', provider: 'twelvedata', assetClass: 'index', exchange: 'INDEX', pricePrecision: 2, tickSize: 0.01, providerSymbol: 'SPX', streamable: true },
  { id: 'NAS100', name: 'Nasdaq 100 Index', provider: 'twelvedata', assetClass: 'index', exchange: 'INDEX', pricePrecision: 2, tickSize: 0.01, providerSymbol: 'IXIC', streamable: true },
];

const byId = new Map(MARKET_SYMBOLS.map((s) => [s.id, s]));

export function getMarketSymbol(id: string): MarketSymbol | undefined {
  return byId.get(id);
}

/** Canonical → TwelveData providerSymbol map (for TwelveDataProvider.symbolMap). */
export function twelveDataSymbolMap(): Record<string, string> {
  return Object.fromEntries(
    MARKET_SYMBOLS.filter((s) => s.provider === 'twelvedata').map((s) => [s.id, s.providerSymbol]),
  );
}
