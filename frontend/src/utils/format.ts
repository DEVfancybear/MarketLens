import { TF_SECONDS, type Timeframe } from '@/types';

/** Format a price with a fixed precision and thousands separators. */
export function fmtPrice(value: number, precision = 2): string {
  if (!Number.isFinite(value)) return '—';
  return value.toLocaleString('en-US', {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  });
}

/** Compact volume (1.2K / 3.4M / 5.6B). */
export function fmtVolume(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= 1e9) return (value / 1e9).toFixed(2) + 'B';
  if (abs >= 1e6) return (value / 1e6).toFixed(2) + 'M';
  if (abs >= 1e3) return (value / 1e3).toFixed(2) + 'K';
  return value.toFixed(0);
}

/** Signed percentage with 2 decimals. */
export function fmtPct(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

/** Signed currency, e.g. -$1,234.56. */
export function fmtMoney(value: number, precision = 2): string {
  if (!Number.isFinite(value)) return '—';
  const sign = value < 0 ? '-' : '';
  return `${sign}$${Math.abs(value).toLocaleString('en-US', {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  })}`;
}

/** R-multiple, e.g. 2.4R. */
export function fmtR(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return `${value >= 0 ? '' : ''}${value.toFixed(2)}R`;
}

const TF_LABEL: Record<Timeframe, string> = {
  '1m': '1 min',
  '3m': '3 min',
  '5m': '5 min',
  '15m': '15 min',
  '30m': '30 min',
  '1H': '1 hour',
  '2H': '2 hour',
  '4H': '4 hour',
  '1D': '1 day',
  '1W': '1 week',
  '1M': '1 month',
};

export function tfLabel(tf: Timeframe): string {
  return TF_LABEL[tf];
}

export function tfSeconds(tf: Timeframe): number {
  return TF_SECONDS[tf];
}
