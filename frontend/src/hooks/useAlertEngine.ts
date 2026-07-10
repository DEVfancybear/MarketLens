"use client";

import { useEffect, useRef } from "react";
import { getDefaultStore } from "jotai";
import { getMarketDataState, marketDataTickAtom } from "@/store/marketDataStore";
import {
  useAlertStore,
  getAlertState,
  RECURRING_REARM_MS,
} from "@/store/alertStore";
import { getMarketSymbol } from "@/services/market-data/symbols";
import {
  alertArmingRevision,
  previousPriceForRevision,
} from "@/services/alertConditions";
import { isAlertTriggered } from "@/services/alertEngine";
import { deliverAlert } from "@/services/notifications/notify";
function latestPrice(symbol: string): number | undefined {
  const marketData = getMarketDataState();
  const quote = marketData.quotes[symbol];
  if (quote && Number.isFinite(quote.last)) return quote.last;
  return undefined;
}

/** Evaluates alert revisions only from consecutive live MT5 prices. */
export function useAlertEngine() {
  const alertSymbolsKey = useAlertStore((state) => {
    const symbols = new Set(state.alerts.map((alert) => alert.symbol));
    return [...symbols].sort().join(",");
  });
  const subscribedSymbolsRef = useRef<Set<string>>(new Set());
  const previousPriceRef = useRef<Map<string, number>>(new Map());
  const revisionByAlertRef = useRef<Map<string, string>>(new Map());

  // Alerts own a ticker subscription even when their symbol is not charted or
  // watch-listed. marketDataStore reference-counts shared subscriptions.
  useEffect(() => {
    const symbols = alertSymbolsKey ? alertSymbolsKey.split(",") : [];
    const desired = new Set(symbols);
    const subscribed = subscribedSymbolsRef.current;

    for (const symbol of symbols) {
      if (subscribed.has(symbol) || !getMarketSymbol(symbol)) continue;
      getMarketDataState().subscribe({ symbol, channels: ["ticker"] });
      subscribed.add(symbol);
    }

    for (const symbol of [...subscribed]) {
      if (desired.has(symbol)) continue;
      getMarketDataState().unsubscribe(symbol);
      subscribed.delete(symbol);
    }
  }, [alertSymbolsKey]);

  useEffect(() => {
    const subscribed = subscribedSymbolsRef.current;
    return () => {
      for (const symbol of subscribed) {
        getMarketDataState().unsubscribe(symbol);
      }
      subscribed.clear();
    };
  }, []);

  useEffect(() => {
    const evaluate = () => {
      const { alerts, triggerAlert, settings } = getAlertState();
      if (alerts.length === 0) return;

      const now = Date.now();
      const prices = new Map<string, number>();
      for (const alert of alerts) {
        if (prices.has(alert.symbol)) continue;
        const price = latestPrice(alert.symbol);
        if (price !== undefined) prices.set(alert.symbol, price);
      }

      for (const alert of alerts) {
        if (!alert.enabled) continue;
        const current = prices.get(alert.symbol);
        if (current === undefined) continue;

        const revision = alertArmingRevision(
          alert.condition,
          alert.symbol,
          alert.price,
          alert.recurring,
          alert.updatedAt,
        );
        const previous = previousPriceForRevision(
          revision,
          revisionByAlertRef.current.get(alert.id),
          previousPriceRef.current.get(alert.symbol),
        );
        const rearmBlocked =
          alert.recurring &&
          alert.triggeredAt !== undefined &&
          now - alert.triggeredAt * 1000 < RECURRING_REARM_MS;

        if (!rearmBlocked && isAlertTriggered(alert, previous, current)) {
          const fired = triggerAlert(alert.id, current);
          if (fired) deliverAlert(fired, current, settings);
        }
        revisionByAlertRef.current.set(alert.id, revision);
      }

      const activeIds = new Set(alerts.map((alert) => alert.id));
      for (const id of revisionByAlertRef.current.keys()) {
        if (!activeIds.has(id)) revisionByAlertRef.current.delete(id);
      }
      for (const [symbol, price] of prices) {
        previousPriceRef.current.set(symbol, price);
      }
    };

    evaluate();
    return getDefaultStore().sub(marketDataTickAtom, evaluate);
  }, []);
}
