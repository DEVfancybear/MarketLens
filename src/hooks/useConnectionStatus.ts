'use client';
/**
 * useConnectionStatus (Phase 1, Step 9; feeds the Step 14 status badge).
 *
 * Read-only selectors over `marketDataStore.connectionStatus`. Never opens a
 * socket.
 */
import { useMarketDataStore } from '@/store/marketDataStore';
import { CONNECTION_STATUS_META, type ConnectionStatus } from '@/types';

export function useConnectionStatus(): ConnectionStatus {
  return useMarketDataStore((s) => s.connectionStatus);
}

/** Status + UI metadata (label / colour / emoji dot) for the connection badge. */
export function useConnectionMeta() {
  const status = useConnectionStatus();
  return { status, ...CONNECTION_STATUS_META[status] };
}
