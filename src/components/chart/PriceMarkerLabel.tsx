"use client";
import { useChartStore } from "@/store/chartStore";
import { useMarketDataStore } from "@/store/marketDataStore";
import { getMarketSymbol } from "@/services/market-data/symbols";
import { useCountdown } from "@/hooks/useCountdown";
import { fmtPrice } from "@/utils/format";

/**
 * TradingView-style price marker on the RIGHT side of the chart.
 *
 * TradingView's pattern:
 *   [SYMBOL]        right-aligned, 11px bold
 *   [PRICE]         right-aligned, ~16px bold green/red tabular
 *   [COUNTDOWN]     right-aligned, 11px grey tabular
 *
 * This overlays the right price scale area. The LWC built-in lastValueVisible
 * is turned OFF to avoid doubling up with this component.
 *
 * Renders only when live quote data is available. Zero data flow changes.
 */
export function PriceMarkerLabel() {
  const symbol = useChartStore((s) => s.symbol);
  const timeframe = useChartStore((s) => s.timeframe);
  const quote = useMarketDataStore((s) => s.quotes[symbol]);
  const countdown = useCountdown(timeframe);

  const precision = getMarketSymbol(symbol)?.pricePrecision ?? 2;

  if (!quote) return null;

  const up = quote.change >= 0;
  const priceColor = up ? "var(--bull)" : "var(--bear)";

  return (
    <div className="pointer-events-none absolute right-0 top-1/2 z-10 -translate-y-1/2 pr-1">
      <div className="flex flex-col items-end gap-0">
        {/* Symbol: 11px bold white, right-aligned */}
        <span className="text-[11px] font-bold leading-none text-ink">
          {symbol}
        </span>

        {/* Price: 16px bold green/red, tabular, right-aligned */}
        <span
          className="tabular text-[16px] font-bold leading-none"
          style={{ color: priceColor }}
        >
          {fmtPrice(quote.last, precision)}
        </span>

        {/* Countdown: 11px grey, tabular, right-aligned */}
        <span className="tabular text-[11px] leading-tight text-ink-muted">
          {countdown}
        </span>
      </div>
    </div>
  );
}
