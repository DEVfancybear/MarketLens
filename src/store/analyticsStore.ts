'use client';
import { create } from 'zustand';

/** Filter/config state for the analytics dashboard. Heavy computation lives in
 *  analyticsEngine and is memoised in the panel against the journal entries. */
interface AnalyticsState {
  startingEquity: number;
  symbolFilter: string | 'all';
  setStartingEquity: (v: number) => void;
  setSymbolFilter: (s: string | 'all') => void;
}

export const useAnalyticsStore = create<AnalyticsState>((set) => ({
  startingEquity: 10_000,
  symbolFilter: 'all',
  setStartingEquity: (startingEquity) => set({ startingEquity }),
  setSymbolFilter: (symbolFilter) => set({ symbolFilter }),
}));
