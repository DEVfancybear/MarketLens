'use client';
import { create } from 'zustand';
import { uid } from '@/utils/id';

export interface PriceAlert {
  id: string;
  symbol: string;
  price: number;
  createdAt: number;
}

interface AlertState {
  alerts: PriceAlert[];
  add: (symbol: string, price: number) => PriceAlert;
  remove: (id: string) => void;
  clear: () => void;
}

/**
 * In-memory price alerts created from the chart context menu. Rendered on the
 * chart as price lines by <AlertLines/>. Created only at runtime (client), so
 * there is no SSR/hydration surface.
 */
export const useAlertStore = create<AlertState>((set, get) => ({
  alerts: [],
  add: (symbol, price) => {
    const alert: PriceAlert = { id: uid('alert'), symbol, price, createdAt: Date.now() / 1000 };
    set({ alerts: [...get().alerts, alert] });
    return alert;
  },
  remove: (id) => set({ alerts: get().alerts.filter((a) => a.id !== id) }),
  clear: () => set({ alerts: [] }),
}));
