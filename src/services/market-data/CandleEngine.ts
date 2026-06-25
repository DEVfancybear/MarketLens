/**
 * CandleEngine (Phase 1, Step 8).
 *
 * Merges historical candles with realtime data into a continuously-updating
 * "forming bar", TradingView-style:
 *
 *  - Kline providers (Binance) already send OHLC bars → `applyKline` passes them
 *    through (the store's `updateCandle` upsert also handles this).
 *  - Tick providers (TwelveData) send only price ticks → `applyTick` buckets each
 *    tick into the current timeframe bar (via `TF_SECONDS`), updating O/H/L/C/V
 *    and emitting the previous bar as `closed` when a new bucket opens.
 *
 * Pure, framework-free, per-`symbol:timeframe` state. The orchestration layer
 * (MarketDataService / chart integration) seeds it from history and feeds the
 * results into `marketDataStore`.
 */
import { TF_SECONDS, subscriptionKey, type MarketCandle, type Timeframe } from '@/types';

export interface MergeResult {
  /** The forming bar after the update (`closed: false`). */
  current: MarketCandle;
  /** A bar that just closed because a new bucket opened (`closed: true`). */
  closed?: MarketCandle;
}

export class CandleEngine {
  /** Forming bar per `symbol:timeframe`. */
  private readonly current = new Map<string, MarketCandle>();

  /** Seed the forming bar from loaded history (last bar continues forming). */
  seedHistory(symbol: string, timeframe: Timeframe, candles: MarketCandle[]) {
    const key = subscriptionKey(symbol, timeframe);
    const last = candles[candles.length - 1];
    if (last) this.current.set(key, { ...last, closed: false });
    else this.current.delete(key);
  }

  getCurrent(symbol: string, timeframe: Timeframe): MarketCandle | undefined {
    return this.current.get(subscriptionKey(symbol, timeframe));
  }

  /**
   * Merge a price tick (price + time in seconds) into the forming bar.
   * `volume` is the provider's cumulative day-volume if available (TwelveData);
   * per-bar volume isn't derivable from ticks, so we carry the latest value.
   */
  applyTick(
    symbol: string,
    timeframe: Timeframe,
    price: number,
    timeSec: number,
    volume?: number,
  ): MergeResult {
    const key = subscriptionKey(symbol, timeframe);
    const span = TF_SECONDS[timeframe];
    const bucket = Math.floor(timeSec / span) * span;
    const cur = this.current.get(key);

    // New bar (no current, or the tick rolled into a later bucket).
    if (!cur || bucket > cur.time) {
      const closed = cur && bucket > cur.time ? { ...cur, closed: true as const } : undefined;
      const fresh: MarketCandle = {
        time: bucket, open: price, high: price, low: price, close: price,
        volume: volume ?? 0, closed: false,
      };
      this.current.set(key, fresh);
      return { current: fresh, closed };
    }

    // Stale tick (older than the current bar) → ignore, return current unchanged.
    if (bucket < cur.time) return { current: cur };

    // Same bucket → extend the forming bar.
    const updated: MarketCandle = {
      ...cur,
      high: Math.max(cur.high, price),
      low: Math.min(cur.low, price),
      close: price,
      volume: volume != null ? volume : cur.volume,
      closed: false,
    };
    this.current.set(key, updated);
    return { current: updated };
  }

  /** Pass-through for kline providers; tracks state and flags closed bars. */
  applyKline(symbol: string, timeframe: Timeframe, candle: MarketCandle): MergeResult {
    const key = subscriptionKey(symbol, timeframe);
    this.current.set(key, { ...candle });
    return { current: candle, closed: candle.closed ? { ...candle } : undefined };
  }

  /** Clear engine state for a symbol/timeframe (or everything). */
  reset(symbol?: string, timeframe?: Timeframe) {
    if (!symbol) {
      this.current.clear();
      return;
    }
    if (timeframe) {
      this.current.delete(subscriptionKey(symbol, timeframe));
      return;
    }
    for (const k of [...this.current.keys()]) {
      if (k === symbol || k.startsWith(`${symbol}:`)) this.current.delete(k);
    }
  }
}
