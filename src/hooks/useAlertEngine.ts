"use client";
/**
 * useAlertEngine (Phase 2) — drives the Alert Engine from realtime prices.
 *
 * Mounted once (in `GlobalRuntime`). Two responsibilities:
 *
 *  1. **Subscriptions** — ensures every active-alert symbol has a `ticker`
 *     subscription on the shared `marketDataStore` feed (refcounted, so it never
 *     tears down a watchlist subscription and never opens a new socket). Alerts
 *     therefore work for symbols that aren't currently charted or watch-listed.
 *
 *  2. **Evaluation** — subscribes to `marketDataStore` changes (NO polling) and,
 *     on each price update, evaluates active alerts via the pure engine. On a
 *     match it fires the store's `triggerAlert` (once-only / re-arm gating here)
 *     and dispatches notifications. Previous prices are remembered per symbol so
 *     `crossUp`/`crossDown` edges are detected.
 */
import { useEffect, useRef } from "react";
import { getDefaultStore, useAtomValue } from "jotai";
import {
  getMarketDataState,
  marketDataTickAtom,
  selectedTimeframeAtom,
  type MarketDataStoreInterface,
} from "@/store/marketDataStore";
import {
  useAlertStore,
  getAlertState,
  RECURRING_REARM_MS,
} from "@/store/alertStore";
import { getMarketSymbol } from "@/services/market-data/symbols";
import {
  isAlertTriggered,
  type AlertPriceSnapshot,
} from "@/services/alertEngine";
import { deliverAlert } from "@/services/notifications/notify";
import { subscriptionKey } from "@/types";

/** Latest price window for a symbol: ticker last plus the active candle's high/low. */
function latestPriceSnapshot(
  md: MarketDataStoreInterface,
  symbol: string,
): AlertPriceSnapshot | undefined {
  const q = md.quotes[symbol];
  const series = md.candles[subscriptionKey(symbol, md.selectedTimeframe)];
  const last = series?.[series.length - 1];
  const current =
    q && Number.isFinite(q.last)
      ? q.last
      : last && Number.isFinite(last.close)
        ? last.close
        : undefined;
  if (current === undefined) return undefined;
  return {
    current,
    open: last?.open,
    high: last ? Math.max(last.high, current) : q?.high,
    low: last ? Math.min(last.low, current) : q?.low,
  };
}

export function useAlertEngine() {
  // Stable key over the distinct active-alert symbols → effect runs only when
  // the symbol set actually changes (not on every alert edit).
  const alertSymbolsKey = useAlertStore((s) => {
    const set = new Set(s.alerts.map((a) => a.symbol));
    return [...set].sort().join(",");
  });
  const selectedTimeframe = useAtomValue(selectedTimeframeAtom);

  const subscribedRef = useRef<Set<string>>(new Set());
  const prevPriceRef = useRef<Map<string, number>>(new Map());
  /** Alert IDs that have been evaluated at least once. New alerts skip cross
   *  detection on their first evaluation to prevent a stale `prev` price
   *  (recorded before the alert existed) from causing an immediate trigger. */
  const seenAlertIds = useRef<Set<string>>(new Set());

  // ---- 1. keep alert-symbol tickers subscribed (refcounted) ----
  useEffect(() => {
    const symbols = alertSymbolsKey ? alertSymbolsKey.split(",") : [];
    const desired = new Set(symbols.map((sym) => `${sym}:${selectedTimeframe}`));
    const subbed = subscribedRef.current;

    for (const sym of symbols) {
      const key = `${sym}:${selectedTimeframe}`;
      if (!subbed.has(key) && getMarketSymbol(sym)) {
        getMarketDataState().subscribe({
          symbol: sym,
          channels: ["ticker"],
        });
        getMarketDataState().subscribe({
          symbol: sym,
          channels: ["kline"],
          timeframe: selectedTimeframe,
        });
        subbed.add(key);
      }
    }
    for (const key of [...subbed]) {
      if (!desired.has(key)) {
        const [sym, timeframe] = key.split(":");
        getMarketDataState().unsubscribe(sym);
        getMarketDataState().unsubscribe(
          sym,
          timeframe as typeof selectedTimeframe,
        );
        subbed.delete(key);
      }
    }
  }, [alertSymbolsKey, selectedTimeframe]);

  // Drop all alert subscriptions on unmount.
  useEffect(() => {
    const subbed = subscribedRef.current;
    return () => {
      for (const key of subbed) {
        const [sym, timeframe] = key.split(":");
        getMarketDataState().unsubscribe(sym);
        getMarketDataState().unsubscribe(
          sym,
          timeframe as typeof selectedTimeframe,
        );
      }
      subbed.clear();
    };
  }, []);

  // ---- 2. evaluate on every price update (no polling) ----
  useEffect(() => {
    const evaluate = () => {
      const md = getMarketDataState();
      const { alerts, triggerAlert, settings } = getAlertState();
      if (alerts.length === 0) return;
      const now = Date.now();

      // One price lookup per distinct symbol.
      const priceBySym = new Map<string, AlertPriceSnapshot>();
      for (const a of alerts) {
        if (!priceBySym.has(a.symbol)) {
          const p = latestPriceSnapshot(md, a.symbol);
          if (p !== undefined) priceBySym.set(a.symbol, p);
        }
      }

      for (const alert of alerts) {
        if (!alert.enabled) continue; // disabled alerts are not evaluated
        const curr = priceBySym.get(alert.symbol);
        if (curr === undefined) continue;
        // First-time evaluation: ignore stale prev price (recorded before
        // the alert existed) to prevent spurious crossUp/crossDown triggers.
        const isNew = !seenAlertIds.current.has(alert.id);
        const prev = isNew ? undefined : prevPriceRef.current.get(alert.symbol);
        const rearmBlocked =
          alert.recurring &&
          alert.triggeredAt !== undefined &&
          now - alert.triggeredAt * 1000 < RECURRING_REARM_MS;
        if (!rearmBlocked && isAlertTriggered(alert, prev, curr)) {
          const fired = triggerAlert(alert.id, curr.current);
          if (fired) deliverAlert(fired, curr.current, settings);
        }
        seenAlertIds.current.add(alert.id);
      }

      // Clean up seenAlertIds for alerts that no longer exist.
      if (seenAlertIds.current.size > alerts.length * 2) {
        const activeIds = new Set(alerts.map((a) => a.id));
        for (const id of seenAlertIds.current) {
          if (!activeIds.has(id)) seenAlertIds.current.delete(id);
        }
      }

      // Remember prices for next-tick cross detection.
      for (const [sym, p] of priceBySym) prevPriceRef.current.set(sym, p.current);
    };

    evaluate(); // catch already-satisfied level alerts immediately
    const store = getDefaultStore();
    return store.sub(marketDataTickAtom, evaluate);
  }, []);
}
