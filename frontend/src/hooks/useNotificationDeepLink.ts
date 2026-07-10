"use client";

import { useCallback, useEffect, useRef } from "react";
import { getDefaultStore, useAtomValue } from "jotai";
import { marketSymbolsAtom } from "@/store/marketSymbolStore";
import { setSymbolAtom } from "@/store/chartStore";
import {
  alertSymbolFromMessage,
  alertSymbolFromSearch,
} from "@/services/notifications/deepLink";

export function useNotificationDeepLink(): void {
  const symbols = useAtomValue(marketSymbolsAtom);
  const pendingSymbolRef = useRef<string | undefined>(undefined);

  const openSymbol = useCallback(
    (symbol: string) => {
      if (!symbols.some((item) => item.id === symbol)) {
        pendingSymbolRef.current = symbol;
        return;
      }
      pendingSymbolRef.current = undefined;
      getDefaultStore().set(setSymbolAtom, symbol);
    },
    [symbols],
  );

  useEffect(() => {
    const symbol = alertSymbolFromSearch(window.location.search);
    if (!symbol) return;
    openSymbol(symbol);
    const url = new URL(window.location.href);
    url.searchParams.delete("symbol");
    url.searchParams.delete("source");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, [openSymbol]);

  useEffect(() => {
    const pending = pendingSymbolRef.current;
    if (pending) openSymbol(pending);
  }, [openSymbol, symbols]);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    void navigator.serviceWorker
      .getRegistration("/")
      .then((registration) => registration?.update())
      .catch(() => undefined);
    const onMessage = (event: MessageEvent) => {
      const symbol = alertSymbolFromMessage(event.data);
      if (symbol) openSymbol(symbol);
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [openSymbol]);
}
