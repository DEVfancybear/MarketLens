"use client";
import { useEffect, useRef } from "react";
import type { IPriceLine, ISeriesApi } from "lightweight-charts";
import { useChartCtx } from "./ChartContext";
import { useAtomValue } from "jotai";
import { symbolAtom } from "@/store/chartStore";
import { useAlertStore, CONDITION_SYMBOL } from "@/store/alertStore";
import { getMarketSymbol } from "@/services/market-data/symbols";
import { fmtPrice } from "@/utils/format";
import { alertLineRegistry, draggingAlertIds } from "./alertLineRegistry";
import { alertLineRenderKey } from "@/services/alertConditions";

/**
 * AlertLines — draws native lightweight-charts price lines for active alerts.
 *
 * Unlike AlertOverlay (which uses a custom canvas for interactive drag/select),
 * this component uses the chart library's built-in `createPriceLine` API.
 * PriceLine objects are owned by the chart engine — they reposition
 * automatically on zoom/pan, so we only recreate them when the set of
 * alerts changes (not on every ctx.version tick).
 *
 * This guarantees that every active alert for the current symbol ALWAYS shows
 * a visible horizontal line — the core TradingView behaviour the user expects.
 */
export function AlertLines() {
  const ctx = useChartCtx();
  const symbol = useAtomValue(symbolAtom);
  const alerts = useAlertStore((s) => s.alerts);
  const linesRef = useRef<Map<string, IPriceLine>>(new Map());
  // Stable ref to the candle series — never changes after chart init.
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  if (ctx?.candleSeries) seriesRef.current = ctx.candleSeries;

  const symbolAlerts = alerts.filter(
    (a) =>
      a.symbol === symbol &&
      a.enabled &&
      (!a.technicalTarget || a.technicalTarget.kind === "fixed-price"),
  );
  const prec = getMarketSymbol(symbol)?.pricePrecision ?? 2;
  // `symbolAlerts` is a fresh array every render (including on every chart tick,
  // since `ctx` changes reference each tick and both `symbol`/`alerts` selectors
  // re-run) — using it directly as an effect dependency would tear down and
  // recreate every native price line dozens of times per second. Key on a
  // primitive derived from the fields the effect actually cares about instead.
  const symbolAlertsKey = alertLineRenderKey(symbolAlerts);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;

    const currentIds = new Set(symbolAlerts.map((a) => a.id));
    const existing = linesRef.current;

    // Remove lines for alerts that no longer exist OR whose price changed.
    // Alerts currently being dragged are skipped: AlertOverlay moves the
    // native line imperatively during a drag (before the price is committed
    // to the store), and this effect can re-run for unrelated alertStore
    // changes — without the guard it would see the "stale" price and
    // destroy + recreate the line, snapping it back mid-drag.
    for (const [id, line] of existing) {
      const alert = symbolAlerts.find((a) => a.id === id);
      if (!alert || (alert.price !== line.options().price && !draggingAlertIds.has(id))) {
        series.removePriceLine(line);
        alertLineRegistry.delete(id);
        existing.delete(id);
      }
    }

    // Add lines for new alerts.
    for (const a of symbolAlerts) {
      if (existing.has(a.id)) continue; // already present + unchanged price
      const label = `🔔 ${CONDITION_SYMBOL[a.condition]} ${fmtPrice(a.price, prec)}`;
      const line = series.createPriceLine({
        price: a.price,
        color: "#f7a600",
        lineWidth: 1,
        lineStyle: 0, // solid
        axisLabelVisible: true,
        title: label,
      });
      existing.set(a.id, line);
      alertLineRegistry.set(a.id, line);
    }

    return () => {
      for (const [id, line] of existing) {
        series.removePriceLine(line);
        alertLineRegistry.delete(id);
      }
      existing.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbolAlertsKey]);

  return null;
}
