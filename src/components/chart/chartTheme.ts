import type { Theme } from '@/store/uiStore';
import { TF_SECONDS, type Timeframe } from '@/types';

/**
 * TradingView-style colour palette resolved from the active app theme.
 * Tuned to match TradingView's dark mode (#131722 surface, #26a69a / #ef5350
 * candles, very subtle #1e222d grid, #758696 crosshair).
 */
export function chartColors(theme: Theme) {
  const dark = theme === 'dark';
  return {
    background: dark ? '#131722' : '#ffffff',
    // Axis label text
    text: dark ? '#b2b5be' : '#131722',
    // Grid lines — deliberately faint so they never dominate
    grid: dark ? '#1e222d' : '#eceff3',
    // Price/time scale border
    border: dark ? '#2a2e39' : '#e0e3eb',
    // Crosshair line + label box
    crosshair: dark ? '#758696' : '#9598a1',
    crosshairLabelBg: dark ? '#363a45' : '#2a2e39',
    // Candles
    bull: dark ? '#26a69a' : '#089981',
    bear: dark ? '#ef5350' : '#f23645',
    volumeBull: dark ? 'rgba(38,166,154,0.5)' : 'rgba(8,153,129,0.45)',
    volumeBear: dark ? 'rgba(239,83,80,0.5)' : 'rgba(242,54,69,0.45)',
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Crosshair time-tooltip formatter: HH:mm for intraday, "d MMM 'yy" for daily+,
 * matching TradingView's floating time label.
 */
export function makeTimeFormatter(tf: Timeframe) {
  const intraday = TF_SECONDS[tf] < 86400;
  return (time: number) => {
    const d = new Date(time * 1000);
    if (intraday) {
      const mon = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
      return `${d.getUTCDate()} ${mon}  ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
    }
    return d.toLocaleDateString('en-US', {
      day: 'numeric', month: 'short', year: '2-digit', timeZone: 'UTC',
    });
  };
}
