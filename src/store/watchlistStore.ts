'use client';
import { create } from 'zustand';
import { localStore } from '@/services/storage';
import { getMarketSymbol } from '@/services/market-data/symbols';

export type SortKey = 'symbol' | 'price' | 'change' | 'volume';

interface WatchlistState {
  symbols: string[];
  sortKey: SortKey;
  sortDir: 'asc' | 'desc';
  add: (ticker: string) => void;
  remove: (ticker: string) => void;
  setSort: (key: SortKey) => void;
  /** Load the persisted watchlist from localStorage. Client-only. */
  hydrate: () => void;
}

// Registry-backed defaults (canonical ids: crypto = Binance pairs, fx/metals/index = TwelveData).
const DEFAULT = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD', 'SPX500'];

export const useWatchlistStore = create<WatchlistState>((set, get) => ({
  // Deterministic default for SSR; persisted list loaded via hydrate().
  symbols: DEFAULT,
  sortKey: 'symbol',
  sortDir: 'asc',

  hydrate: () => {
    // Migrate: drop any persisted ids no longer in the registry (e.g. old mock
    // "BTCUSD"); fall back to defaults if nothing valid remains.
    const persisted = localStore.get<string[]>('watchlist', DEFAULT);
    const valid = persisted.filter((s) => getMarketSymbol(s));
    set({ symbols: valid.length ? valid : DEFAULT });
  },

  add: (ticker) => {
    if (get().symbols.includes(ticker)) return;
    const symbols = [...get().symbols, ticker];
    set({ symbols });
    localStore.set('watchlist', symbols);
  },
  remove: (ticker) => {
    const symbols = get().symbols.filter((s) => s !== ticker);
    set({ symbols });
    localStore.set('watchlist', symbols);
  },
  setSort: (key) =>
    set((s) => ({
      sortKey: key,
      sortDir: s.sortKey === key && s.sortDir === 'asc' ? 'desc' : 'asc',
    })),
}));
