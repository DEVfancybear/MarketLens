"use client";
import { atom, useAtomValue } from "jotai";
import { getDefaultStore } from "jotai";
import { localStore } from "@/services/storage";
import { getMarketSymbol } from "@/services/market-data/symbols";

export type SortKey = "symbol" | "price" | "change" | "changeAbs" | "volume";

// Registry-backed defaults (canonical ids: crypto = Binance pairs, fx/metals/index = TwelveData).
const DEFAULT = [
  "BTCUSDT",
  "ETHUSDT",
  "SOLUSDT",
  "EURUSD",
  "GBPUSD",
  "USDJPY",
  "XAUUSD",
  "SPX500",
];

// ── State atoms ────────────────────────────────────────────────────────────
export const watchlistSymbolsAtom = atom<string[]>(DEFAULT);
export const watchlistSortKeyAtom = atom<SortKey>("symbol");
export const watchlistSortDirAtom = atom<"asc" | "desc">("asc");

// ── Write atoms (actions) ──────────────────────────────────────────────────
export const hydrateWatchlistAtom = atom(null, (_get, set) => {
  const persisted = localStore.get<string[]>("watchlist", DEFAULT);
  const valid = persisted.filter((s) => getMarketSymbol(s));
  set(watchlistSymbolsAtom, valid.length ? valid : DEFAULT);
});

export const addWatchlistSymbolAtom = atom(null, (get, set, ticker: string) => {
  if (get(watchlistSymbolsAtom).includes(ticker)) return;
  const symbols = [...get(watchlistSymbolsAtom), ticker];
  set(watchlistSymbolsAtom, symbols);
  localStore.set("watchlist", symbols);
});

export const removeWatchlistSymbolAtom = atom(
  null,
  (get, set, ticker: string) => {
    const symbols = get(watchlistSymbolsAtom).filter((s) => s !== ticker);
    set(watchlistSymbolsAtom, symbols);
    localStore.set("watchlist", symbols);
  },
);

export const setWatchlistSortAtom = atom(null, (get, set, key: SortKey) => {
  const curKey = get(watchlistSortKeyAtom);
  const curDir = get(watchlistSortDirAtom);
  set(watchlistSortKeyAtom, key);
  set(
    watchlistSortDirAtom,
    curKey === key && curDir === "asc" ? "desc" : "asc",
  );
});

// ── Combined state + actions (for compatibility hook) ──────────────────────
interface WatchlistState {
  symbols: string[];
  sortKey: SortKey;
  sortDir: "asc" | "desc";
}

export interface WatchlistActions {
  add: (ticker: string) => void;
  remove: (ticker: string) => void;
  setSort: (key: SortKey) => void;
  hydrate: () => void;
}

type WatchlistStoreInterface = WatchlistState & WatchlistActions;

const watchlistStateAtom = atom<WatchlistState>((get) => ({
  symbols: get(watchlistSymbolsAtom),
  sortKey: get(watchlistSortKeyAtom),
  sortDir: get(watchlistSortDirAtom),
}));

const watchlistCombinedAtom = atom<WatchlistStoreInterface>((get) => {
  const state = get(watchlistStateAtom);
  const store = getDefaultStore();
  return {
    ...state,
    add: (t) => store.set(addWatchlistSymbolAtom, t),
    remove: (t) => store.set(removeWatchlistSymbolAtom, t),
    setSort: (k) => store.set(setWatchlistSortAtom, k),
    hydrate: () => store.set(hydrateWatchlistAtom),
  };
});

// ── Compatibility hook ─────────────────────────────────────────────────────
export function useWatchlistStore(): WatchlistStoreInterface;
export function useWatchlistStore<T>(
  selector: (state: WatchlistStoreInterface) => T,
): T;
export function useWatchlistStore<T>(
  selector?: (state: WatchlistStoreInterface) => T,
): WatchlistStoreInterface | T {
  const combined = useAtomValue(watchlistCombinedAtom);
  if (!selector) return combined;
  return selector(combined);
}

// Static getState() for non-React code.
export function getWatchlistState(): WatchlistStoreInterface {
  return getDefaultStore().get(watchlistCombinedAtom);
}
