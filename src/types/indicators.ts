/** Technical indicator configuration. */

export type BuiltInIndicatorType = 'SMA' | 'EMA' | 'VWAP' | 'RSI' | 'MACD' | 'ADR';
export type IndicatorType = BuiltInIndicatorType | 'CUSTOM';

export interface CustomIndicatorScript {
  id: string;
  name: string;
  sourceCode: string;
  favorite: boolean;
  createdAt: number;
  updatedAt: number;
}

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
  /** Display name for source-code indicators. */
  name?: string;
  /** Saved script id for source-code indicators. */
  scriptId?: string;
  /** Pine-like source code for source-code indicators. */
  sourceCode?: string;
}

/** A single computed indicator value keyed by time. */
export interface LinePoint {
  time: number;
  value: number;
  color?: string;
}

export type IndicatorSeriesType = 'line' | 'histogram' | 'baselineFill';
export type IndicatorLineWidth = 1 | 2 | 3 | 4;
export type IndicatorLineStyle = 0 | 1 | 2 | 3 | 4;

export interface IndicatorSeries {
  key: string;
  color: string;
  data: LinePoint[];
  type?: IndicatorSeriesType;
  lineWidth?: IndicatorLineWidth;
  lineStyle?: IndicatorLineStyle;
  baseValue?: number;
  lastValueVisible?: boolean;
  lineVisible?: boolean;
}

export interface IndicatorResult {
  id: string;
  /** Multiple series for multi-line indicators (e.g. MACD). */
  series: IndicatorSeries[];
}
