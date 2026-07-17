/** Technical indicator configuration. */

export type BuiltInIndicatorType =
  | 'SMA'
  | 'EMA'
  | 'VWAP'
  | 'RSI'
  | 'MACD'
  | 'ADR'
  /** Swing high/low support and resistance overlay. */
  | 'SWING_SR';
export type IndicatorType = BuiltInIndicatorType | 'CUSTOM';

export interface CustomIndicatorScript {
  id: string;
  name: string;
  sourceCode: string;
  favorite: boolean;
  createdAt: number;
  updatedAt: number;
}

export type IndicatorInputValue = string | number | boolean;
export type IndicatorInputValues = Record<string, IndicatorInputValue>;
export type IndicatorStyleValue = string | number | boolean;
export type IndicatorStyleValues = Record<string, IndicatorStyleValue>;

export interface IndicatorConfig {
  id: string;
  type: IndicatorType;
  length: number;
  /** Secondary length, used by MACD (signal), swing-low strength, and similar. */
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
  /** Per-instance values for Pine `input.*()` controls, keyed by the assigned variable name. */
  inputValues?: IndicatorInputValues;
  /** Per-instance visual overrides for plots, hlines, fills, and supported Pine objects. */
  styleValues?: IndicatorStyleValues;
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
  statusLineVisible?: boolean;
  extendToVisibleRange?: boolean;
  lineVisible?: boolean;
  /** Optional output precision from the common indicator Style tab. */
  precision?: number;
}

export interface IndicatorOverlayLabel {
  key: string;
  price: number;
  text: string;
  color: string;
  backgroundColor?: string;
  time?: number;
}

export interface IndicatorDashboardRow {
  label: string;
  value: string;
  valueColor?: string;
}

export interface IndicatorDashboard {
  key: string;
  title: string;
  subtitle?: string;
  rows: IndicatorDashboardRow[];
}

export interface IndicatorResult {
  id: string;
  /** Multiple series for multi-line indicators (e.g. MACD). */
  series: IndicatorSeries[];
  labels?: IndicatorOverlayLabel[];
  dashboard?: IndicatorDashboard;
}
