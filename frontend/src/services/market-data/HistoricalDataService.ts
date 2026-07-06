/**
 * HistoricalDataService (Phase 1, Step 7).
 *
 * Loads historical candles over REST before the realtime feed takes over,
 * routed to the right provider via the symbol registry and normalized to
 * unified `MarketCandle[]` (ascending by time, all `closed: true`).
 *
 *  - Binance:  `GET /api/v3/klines` (max 1000/request → paginated with `endTime`).
 *  - TwelveData: `GET /time_series` (`outputsize` up to 5000, `order=ASC`).
 *  - OANDA:    `GET /v3/instruments/{instrument}/candles` (max 5000, `price=MBA`).
 *
 * Pure service layer — returns candles; callers (hooks/chart) push them into
 * `marketDataStore.setCandles`. CORS-friendly endpoints (client fetch).
 */
import {
  type HistoryRequest,
  type MarketCandle,
  type Timeframe,
} from "@/types";
import { getMarketSymbol, twelveDataSymbol } from "./symbols";

const BINANCE_KLINES = "https://api.binance.com/api/v3/klines";
const TWELVEDATA_TS = "https://api.twelvedata.com/time_series";
const OANDA_PRACTICE = "https://api-fxpractice.oanda.com/v3";
const OANDA_LIVE = "https://api-fxtrade.oanda.com/v3";
const MAX_LIMIT = 5000;
const BINANCE_PAGE = 1000;

/** Unified Timeframe → Binance interval. */
const TF_TO_BINANCE: Record<Timeframe, string> = {
  "1m": "1m",
  "3m": "3m",
  "5m": "5m",
  "15m": "15m",
  "30m": "30m",
  "1H": "1h",
  "2H": "2h",
  "4H": "4h",
  "1D": "1d",
  "1W": "1w",
  "1M": "1M",
};

/** Unified Timeframe → TwelveData interval. */
const TF_TO_TD: Record<Timeframe, string> = {
  "1m": "1min",
  "3m": "5min",
  "5m": "5min",
  "15m": "15min",
  "30m": "30min",
  "1H": "1h",
  "2H": "2h",
  "4H": "4h",
  "1D": "1day",
  "1W": "1week",
  "1M": "1month",
};

/** Unified Timeframe → OANDA granularity. */
const TF_TO_OANDA: Record<Timeframe, string> = {
  "1m": "M1",
  "3m": "M3",
  "5m": "M5",
  "15m": "M15",
  "30m": "M30",
  "1H": "H1",
  "2H": "H2",
  "4H": "H4",
  "1D": "D",
  "1W": "W",
  "1M": "M",
};

export interface HistoricalDataServiceOptions {
  twelveDataApiKey?: string;
  oandaApiKey?: string;
  oandaPractice?: boolean;
}

export class HistoricalDataService {
  private readonly tdKey: string;
  private readonly oandaKey: string;
  private readonly oandaBase: string;

  constructor(opts: HistoricalDataServiceOptions = {}) {
    this.tdKey =
      opts.twelveDataApiKey ?? process.env.NEXT_PUBLIC_TWELVEDATA_API_KEY ?? "";
    this.oandaKey =
      opts.oandaApiKey ?? process.env.NEXT_PUBLIC_OANDA_API_KEY ?? "";
    this.oandaBase = opts.oandaPractice !== false ? OANDA_PRACTICE : OANDA_LIVE;
  }

