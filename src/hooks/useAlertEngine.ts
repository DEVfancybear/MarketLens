'use client';
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
import { useEffect, useRef } from 'react';
import { useMarketDataStore } from '@/store/marketDataStore';
import { useAlertStore, RECURRING_REARM_MS } from '@/store/alertStore';
import { getMarketSymbol } from '@/services/market-data/symbols';
import { isAlertTriggered } from '@/services/alertEngine';
import { deliverAlert } from '@/services/notifications/notify';
import { subscriptionKey } from '@/types';

type MarketDataState = ReturnType<typeof useMarketDataStore.getState>;

/** Latest price for a symbol: prefer the ticker quote, fall back to candle close. */
function latestPrice(md: MarketDataState, symbol: string): number | undefined {
  const q = md.quotes[symbol];
  if (q && Number.isFinite(q.last)) return q.last;
  const series = md.candles[subscriptionKey(symbol, md.selectedTimeframe)];
  const last = series?.[series.length - 1];
  return last ? last.close : undefined;
}

export function useAlertEngine() {
  // Stable key over the distinct active-alert symbols → effect runs only when
  // the symbol set actually changes (not on every alert edit).
  const alertSymbolsKey = useAlertStore((s) => {
    const set = new Set(s.alerts.map((a) => a.symbol));
    return [...set].sort().join(',');
  });

  const subscribedRef = useRef<Set<string>>(new Set());
  const prevPriceRef = useRef<Map<string, number>>(new Map());

  // ---- 1. keep alert-symbol tickers subscribed (refcounted) ----
  useEffect(() => {
    const desired = new Set(alertSymbolsKey ? alertSymbolsKey.split(',') : []);
    const subbed = subscribedRef.current;

    for (const sym of desired) {
      if (!subbed.has(sym) && getMarketSymbol(sym)) {
        useMarketDataStore.getState().subscribe({ symbol: sym, channels: ['ticker'] });
        subbed.add(sym);
      }
    }
    for (const sym of [...subbed]) {
      if (!desired.has(sym)) {
        useMarketDataStore.getState().unsubscribe(sym);
        subbed.delete(sym);
      }
    }
  }, [alertSymbolsKey]);

  // Drop all alert subscriptions on unmount.
  useEffect(() => {
    const subbed = subscribedRef.current;
    return () => {
      for (const sym of subbed) useMarketDataStore.getState().unsubscribe(sym);
      subbed.clear();
    };
  }, []);

  // ---- 2. evaluate on every price update (no polling) ----
  useEffect(() => {
    const evaluate = () => {
      const md = useMarketDataStore.getState();
      const { alerts, triggerAlert, settings } = useAlertStore.getState();
      if (alerts.length === 0) return;
      const now = Date.now();

      // One price lookup per distinct symbol.
      const priceBySym = new Map<string, number>();
      for (const a of alerts) {
        if (!priceBySym.has(a.symbol)) {
          const p = latestPrice(md, a.symbol);
          if (p !== undefined) priceBySym.set(a.symbol, p);
        }
      }

      for (const alert of alerts) {
        if (!alert.enabled) continue; // disabled alerts are not evaluated
        const curr = priceBySym.get(alert.symbol);
        if (curr === undefined) continue;
        const prev = prevPriceRef.current.get(alert.symbol);
        const rearmBlocked =
          alert.recurring &&
          alert.triggeredAt !== undefined &&
          now - alert.triggeredAt * 1000 < RECURRING_REARM_MS;
        if (!rearmBlocked && isAlertTriggered(alert, prev, curr)) {
          const fired = triggerAlert(alert.id, curr);
          if (fired) deliverAlert(fired, curr, settings);
        }
      }

      // Remember prices for next-tick cross detection.
      for (const [sym, p] of priceBySym) prevPriceRef.current.set(sym, p);
    };

    evaluate(); // catch already-satisfied level alerts immediately
    return useMarketDataStore.subscribe(evaluate);
  }, []);
}
