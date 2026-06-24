/**
 * Mock market-data API.
 *
 * Generates deterministic, realistic OHLCV via a seeded random walk with
 * volatility clustering, intraday seasonality and occasional displacement
 * impulses (so the SMC engine has structure to find). Being seeded means the
 * same symbol always yields the same history — essential for reproducible
 * replay sessions and backtests.
 *
 * Base series is generated at 1-minute resolution then aggregated up to any
 * higher timeframe on demand.
 */
import {
  TF_SECONDS,
  type Candle,
  type Quote,
  type Symbol as Sym,
  type Timeframe,
} from '@/types';

export const SYMBOLS: Sym[] = [
  { ticker: 'EURUSD', name: 'Euro / US Dollar', pricePrecision: 5, tickSize: 0.00001, type: 'forex' },
  { ticker: 'GBPUSD', name: 'British Pound / US Dollar', pricePrecision: 5, tickSize: 0.00001, type: 'forex' },
  { ticker: 'USDJPY', name: 'US Dollar / Japanese Yen', pricePrecision: 3, tickSize: 0.001, type: 'forex' },
  { ticker: 'XAUUSD', name: 'Gold Spot / US Dollar', pricePrecision: 2, tickSize: 0.01, type: 'commodity' },
  { ticker: 'BTCUSD', name: 'Bitcoin / US Dollar', pricePrecision: 1, tickSize: 0.1, type: 'crypto' },
  { ticker: 'ETHUSD', name: 'Ethereum / US Dollar', pricePrecision: 2, tickSize: 0.01, type: 'crypto' },
  { ticker: 'NAS100', name: 'Nasdaq 100 Index', pricePrecision: 1, tickSize: 0.1, type: 'index' },
  { ticker: 'SPX500', name: 'S&P 500 Index', pricePrecision: 1, tickSize: 0.1, type: 'index' },
  { ticker: 'AAPL', name: 'Apple Inc.', pricePrecision: 2, tickSize: 0.01, type: 'stock' },
  { ticker: 'TSLA', name: 'Tesla Inc.', pricePrecision: 2, tickSize: 0.01, type: 'stock' },
];

const SYMBOL_MAP = new Map(SYMBOLS.map((s) => [s.ticker, s]));

export function getSymbol(ticker: string): Sym | undefined {
  return SYMBOL_MAP.get(ticker);
}

/** Per-symbol generator parameters. */
interface Profile {
  start: number;
  drift: number; // per-bar percentage drift
  vol: number; // base per-bar volatility (fraction of price)
  baseVolume: number;
}

function profile(ticker: string): Profile {
  switch (ticker) {
    case 'EURUSD': return { start: 1.085, drift: 0.000002, vol: 0.00035, baseVolume: 1200 };
    case 'GBPUSD': return { start: 1.272, drift: 0.000001, vol: 0.0004, baseVolume: 1000 };
    case 'USDJPY': return { start: 156.2, drift: 0.000003, vol: 0.00035, baseVolume: 1100 };
    case 'XAUUSD': return { start: 2330, drift: 0.000005, vol: 0.0006, baseVolume: 800 };
    case 'BTCUSD': return { start: 64200, drift: 0.000006, vol: 0.0014, baseVolume: 600 };
    case 'ETHUSD': return { start: 3450, drift: 0.000005, vol: 0.0016, baseVolume: 700 };
    case 'NAS100': return { start: 19800, drift: 0.000004, vol: 0.0007, baseVolume: 900 };
    case 'SPX500': return { start: 5470, drift: 0.000004, vol: 0.0005, baseVolume: 900 };
    case 'AAPL': return { start: 212, drift: 0.000004, vol: 0.0009, baseVolume: 500 };
    case 'TSLA': return { start: 184, drift: 0.000002, vol: 0.0018, baseVolume: 450 };
    default: return { start: 100, drift: 0, vol: 0.001, baseVolume: 500 };
  }
}

/** Mulberry32 — tiny, fast, deterministic PRNG. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(ticker: string): number {
  let h = 2166136261;
  for (let i = 0; i < ticker.length; i++) {
    h ^= ticker.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Box-Muller gaussian from a uniform PRNG. */
