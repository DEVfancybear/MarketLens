"use client";
/**
 * useMarketDataBootstrap (Phase 1, Step 10).
 *
 * The single place that brings the realtime feed online. It creates the
 * MarketDataService (which binds itself to `marketDataStore`) and keeps the
 * watchlist symbols subscribed for `ticker` so live quotes flow into the store.
 *
 * This is intentionally NOT a read hook — it owns subscription lifecycle. It is
 * mounted exactly once (from `GlobalRuntime`). Sockets/polling are managed by the
 * providers, never here directly.
 *
 * Crypto (Binance) streams real 24h change/percent (no key).
 * Forex/metals/indices (OANDA) poll real pricing (needs OANDA_API_KEY +
 *   OANDA_ACCOUNT_ID; falls back to TwelveData if defined, else shows "--").
 */
import { useEffect, useRef } from "react";
import { getMarketDataService } from "@/services/market-data/MarketDataService";
import { getMarketSymbol } from "@/services/market-data/symbols";
import { getMarketDataState } from "@/store/marketDataStore";
import { watchlistSymbolsAtom } from "@/store/watchlistStore";
import { useAtomValue } from "jotai";

export function useMarketDataBootstrap() {
  const symbols = useAtomValue(watchlistSymbolsAtom);
  const subscribed = useRef<Set<string>>(new Set());

  useEffect(() => {
    getMarketDataService(); // create + attach to the store (idempotent)
    const store = getMarketDataState();

    const desired = new Set(symbols.filter((s) => getMarketSymbol(s)));

    // Subscribe newly-added watchlist symbols (ticker only).
    for (const sym of desired) {
      if (!subscribed.current.has(sym)) {
        store.subscribe({ symbol: sym, channels: ["ticker"] });
        subscribed.current.add(sym);
      }
    }
    // Unsubscribe symbols removed from the watchlist.
    for (const sym of [...subscribed.current]) {
      if (!desired.has(sym)) {
        store.unsubscribe(sym);
        subscribed.current.delete(sym);
      }
    }

    store.connect();
  }, [symbols]);

  // Tear down on unmount (full app teardown).
  useEffect(() => {
    const subs = subscribed.current;
    return () => {
      const store = getMarketDataState();
      for (const sym of subs) store.unsubscribe(sym);
      subs.clear();
      store.disconnect();
    };
  }, []);
}
