/** Technical indicator configuration. */

export type IndicatorType = 'SMA' | 'EMA' | 'VWAP' | 'RSI' | 'MACD' | 'ADR';

export interface IndicatorConfig {
  id: string;
  type: IndicatorType;
  length: number;
  /** Secondary length, used by MACD (signal) and similar. */
  length2?: number;
  /** Tertiary length, used by MACD (slow). */
  length3?: number;
  color: string;
  color2?: string;
  visible: boolean;
  /** Renders in a separate pane below price (RSI, MACD). */
  separatePane?: boolean;
}

/** A single computed indicator value keyed by time. */
export interface LinePoint {
  time: number;
  value: number;
}

export interface IndicatorResult {
  id: string;
  /** Multiple series for multi-line indicators (e.g. MACD). */
  series: { key: string; color: string; data: LinePoint[] }[];
}
