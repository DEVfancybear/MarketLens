import type { Symbol as Sym } from '@/types';

/**
 * Presentational mapping from a symbol's asset class to a TradingView-style
 * exchange name and contract tag. Display-only — no effect on trading logic.
 */
export function exchangeOf(type: Sym['type']): string {
  switch (type) {
    case 'crypto': return 'BINANCE';
    case 'forex': return 'FX';
    case 'commodity': return 'OANDA';
    case 'index': return 'INDEX';
    case 'stock': return 'NASDAQ';
    default: return 'MARKET';
  }
}

export function contractTagOf(type: Sym['type']): string {
  switch (type) {
    case 'crypto': return 'Perpetual';
    case 'forex': return 'Spot';
    case 'commodity': return 'CFD';
    case 'index': return 'Index';
    case 'stock': return 'Equity';
    default: return '';
  }
}
