"use client";
import { atom, useAtomValue } from "jotai";
import { getDefaultStore } from "jotai";
import { getMt5Symbols, type Mt5SymbolSnapshot } from "@/services/api/resources/mt5Api";
import {
  getAllMarketSymbols,
  getMarketSymbol,
  marketSymbolFromMt5,
  replaceMarketSymbols,
} from "@/services/market-data/symbols";
import type { MarketSymbol } from "@/types";
import { setSymbolAtom, symbolAtom } from "./chartStore";
import { logAtom } from "./uiStore";

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
      const preferredStreamSymbol = pickPreferredStreamSymbol(liveSymbolIds);
      if (!currentCanStream && (preferredStreamSymbol || firstStreamSymbol)) {
        set(setSymbolAtom, preferredStreamSymbol || firstStreamSymbol);
      }
    }

    set(marketSymbolCatalogStatusAtom, "ready");
    if (snapshot.lastError) {
      set(logAtom, "warn", `MT5 symbols bridge status: ${snapshot.lastError}`);
    }
  } catch (error) {
    set(marketSymbolCatalogStatusAtom, "error");
    const message = (error as Error)?.message || "MT5 symbol catalog failed";
    set(logAtom, "error", `MT5 symbol catalog failed: ${message}`);
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
