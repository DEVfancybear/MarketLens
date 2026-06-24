/**
 * Core market data types. Times are UNIX seconds (UTC) to match
 * lightweight-charts' `UTCTimestamp` convention.
 */

export type Timeframe = '1m' | '3m' | '5m' | '15m' | '30m' | '1H' | '4H' | '1D' | '1W';

export const TIMEFRAMES: Timeframe[] = ['1m', '3m', '5m', '15m', '30m', '1H', '4H', '1D', '1W'];

/** Seconds-per-bar for each timeframe. */
export const TF_SECONDS: Record<Timeframe, number> = {
  '1m': 60,
  '3m': 180,
  '5m': 300,
  '15m': 900,
  '30m': 1800,
  '1H': 3600,
  '4H': 14400,
  '1D': 86400,
  '1W': 604800,
};

export interface Candle {
  /** UTC timestamp in seconds (bar open time). */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Symbol {
  ticker: string;
  name: string;
  /** Display precision for price. */
  pricePrecision: number;
  /** Minimum price increment. */
  tickSize: number;
  type: 'forex' | 'crypto' | 'stock' | 'index' | 'commodity';
}

export interface Quote {
  ticker: string;
  last: number;
  changePct: number;
  volume: number;
  high: number;
  low: number;
}
