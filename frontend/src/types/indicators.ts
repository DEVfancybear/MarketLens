/** Technical indicator configuration. */

/** Backend-owned catalog key or a saved/public script key. */
export type IndicatorType = string;

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

export interface IndicatorChartScope {
  /** Stable saved-layout/drawing context identity. */
  layoutId: string;
  /** Stable multi-chart pane identity inside the layout. */
  chartId: string;
}

export interface IndicatorConfig {
  id: string;
  type: IndicatorType;
  /** Legacy persisted fields are read by the backend migration adapter only. */
  length?: number;
  length2?: number;
  length3?: number;
  color?: string;
  color2?: string;
  visible: boolean;
  /** Backend definition places the output in a separate chart pane. */
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
  /** Backend-derived execution requirement; never inferred from source in the browser. */
  requiresHistoryContext?: boolean;
  /** Pane ownership. Missing legacy values are rebound to the active chart on load. */
  chartScope?: IndicatorChartScope;
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
  fillBelowBase?: boolean;
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
  /** Pine label.style_* identifier, when supplied by the runtime. */
  style?: string;
  /** Dynamic Pine tooltip text. Newlines are intentionally preserved. */
  tooltip?: string;
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
  position?: string;
  textSize?: string;
  rows: IndicatorDashboardRow[];
}

export interface IndicatorResult {
  id: string;
  /** Multiple output series produced by the common runtime. */
  series: IndicatorSeries[];
  labels?: IndicatorOverlayLabel[];
  dashboard?: IndicatorDashboard;
}
