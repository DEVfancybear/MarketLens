'use client';
import { create } from 'zustand';
import { localStore } from '@/services/storage';

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

const DEFAULT = ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD', 'BTCUSD', 'ETHUSD', 'NAS100', 'SPX500'];

export const useWatchlistStore = create<WatchlistState>((set, get) => ({
  // Deterministic default for SSR; persisted list loaded via hydrate().
  symbols: DEFAULT,
  sortKey: 'symbol',
  sortDir: 'asc',

  hydrate: () => set({ symbols: localStore.get('watchlist', DEFAULT) }),

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
