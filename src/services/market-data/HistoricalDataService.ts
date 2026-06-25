/**
 * HistoricalDataService (Phase 1, Step 7).
 *
 * Loads historical candles over REST before the WebSocket takes over, routed to
 * the right provider via the symbol registry and normalized to unified
 * `MarketCandle[]` (ascending by time, all `closed: true`).
 *
 *  - Binance: `GET /api/v3/klines` (max 1000/request → paginated with `endTime`).
 *  - TwelveData: `GET /time_series` (`outputsize` up to 5000, `order=ASC`).
 *
 * Pure service layer — returns candles; callers (hooks/chart, Steps 9–13) push
 * them into `marketDataStore.setCandles`. CORS-friendly endpoints (client fetch).
 */
import { type HistoryRequest, type MarketCandle, type Timeframe } from '@/types';
import { getMarketSymbol } from './symbols';

const BINANCE_KLINES = 'https://api.binance.com/api/v3/klines';
const TWELVEDATA_TS = 'https://api.twelvedata.com/time_series';
const MAX_LIMIT = 5000;
const BINANCE_PAGE = 1000;

/** Unified Timeframe → Binance interval. */
const TF_TO_BINANCE: Record<Timeframe, string> = {
  '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m', '30m': '30m',
  '1H': '1h', '4H': '4h', '1D': '1d', '1W': '1w',
};

/** Unified Timeframe → TwelveData interval. (3m has no TD equivalent; not used
 *  in Phase 1's SUPPORTED_TIMEFRAMES — mapped to 5min as a harmless fallback.) */
const TF_TO_TD: Record<Timeframe, string> = {
  '1m': '1min', '3m': '5min', '5m': '5min', '15m': '15min', '30m': '30min',
  '1H': '1h', '4H': '4h', '1D': '1day', '1W': '1week',
};

export interface HistoricalDataServiceOptions {
  twelveDataApiKey?: string;
}

export class HistoricalDataService {
  private readonly apiKey: string;

  constructor(opts: HistoricalDataServiceOptions = {}) {
    this.apiKey = opts.twelveDataApiKey ?? process.env.NEXT_PUBLIC_TWELVEDATA_API_KEY ?? '';
  }

  /** Load up to `limit` (capped 5000) candles, optionally ending before `before` (sec). */
  async loadHistory(req: HistoryRequest): Promise<MarketCandle[]> {
    const { symbol, timeframe, limit = 1500, before } = req;
    const capped = Math.min(Math.max(limit, 1), MAX_LIMIT);
    const meta = getMarketSymbol(symbol);
    const providerSymbol = meta?.providerSymbol ?? symbol;
    if (meta?.provider === 'twelvedata') {
      return this.loadTwelveData(providerSymbol, timeframe, capped, before);
    }
    return this.loadBinance(providerSymbol, timeframe, capped, before);
  }

  // ------------------------------------------------------------------ Binance
  private async loadBinance(
    symbol: string,
    timeframe: Timeframe,
    limit: number,
    before?: number,
  ): Promise<MarketCandle[]> {
    const interval = TF_TO_BINANCE[timeframe];
    let endTime = before ? before * 1000 : undefined; // sec → ms
    let remaining = limit;
    let acc: MarketCandle[] = [];

    while (remaining > 0) {
      const batch = Math.min(remaining, BINANCE_PAGE);
      const url =
        `${BINANCE_KLINES}?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${batch}` +
        (endTime ? `&endTime=${endTime}` : '');
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Binance klines ${res.status} for ${symbol}`);
      const rows = (await res.json()) as unknown[];
      if (!Array.isArray(rows) || rows.length === 0) break;

      const candles = rows.map((r) => {
        const row = r as [number, string, string, string, string, string];
        return {
          time: Math.floor(Number(row[0]) / 1000),
          open: +row[1], high: +row[2], low: +row[3], close: +row[4], volume: +row[5],
          closed: true,
        } satisfies MarketCandle;
      });

      // Older batches are prepended (Binance returns each page ascending).
      acc = [...candles, ...acc];
      remaining -= candles.length;
      if (candles.length < batch) break; // reached the start of history
      endTime = Number((rows[0] as unknown[])[0]) - 1; // page older
    }

    return dedupeAscending(acc).slice(-limit);
  }

  // --------------------------------------------------------------- TwelveData
  private async loadTwelveData(
    symbol: string,
    timeframe: Timeframe,
    limit: number,
    before?: number,
  ): Promise<MarketCandle[]> {
    if (!this.apiKey) throw new Error('TwelveData API key missing (NEXT_PUBLIC_TWELVEDATA_API_KEY)');
    const params = new URLSearchParams({
      symbol,
      interval: TF_TO_TD[timeframe],
      outputsize: String(limit),
      order: 'ASC',
      format: 'JSON',
      apikey: this.apiKey,
    });
    if (before) params.set('end_date', isoFromSeconds(before));

    const res = await fetch(`${TWELVEDATA_TS}?${params.toString()}`);
    if (!res.ok) throw new Error(`TwelveData time_series ${res.status} for ${symbol}`);
    const data = (await res.json()) as {
      status?: string;
      message?: string;
      values?: Array<{ datetime: string; open: string; high: string; low: string; close: string; volume?: string }>;
    };
    if (data.status === 'error') throw new Error(`TwelveData: ${data.message ?? 'error'} (${symbol})`);
    if (!Array.isArray(data.values)) return [];

    const candles = data.values.map<MarketCandle>((v) => ({
      time: parseTwelveDataTime(v.datetime),
      open: +v.open, high: +v.high, low: +v.low, close: +v.close,
      volume: v.volume != null ? +v.volume : 0,
      closed: true,
    }));
    return dedupeAscending(candles).slice(-limit);
  }
}

// ---- helpers ----------------------------------------------------------------

/** Sort ascending by time and drop duplicate timestamps (keep last). */
function dedupeAscending(candles: MarketCandle[]): MarketCandle[] {
  const map = new Map<number, MarketCandle>();
  for (const c of candles) map.set(c.time, c);
  return [...map.values()].sort((a, b) => a.time - b.time);
}

/** TwelveData datetime ("YYYY-MM-DD HH:mm:ss" or "YYYY-MM-DD", UTC) → seconds. */
function parseTwelveDataTime(dt: string): number {
  const iso = dt.includes(' ') ? `${dt.replace(' ', 'T')}Z` : `${dt}T00:00:00Z`;
  return Math.floor(Date.parse(iso) / 1000);
}

/** UNIX seconds → "YYYY-MM-DD HH:mm:ss" (UTC) for TwelveData `end_date`. */
function isoFromSeconds(sec: number): string {
  return new Date(sec * 1000).toISOString().slice(0, 19).replace('T', ' ');
}

// ---- singleton --------------------------------------------------------------
let singleton: HistoricalDataService | null = null;

export function getHistoricalDataService(opts?: HistoricalDataServiceOptions): HistoricalDataService {
  if (!singleton) singleton = new HistoricalDataService(opts);
  return singleton;
}