function gauss(rnd: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rnd();
  while (v === 0) v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const cache = new Map<string, Candle[]>();

/**
 * Generate `bars1m` one-minute candles ending at `endTime` (UTC seconds,
 * default: aligned to "now" of the simulated dataset).
 */
function generate1m(ticker: string, bars1m: number, endTime: number): Candle[] {
  const key = `${ticker}:${bars1m}:${endTime}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const p = profile(ticker);
  const rnd = mulberry32(hashSeed(ticker));
  const out: Candle[] = new Array(bars1m);

  let price = p.start;
  let vol = p.vol;
  const startTime = endTime - bars1m * 60;

  for (let i = 0; i < bars1m; i++) {
    const time = startTime + i * 60;
    const date = new Date(time * 1000);
    const hourUTC = date.getUTCHours();
    const dow = date.getUTCDay();

    // Volatility clustering (GARCH-ish mean reversion of vol).
    vol += (p.vol - vol) * 0.02 + (rnd() - 0.5) * p.vol * 0.06;
    vol = Math.max(p.vol * 0.35, Math.min(p.vol * 3, vol));

    // Intraday seasonality: London (7-16) & NY (13-21) more active; weekends thin.
    let seas = 0.55;
    if (hourUTC >= 7 && hourUTC < 16) seas += 0.6;
    if (hourUTC >= 13 && hourUTC < 21) seas += 0.7;
    if (dow === 0 || dow === 6) seas *= 0.4;

    const open = price;
    let move = (p.drift + gauss(rnd) * vol) * seas;

    // Occasional displacement impulse (~0.4% of bars) to seed SMC structure.
    if (rnd() < 0.004) move += (rnd() < 0.5 ? -1 : 1) * vol * seas * (6 + rnd() * 10);

    const close = Math.max(open * (1 + move), p.start * 0.05);
    const wick = open * vol * seas * (0.5 + rnd());
    const high = Math.max(open, close) + wick * rnd();
    const low = Math.min(open, close) - wick * rnd();
    const volume = Math.round(p.baseVolume * seas * (0.6 + rnd() * 1.4) * (1 + Math.abs(move) / vol));

    out[i] = { time, open, high, low, close, volume };
    price = close;
  }

  cache.set(key, out);
  return out;
}

/** Aggregate 1m candles into a higher timeframe. */
function aggregate(base: Candle[], tf: Timeframe): Candle[] {
  const span = TF_SECONDS[tf];
  if (span === 60) return base;
  const out: Candle[] = [];
  let bucket: Candle | null = null;
  let bucketStart = -1;

  for (const c of base) {
    const start = Math.floor(c.time / span) * span;
    if (start !== bucketStart) {
      if (bucket) out.push(bucket);
      bucket = { ...c, time: start };
      bucketStart = start;
    } else if (bucket) {
      bucket.high = Math.max(bucket.high, c.high);
      bucket.low = Math.min(bucket.low, c.low);
      bucket.close = c.close;
      bucket.volume += c.volume;
    }
  }
  if (bucket) out.push(bucket);
  return out;
}

/** Default anchor: the most recent whole hour, so sessions line up. */
function defaultEndTime(): number {
  return Math.floor(Date.now() / 3600000) * 3600;
}

export interface HistoryRequest {
  ticker: string;
  timeframe: Timeframe;
  /** Number of bars to return at the requested timeframe. */
  limit?: number;
  endTime?: number;
}

/**
 * Fetch historical candles. Simulates async latency; safe to call from
 * React Query. Generates enough 1m base data to cover `limit` higher-TF bars.
 */
export async function fetchHistory({
  ticker,
  timeframe,
  limit = 1500,
  endTime = defaultEndTime(),
}: HistoryRequest): Promise<Candle[]> {
  const factor = TF_SECONDS[timeframe] / 60;
  // Generate a healthy buffer of 1m bars, capped for memory sanity.
  const bars1m = Math.min(Math.ceil(limit * factor * 1.15), 1_500_000);
  const base = generate1m(ticker, bars1m, endTime);
  const agg = aggregate(base, timeframe);
  await new Promise((r) => setTimeout(r, 60)); // simulated network latency
  return agg.slice(-limit);
}

/** Synchronous variant for engines/workers that already hold a 1m anchor. */
export function getHistorySync(req: HistoryRequest): Candle[] {
  const { ticker, timeframe, limit = 1500, endTime = defaultEndTime() } = req;
  const factor = TF_SECONDS[timeframe] / 60;
  const bars1m = Math.min(Math.ceil(limit * factor * 1.15), 1_500_000);
  const base = generate1m(ticker, bars1m, endTime);
  return aggregate(base, timeframe).slice(-limit);
}

/** Snapshot quote derived from the most recent two daily candles. */
export async function fetchQuote(ticker: string): Promise<Quote> {
  const daily = await fetchHistory({ ticker, timeframe: '1D', limit: 2 });
  const last = daily[daily.length - 1];
  const prev = daily[daily.length - 2] ?? last;
  const changePct = prev ? ((last.close - prev.close) / prev.close) * 100 : 0;
  return {
    ticker,
    last: last.close,
    changePct,
    volume: last.volume,
    high: last.high,
    low: last.low,
  };
}
