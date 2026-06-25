'use client';
/**
 * useMtfSnapshotSeries (Phase 1, Step 17) — real higher-timeframe history for the
 * replay multi-timeframe panel.
 *
 * Replaces the deleted mock generator (`services/marketData.ts` → `getHistorySync`).
 * It loads each higher TF once from the real `HistoricalDataService` (Binance
 * crypto needs no key; TwelveData forex/metals/indices need
 * `NEXT_PUBLIC_TWELVEDATA_API_KEY`) and returns a per-timeframe map.
 *
 * The no-look-ahead guarantee is preserved by the engine: `mtfSnapshot()` slices
 * each series to the bar at/just before the replay cursor, so even though the
 * loaded history extends to "now", nothing past the cursor is ever shown.
 *
 * Only runs while replay is active and the symbol is in the registry; otherwise
 * it returns an empty map (the panel hides itself).
 */
import { useEffect, useState } from 'react';
import { getHistoricalDataService } from '@/services/market-data/HistoricalDataService';
import { getMarketSymbol } from '@/services/market-data/symbols';
import { useUIStore } from '@/store/uiStore';
import type { Candle, Timeframe } from '@/types';

/** Higher timeframes shown in the replay MTF panel. */
export const MTF_TIMEFRAMES: Timeframe[] = ['5m', '15m', '1H', '4H', '1D'];
const MTF_BARS = 500;

export type MtfSeries = Partial<Record<Timeframe, Candle[]>>;

export function useMtfSnapshotSeries(symbol: string, active: boolean): MtfSeries {
  const [series, setSeries] = useState<MtfSeries>({});

  useEffect(() => {
    // Skip when idle or the symbol has no real provider; clear any stale series.
    if (!active || !getMarketSymbol(symbol)) {
      setSeries({});
      return;
    }
    let cancelled = false;
    const svc = getHistoricalDataService();

    Promise.all(
      MTF_TIMEFRAMES.map((tf) =>
        svc
          .loadHistory({ symbol, timeframe: tf, limit: MTF_BARS })
          .then((candles) => [tf, candles as Candle[]] as const)
          .catch((err) => {
            useUIStore
              .getState()
              .log('warn', `MTF history ${symbol} ${tf} failed: ${String(err?.message ?? err)}`);
            return [tf, [] as Candle[]] as const;
          }),
      ),
    ).then((entries) => {
      if (cancelled) return;
      setSeries(Object.fromEntries(entries) as MtfSeries);
    });

    return () => {
      cancelled = true;
    };
  }, [symbol, active]);

  return series;
}
