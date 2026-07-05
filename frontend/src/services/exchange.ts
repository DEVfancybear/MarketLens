import type { AssetClass } from '@/types';

/**
 * Presentational mapping from a symbol's asset class to a TradingView-style
 * contract tag. Display-only — no effect on trading logic. (Exchange name now
 * comes directly from the registry's `MarketSymbol.exchange`.)
 */
export function contractTagOf(assetClass: AssetClass): string {
  switch (assetClass) {
    case 'crypto': return 'Perpetual';
    case 'forex': return 'Spot';
    case 'metal': return 'Spot';
    case 'commodity': return 'CFD';
    case 'index': return 'Index';
    case 'stock': return 'Equity';
    default: return '';
  }
}
