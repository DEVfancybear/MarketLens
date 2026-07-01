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
  type Alert,
} from "@/store/alertStore";
import { getMarketSymbol } from "@/services/market-data/symbols";
import {
  isAlertTriggered,
  type AlertPriceSnapshot,
} from "@/services/alertEngine";
import { deliverAlert } from "@/services/notifications/notify";
import { subscriptionKey, type MarketCandle } from "@/types";

interface ObservedAlertRange {
  signature: string;
  symbol: string;
  candleTime?: number;
  candleHigh?: number;
  candleLow?: number;
  high: number;
  low: number;
}

function alertSignature(alert: Alert): string {
  return [
    alert.condition,
    alert.symbol,
    alert.price,
    alert.recurring,
    alert.updatedAt,
  ].join(":");
}

/** Latest realtime price for a symbol plus raw active-candle bounds. The raw
 * bounds are not used directly; each alert tracks only the portion observed
 * after it was armed. Also returns the loaded candle series so a freshly
 * (re)mounted engine can recover the full high/low range spanned while the
 * browser was closed, not just the currently-forming candle. */
function latestPriceSnapshot(
  md: MarketDataStoreInterface,
  symbol: string,
): { snapshot: AlertPriceSnapshot; series?: MarketCandle[] } | undefined {
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
    snapshot: {
      current,
      open: current,
      high: current,
      low: current,
      candleTime: last?.time,
      candleHigh: last?.high,
      candleLow: last?.low,
    },
    series,
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
  const observedRangeRef = useRef<Map<string, ObservedAlertRange>>(new Map());
  const mountedAtRef = useRef<number>(Date.now());
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
      const seriesBySym = new Map<string, MarketCandle[] | undefined>();
      for (const a of alerts) {
        if (!priceBySym.has(a.symbol)) {
          const p = latestPriceSnapshot(md, a.symbol);
          if (p !== undefined) {
            priceBySym.set(a.symbol, p.snapshot);
            seriesBySym.set(a.symbol, p.series);
          }
        }
      }

      for (const alert of alerts) {
        if (!alert.enabled) continue; // disabled alerts are not evaluated
        const curr = priceBySym.get(alert.symbol);
        if (curr === undefined) continue;
        const series = seriesBySym.get(alert.symbol);
        // An alert that predates this browser session needs its candle history
        // loaded before its first observation is locked in — otherwise the
        // recovered range would collapse to a single point (the live price)
        // and a touch that happened while the browser was closed gets missed
        // permanently (the range only widens forward from here on).
        const isFirstObservation = !observedRangeRef.current.has(alert.id);
        const existedBeforeThisBrowserSession =
          alert.createdAt * 1000 < mountedAtRef.current;
        if (isFirstObservation && existedBeforeThisBrowserSession && !series?.length) {
          continue;
        }
        // First-time evaluation: ignore stale prev price (recorded before
        // the alert existed) to prevent spurious crossUp/crossDown triggers.
        const isNew = !seenAlertIds.current.has(alert.id);
        const prev = isNew ? undefined : prevPriceRef.current.get(alert.symbol);
        const observed = observedSinceArm(
          observedRangeRef.current,
          alert,
          curr,
          mountedAtRef.current,
          series,
        );
        const rearmBlocked =
          alert.recurring &&
          alert.triggeredAt !== undefined &&
          now - alert.triggeredAt * 1000 < RECURRING_REARM_MS;
        if (!rearmBlocked && isAlertTriggered(alert, prev, observed)) {
          const fired = triggerAlert(alert.id, observed.current);
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
        for (const id of observedRangeRef.current.keys()) {
          if (!activeIds.has(id)) observedRangeRef.current.delete(id);
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

function observedSinceArm(
  ranges: Map<string, ObservedAlertRange>,
  alert: Alert,
  snapshot: AlertPriceSnapshot,
  mountedAt: number,
  series?: MarketCandle[],
): AlertPriceSnapshot {
  const signature = alertSignature(alert);
  const existing = ranges.get(alert.id);
  if (!existing || existing.signature !== signature) {
    const existedBeforeThisBrowserSession = alert.createdAt * 1000 < mountedAt;
    let high = snapshot.current;
    let low = snapshot.current;

    if (existedBeforeThisBrowserSession && series?.length) {
      // The alert armed in a previous browser session (page reload/reopen).
      // Scan every loaded candle since the alert was last armed instead of
      // only the currently-forming candle, so a touch that happened while
      // the browser was closed (in an already-closed candle) is still caught.
      const sinceMs = alert.updatedAt * 1000;
      for (const c of series) {
        if (c.time * 1000 < sinceMs) continue;
        high = Math.max(high, c.high);
        low = Math.min(low, c.low);
      }
    } else {
      const candleOpenMs =
        snapshot.candleTime !== undefined ? snapshot.candleTime * 1000 : undefined;
      const includeFullCandle =
        candleOpenMs !== undefined &&
        alert.updatedAt * 1000 <= candleOpenMs &&
        snapshot.candleHigh !== undefined &&
        snapshot.candleLow !== undefined;
      if (includeFullCandle) {
        high = Math.max(snapshot.candleHigh ?? snapshot.current, snapshot.current);
        low = Math.min(snapshot.candleLow ?? snapshot.current, snapshot.current);
      }
    }

    ranges.set(alert.id, {
      signature,
      symbol: alert.symbol,
      candleTime: snapshot.candleTime,
      candleHigh: snapshot.candleHigh,
      candleLow: snapshot.candleLow,
      high,
      low,
    });
    return {
      ...snapshot,
      open: snapshot.current,
      high,
      low,
    };
  }

  let high = Math.max(existing.high, snapshot.current);
  let low = Math.min(existing.low, snapshot.current);

  if (snapshot.candleTime !== undefined) {
    if (existing.candleTime !== snapshot.candleTime) {
      high = Math.max(high, snapshot.candleHigh ?? snapshot.current);
      low = Math.min(low, snapshot.candleLow ?? snapshot.current);
    } else {
      if (
        snapshot.candleHigh !== undefined &&
        existing.candleHigh !== undefined &&
        snapshot.candleHigh > existing.candleHigh
      ) {
        high = Math.max(high, snapshot.candleHigh);
      }
      if (
        snapshot.candleLow !== undefined &&
        existing.candleLow !== undefined &&
        snapshot.candleLow < existing.candleLow
      ) {
        low = Math.min(low, snapshot.candleLow);
      }
    }
  }

  ranges.set(alert.id, {
    signature,
    symbol: alert.symbol,
    candleTime: snapshot.candleTime,
    candleHigh: snapshot.candleHigh,
    candleLow: snapshot.candleLow,
    high,
    low,
  });

  return {
    ...snapshot,
    open: snapshot.current,
    high,
    low,
  };
}
