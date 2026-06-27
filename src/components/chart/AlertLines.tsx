"use client";
import { useEffect, useRef } from "react";
import type { IPriceLine } from "lightweight-charts";
import { useChartCtx } from "./ChartContext";
import { useAlertStore, CONDITION_SYMBOL } from "@/store/alertStore";
import { useChartStore } from "@/store/chartStore";
import { getMarketSymbol } from "@/services/market-data/symbols";
import { fmtPrice } from "@/utils/format";

/**
 * AlertLines — draws native lightweight-charts price lines for active alerts.
 *
 * Unlike AlertOverlay (which uses a custom canvas for interactive drag/select),
 * this component uses the chart library's built-in `createPriceLine` API.
 * PriceLine is rock-solid: it is drawn by the chart engine itself, scrolls
 * with the price scale, and needs zero canvas hacks.
 *
 * This guarantees that every active alert for the current symbol ALWAYS shows
 * a visible horizontal line — the core TradingView behaviour the user expects.
 */
export function AlertLines() {
  const ctx = useChartCtx();
  const symbol = useChartStore((s) => s.symbol);
  const alerts = useAlertStore((s) => s.alerts);
  const linesRef = useRef<Map<string, IPriceLine>>(new Map());

  const symbolAlerts = alerts.filter(
    (a) => a.symbol === symbol && a.enabled,
  );
  const prec = getMarketSymbol(symbol)?.pricePrecision ?? 2;

  useEffect(() => {
    const series = ctx?.candleSeries;
    if (!series) return;

    const currentIds = new Set(symbolAlerts.map((a) => a.id));
    const existing = linesRef.current;

    // Remove lines for alerts that are gone.
    for (const [id, line] of existing) {
      if (!currentIds.has(id)) {
        series.removePriceLine(line);
        existing.delete(id);
      }
    }

    // Add/replace lines for current alerts.
    for (const a of symbolAlerts) {
      const label = `🔔 ${CONDITION_SYMBOL[a.condition]} ${fmtPrice(a.price, prec)}`;
      if (existing.has(a.id)) {
        // Update existing line's price/title (lightweight-charts v4 doesn't
        // support direct mutation, so remove + recreate).
        series.removePriceLine(existing.get(a.id)!);
      }
      const line = series.createPriceLine({
        price: a.price,
        color: "#f7a600",
        lineWidth: 1,
        lineStyle: 0, // solid
        axisLabelVisible: true,
        title: label,
      });
      existing.set(a.id, line);
    }

    return () => {
      // Clean up all lines on unmount or when ctx changes.
      for (const [, line] of existing) {
        series.removePriceLine(line);
      }
      existing.clear();
    };
  }, [ctx, symbolAlerts, prec]);

  return null;
}
