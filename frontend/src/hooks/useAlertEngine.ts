"use client";

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
import { isAlertTriggered } from "@/services/alertEngine";
import { deliverAlert } from "@/services/notifications/notify";
import { subscriptionKey } from "@/types";

function latestPrice(
  md: MarketDataStoreInterface,
  symbol: string,
): number | undefined {
  const quote = md.quotes[symbol];
  if (quote && Number.isFinite(quote.last)) return quote.last;

  const series = md.candles[subscriptionKey(symbol, md.selectedTimeframe)];
  const close = series?.[series.length - 1]?.close;
  return Number.isFinite(close) ? close : undefined;
}

/** Evaluates line alerts only from consecutive live MT5 prices. */
export function useAlertEngine() {
  const alertSymbolsKey = useAlertStore((state) => {
    const symbols = new Set(state.alerts.map((alert) => alert.symbol));
    return [...symbols].sort().join(",");
  });
  const selectedTimeframe = useAtomValue(selectedTimeframeAtom);
  const subscribedRef = useRef<Set<string>>(new Set());
  const previousPriceRef = useRef<Map<string, number>>(new Map());
  const seenAlertIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const symbols = alertSymbolsKey ? alertSymbolsKey.split(",") : [];
    const desired = new Set(symbols.map((symbol) => `${symbol}:${selectedTimeframe}`));
    const subscribed = subscribedRef.current;

    for (const symbol of symbols) {
      const key = `${symbol}:${selectedTimeframe}`;
      const meta = getMarketSymbol(symbol);
      if (!subscribed.has(key) && meta && meta.provider !== "mt5") {
        getMarketDataState().subscribe({ symbol, channels: ["ticker"] });
        getMarketDataState().subscribe({
          symbol,
          channels: ["kline"],
          timeframe: selectedTimeframe,
        });
        subscribed.add(key);
      }
    }

    for (const key of [...subscribed]) {
      if (desired.has(key)) continue;
      const [symbol, timeframe] = key.split(":");
      getMarketDataState().unsubscribe(symbol);
      getMarketDataState().unsubscribe(
        symbol,
        timeframe as typeof selectedTimeframe,
      );
      subscribed.delete(key);
    }
  }, [alertSymbolsKey, selectedTimeframe]);

  useEffect(() => {
    const subscribed = subscribedRef.current;
    return () => {
      for (const key of subscribed) {
        const [symbol, timeframe] = key.split(":");
        getMarketDataState().unsubscribe(symbol);
        getMarketDataState().unsubscribe(
          symbol,
          timeframe as typeof selectedTimeframe,
        );
      }
      subscribed.clear();
    };
  }, []);

  useEffect(() => {
    const evaluate = () => {
      const marketData = getMarketDataState();
      const { alerts, triggerAlert, settings } = getAlertState();
      if (alerts.length === 0) return;

      const now = Date.now();
      const prices = new Map<string, number>();
      for (const alert of alerts) {
        if (prices.has(alert.symbol)) continue;
        const price = latestPrice(marketData, alert.symbol);
        if (price !== undefined) prices.set(alert.symbol, price);
      }

      for (const alert of alerts) {
        if (!alert.enabled) continue;
        const current = prices.get(alert.symbol);
        if (current === undefined) continue;

        const firstEvaluation = !seenAlertIdsRef.current.has(alert.id);
        const previous = firstEvaluation
          ? undefined
          : previousPriceRef.current.get(alert.symbol);
        const rearmBlocked =
          alert.recurring &&
          alert.triggeredAt !== undefined &&
          now - alert.triggeredAt * 1000 < RECURRING_REARM_MS;

        if (!rearmBlocked && isAlertTriggered(alert, previous, current)) {
          const fired = triggerAlert(alert.id, current);
          if (fired) deliverAlert(fired, current, settings);
        }
        seenAlertIdsRef.current.add(alert.id);
      }

      const activeIds = new Set(alerts.map((alert) => alert.id));
      for (const id of seenAlertIdsRef.current) {
        if (!activeIds.has(id)) seenAlertIdsRef.current.delete(id);
      }
      for (const [symbol, price] of prices) {
        previousPriceRef.current.set(symbol, price);
      }
    };

    evaluate();
    return getDefaultStore().sub(marketDataTickAtom, evaluate);
  }, []);
}
