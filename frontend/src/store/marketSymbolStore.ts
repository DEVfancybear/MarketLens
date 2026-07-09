"use client";
import { atom, useAtomValue } from "jotai";
import { getDefaultStore } from "jotai";
import { getMt5Symbols, type Mt5SymbolSnapshot } from "@/services/api/resources/mt5Api";
import { reportFrontendError } from "@/services/feedback/errorReporter";
import {
  getAllMarketSymbols,
  getMarketSymbol,
  marketSymbolFromMt5,
  replaceMarketSymbols,
} from "@/services/market-data/symbols";
import { resolveCatalogSymbolId } from "@/services/market-data/symbolAliases";
import type { MarketSymbol } from "@/types";
import { setSymbolAtom, symbolAtom } from "./chartStore";
import { logAtom } from "./uiStore";
import { sanitizeWatchlistsForCatalogAtom } from "./watchlistStore";

export type MarketSymbolCatalogStatus = "idle" | "loading" | "ready" | "error";

export const marketSymbolsAtom = atom<MarketSymbol[]>(getAllMarketSymbols());
export const marketSymbolCatalogStatusAtom =
  atom<MarketSymbolCatalogStatus>("idle");
export const mt5SymbolSnapshotAtom = atom<Mt5SymbolSnapshot | null>(null);

export const refreshMt5SymbolCatalogAtom = atom(null, async (get, set) => {
  set(marketSymbolCatalogStatusAtom, "loading");
  try {
    const snapshot = await getMt5Symbols();
    set(mt5SymbolSnapshotAtom, snapshot);

    const streamSymbols = new Set(
      snapshot.streamSymbols.map((symbol) => symbol.trim().toUpperCase()),
    );
    const symbols = snapshot.symbols
      .filter((symbol) => symbol.name.trim())
      .map((symbol) =>
        marketSymbolFromMt5(symbol, streamSymbols.has(symbol.name.toUpperCase())),
      )
      .sort((a, b) => a.id.localeCompare(b.id));

    if (symbols.length > 0) {
      replaceMarketSymbols(symbols);
      set(marketSymbolsAtom, getAllMarketSymbols());
      set(
        sanitizeWatchlistsForCatalogAtom,
        symbols.map((symbol) => symbol.id),
      );
      const liveSymbolIds = snapshot.streamSymbols
        .map((symbol) => symbol.trim().toUpperCase())
        .filter((symbol) => getMarketSymbol(symbol));

      const currentSymbol = get(symbolAtom);
      const currentMeta = currentSymbol
        ? getMarketSymbol(currentSymbol)
        : undefined;
      const firstStreamSymbol =
        snapshot.streamSymbols
          .map((symbol) => symbol.trim().toUpperCase())
          .find((symbol) => getMarketSymbol(symbol)) ??
        symbols.find((symbol) => symbol.streamable)?.id ??
        symbols[0].id;
      const currentCanStream =
        currentMeta && (currentMeta.provider !== "mt5" || currentMeta.streamable);
      const catalogSymbolIds = new Set(symbols.map((symbol) => symbol.id));
      const resolvedCurrentSymbol = currentSymbol
        ? resolveCatalogSymbolId(currentSymbol, catalogSymbolIds)
        : undefined;
      const preferredStreamSymbol = pickPreferredStreamSymbol(liveSymbolIds);
      const normalizedCurrentSymbol = currentSymbol.trim().toUpperCase();
      const nextSymbol =
        resolvedCurrentSymbol &&
        resolvedCurrentSymbol !== normalizedCurrentSymbol
          ? resolvedCurrentSymbol
          : !currentCanStream
          ? preferredStreamSymbol || firstStreamSymbol
          : undefined;
      if (nextSymbol) {
        set(setSymbolAtom, nextSymbol);
      }
    }

    set(marketSymbolCatalogStatusAtom, "ready");
    if (snapshot.lastError) {
      set(logAtom, "warn", `MT5 symbols bridge status: ${snapshot.lastError}`);
    }
  } catch (error) {
    set(marketSymbolCatalogStatusAtom, "error");
    reportFrontendError(error, {
      title: "MT5 symbol catalog failed",
      logPrefix: "MT5 symbol catalog failed",
    });
  }
});

function pickPreferredStreamSymbol(symbols: string[]): string | undefined {
  const available = new Set(symbols);
  for (const symbol of [
    "EURUSD",
    "GBPUSD",
    "XAUUSD",
    "BTCUSD",
    "BTCUSDT",
    "AUDUSD",
    "USDJPY",
  ]) {
    if (available.has(symbol)) return symbol;
  }
  return symbols[0];
}

export function useMarketSymbols(): MarketSymbol[] {
  return useAtomValue(marketSymbolsAtom);
}

export function getMarketSymbolCatalogState(): {
  symbols: MarketSymbol[];
  status: MarketSymbolCatalogStatus;
  snapshot: Mt5SymbolSnapshot | null;
} {
  const store = getDefaultStore();
  return {
    symbols: store.get(marketSymbolsAtom),
    status: store.get(marketSymbolCatalogStatusAtom),
    snapshot: store.get(mt5SymbolSnapshotAtom),
  };
}