  /** Load up to `limit` (capped 5000) candles, optionally ending before `before` (sec). */
  async loadHistory(req: HistoryRequest): Promise<MarketCandle[]> {
    const { symbol, timeframe, limit = 1500, before } = req;
    const capped = Math.min(Math.max(limit, 1), MAX_LIMIT);
    const meta = getMarketSymbol(symbol);
    const providerSymbol = meta?.providerSymbol ?? symbol;
    const provider = meta?.provider;

    if (provider === "oanda") {
      if (!this.oandaKey && this.tdKey) {
        return this.loadTwelveData(
          twelveDataSymbol(symbol),
          timeframe,
          capped,
          before,
        );
      }
      return this.loadOanda(providerSymbol, timeframe, capped, before);
    }
    if (provider === "twelvedata") {
      return this.loadTwelveData(twelveDataSymbol(symbol), timeframe, capped, before);
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
    let endTime = before ? before * 1000 : undefined;
    let remaining = limit;
    let acc: MarketCandle[] = [];

    while (remaining > 0) {
      const batch = Math.min(remaining, BINANCE_PAGE);
      const url =
        `${BINANCE_KLINES}?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${batch}` +
        (endTime ? `&endTime=${endTime}` : "");
      const res = await fetch(url);
      if (!res.ok)
        throw new Error(`Binance klines ${res.status} for ${symbol}`);
      const rows = (await res.json()) as unknown[];
      if (!Array.isArray(rows) || rows.length === 0) break;

      const candles = rows.map((r) => {
        const row = r as [number, string, string, string, string, string];
        return {
          time: Math.floor(Number(row[0]) / 1000),
          open: +row[1],
          high: +row[2],
          low: +row[3],
          close: +row[4],
          volume: +row[5],
          closed: true,
        } satisfies MarketCandle;
      });

      acc = [...candles, ...acc];
      remaining -= candles.length;
      if (candles.length < batch) break;
      endTime = Number((rows[0] as unknown[])[0]) - 1;
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
    if (!this.tdKey)
      throw new Error(
        "TwelveData API key missing (NEXT_PUBLIC_TWELVEDATA_API_KEY)",
      );
    const params = new URLSearchParams({
      symbol,
      interval: TF_TO_TD[timeframe],
      outputsize: String(limit),
      order: "ASC",
      format: "JSON",
      apikey: this.tdKey,
    });
    if (before) params.set("end_date", isoFromSeconds(before));

    const res = await fetch(`${TWELVEDATA_TS}?${params.toString()}`);
    if (!res.ok)
      throw new Error(`TwelveData time_series ${res.status} for ${symbol}`);
    const data = (await res.json()) as {
      status?: string;
      message?: string;
      values?: Array<{
        datetime: string;
        open: string;
        high: string;
        low: string;
        close: string;
        volume?: string;
      }>;
    };
    if (data.status === "error")
      throw new Error(`TwelveData: ${data.message ?? "error"} (${symbol})`);
    if (!Array.isArray(data.values)) return [];

    const candles = data.values.map<MarketCandle>((v) => ({
      time: parseTwelveDataTime(v.datetime),
      open: +v.open,
      high: +v.high,
      low: +v.low,
      close: +v.close,
      volume: v.volume != null ? +v.volume : 0,
      closed: true,
    }));
    return dedupeAscending(candles).slice(-limit);
  }

  // ------------------------------------------------------------------ OANDA
  private async loadOanda(
    symbol: string,
    timeframe: Timeframe,
    limit: number,
    before?: number,
  ): Promise<MarketCandle[]> {
    if (!this.oandaKey)
      throw new Error("OANDA API key missing (NEXT_PUBLIC_OANDA_API_KEY)");
    const granularity = TF_TO_OANDA[timeframe];
    if (!granularity)
      throw new Error(`Unsupported timeframe for OANDA: ${timeframe}`);

    const params = new URLSearchParams({
      granularity,
      count: String(limit),
      price: "MBA",
    });
    if (before) params.set("to", String(Math.floor(before)));

    const res = await fetch(
      `${this.oandaBase}/instruments/${encodeURIComponent(symbol)}/candles?${params.toString()}`,
      { headers: { Authorization: `Bearer ${this.oandaKey}` } },
    );
    if (!res.ok) throw new Error(`OANDA candles ${res.status} for ${symbol}`);
    const data = (await res.json()) as OandaCandlesResponse;
    if (!Array.isArray(data.candles)) return [];

    const candles: MarketCandle[] = data.candles.map((c) => {
      const ohlc = c.mid ?? c.bid ?? c.ask;
      const volumeRaw = Number(c.volume ?? 0);
      return {
        time: Math.floor(Date.parse(c.time) / 1000),
        open: ohlc ? +ohlc.o : 0,
        high: ohlc ? +ohlc.h : 0,
        low: ohlc ? +ohlc.l : 0,
        close: ohlc ? +ohlc.c : 0,
        volume: Number.isFinite(volumeRaw) ? volumeRaw : 0,
        closed: c.complete === false ? false : true,
      };
    });
    return dedupeAscending(candles).slice(-limit);
  }
}

// ---- helpers ----------------------------------------------------------------

function dedupeAscending(candles: MarketCandle[]): MarketCandle[] {
  const map = new Map<number, MarketCandle>();
  for (const c of candles) map.set(c.time, c);
  return [...map.values()].sort((a, b) => a.time - b.time);
}

function parseTwelveDataTime(dt: string): number {
  const iso = dt.includes(" ") ? `${dt.replace(" ", "T")}Z` : `${dt}T00:00:00Z`;
  return Math.floor(Date.parse(iso) / 1000);
}

function isoFromSeconds(sec: number): string {
  return new Date(sec * 1000).toISOString().slice(0, 19).replace("T", " ");
}

// ---- singleton --------------------------------------------------------------
let singleton: HistoricalDataService | null = null;

export function getHistoricalDataService(
  opts?: HistoricalDataServiceOptions,
): HistoricalDataService {
  if (!singleton) singleton = new HistoricalDataService(opts);
  return singleton;
}

// ------------------------------------------------------------------ OANDA API types
interface OandaCandlesResponse {
  candles?: OandaCandle[];
}

interface OandaOhlc {
  o: string;
  h: string;
  l: string;
  c: string;
}

interface OandaCandle {
  time: string;
  complete?: boolean;
  volume?: number;
  mid?: OandaOhlc;
  bid?: OandaOhlc;
  ask?: OandaOhlc;
}
