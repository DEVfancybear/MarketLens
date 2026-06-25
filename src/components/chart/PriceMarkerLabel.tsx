'use client';
import { useChartStore } from '@/store/chartStore';
import { useMarketDataStore } from '@/store/marketDataStore';
import { getMarketSymbol } from '@/services/market-data/symbols';
import { useCountdown } from '@/hooks/useCountdown';
import { fmtPrice } from '@/utils/format';

/**
 * TradingView-style price marker label — the compact box in the top-left of the
 * chart that shows:
 *
 *   [SYMBOL]  14px bold white
 *   [PRICE]   24px bold green/red (tabular)
 *   [0:42]    12px medium grey  (tabular countdown)
 *
 * Renders only when live quote data is available. Updates on every price tick
 * and every countdown tick (4×/s).  Zero data flow changes — reads from stores.
 */
export function PriceMarkerLabel() {
  const symbol = useChartStore((s) => s.symbol);
  const timeframe = useChartStore((s) => s.timeframe);
  const quote = useMarketDataStore((s) => s.quotes[symbol]);
  const countdown = useCountdown(timeframe);

  const precision = getMarketSymbol(symbol)?.pricePrecision ?? 2;

  if (!quote) return null;

  const up = quote.change >= 0;
  const priceColor = up ? 'var(--bull)' : 'var(--bear)';

  return (
    <div className="pointer-events-none absolute left-0 top-0 z-10 flex items-start gap-3">
      {/* Price marker box — TradingView style: dark bg, compact, rounded */}
      <div className="flex flex-col items-start rounded-md bg-terminal-panel/90 px-3 py-1.5 backdrop-blur-sm">
        {/* Symbol line: 14px bold white */}
        <span className="text-sm font-bold leading-tight text-ink">
          {symbol}
        </span>

        {/* Price line: 24px bold colored, tabular */}
        <span
          className="tabular text-[26px] font-bold leading-none"
          style={{ color: priceColor }}
        >
          {fmtPrice(quote.last, precision)}
        </span>

        {/* Countdown: 12px medium grey, tabular */}
        <span className="tabular text-xs font-medium leading-tight text-ink-muted">
          {countdown}
        </span>
      </div>
    </div>
  );
}
