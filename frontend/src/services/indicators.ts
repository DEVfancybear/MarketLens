/**
 * Indicator calculations. Every function consumes only candles[0..n-1] in
 * order and produces values aligned by time, so they are inherently
 * replay-safe (no look-ahead): pass the visible slice and recompute.
 */
import type {
  BuiltInIndicatorType,
  Candle,
  IndicatorConfig,
  IndicatorLineStyle,
  IndicatorLineWidth,
  IndicatorResult,
  IndicatorSeries,
  IndicatorStyleValues,
  LinePoint,
} from '@/types';
import { dayKey } from '@/utils/time';
import { applyCommonSeriesStyle } from '@/services/indicatorStyle';
import { getCachedPineIndicatorResult } from '@/services/pineRuntimeCache';

function styleFieldKey(
  key: string,
  field: 'visible' | 'color' | 'lineWidth' | 'lineStyle',
) {
  return `${key}.${field}`;
}

function styleVisible(values: IndicatorStyleValues | undefined, key: string) {
  const value = values?.[styleFieldKey(key, 'visible')];
  return value === undefined ? true : value === true || value === 'true';
}

function styleColor(
  values: IndicatorStyleValues | undefined,
  key: string,
  fallback: string,
) {
  const value = values?.[styleFieldKey(key, 'color')];
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function styleLineWidth(
  values: IndicatorStyleValues | undefined,
  key: string,
  fallback: IndicatorLineWidth,
): IndicatorLineWidth {
  const value = Number(values?.[styleFieldKey(key, 'lineWidth')]);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(4, Math.round(value))) as IndicatorLineWidth;
}

function styleLineStyle(
  values: IndicatorStyleValues | undefined,
  key: string,
  fallback: IndicatorLineStyle,
): IndicatorLineStyle {
  const value = Number(values?.[styleFieldKey(key, 'lineStyle')]);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(4, Math.round(value))) as IndicatorLineStyle;
}

function styledBuiltInSeries(
  series: IndicatorSeries,
  values: IndicatorStyleValues | undefined,
  key: 'builtin:primary' | 'builtin:secondary',
): IndicatorSeries | null {
  if (!styleVisible(values, key)) return null;
  return {
    ...series,
    color: styleColor(values, key, series.color),
    lineWidth: styleLineWidth(values, key, series.lineWidth ?? 2),
    lineStyle: styleLineStyle(values, key, series.lineStyle ?? 0),
  };
}

function compactSeries(
  series: (IndicatorSeries | null)[],
  values: IndicatorStyleValues | undefined,
): IndicatorSeries[] {
  return series
    .filter((item): item is IndicatorSeries => item != null)
    .map((item) => applyCommonSeriesStyle(item, values));
}

export function sma(candles: Candle[], length: number): LinePoint[] {
  const out: LinePoint[] = [];
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].close;
    if (i >= length) sum -= candles[i - length].close;
    if (i >= length - 1) out.push({ time: candles[i].time, value: sum / length });
  }
  return out;
}

export function ema(candles: Candle[], length: number): LinePoint[] {
  const out: LinePoint[] = [];
  const k = 2 / (length + 1);
  let prev = 0;
  for (let i = 0; i < candles.length; i++) {
    const price = candles[i].close;
    if (i === 0) prev = price;
    else prev = price * k + prev * (1 - k);
    if (i >= length - 1) out.push({ time: candles[i].time, value: prev });
  }
  return out;
}

/** Session-anchored VWAP, reset each UTC day. */
export function vwap(candles: Candle[]): LinePoint[] {
  const out: LinePoint[] = [];
  let curDay = '';
  let cumPV = 0;
  let cumV = 0;
  for (const c of candles) {
    const d = dayKey(c.time);
    if (d !== curDay) {
      curDay = d;
      cumPV = 0;
      cumV = 0;
    }
    const typical = (c.high + c.low + c.close) / 3;
    cumPV += typical * c.volume;
    cumV += c.volume;
    out.push({ time: c.time, value: cumV ? cumPV / cumV : c.close });
  }
  return out;
}

/** Wilder's RSI. */
export function rsi(candles: Candle[], length: number): LinePoint[] {
  const out: LinePoint[] = [];
  if (candles.length < length + 1) return out;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= length; i++) {
    const ch = candles[i].close - candles[i - 1].close;
    if (ch >= 0) avgGain += ch;
    else avgLoss -= ch;
  }
  avgGain /= length;
  avgLoss /= length;
  const push = (i: number) => {
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    out.push({ time: candles[i].time, value: avgLoss === 0 ? 100 : 100 - 100 / (1 + rs) });
  };
  push(length);
  for (let i = length + 1; i < candles.length; i++) {
    const ch = candles[i].close - candles[i - 1].close;
    const gain = ch > 0 ? ch : 0;
    const loss = ch < 0 ? -ch : 0;
    avgGain = (avgGain * (length - 1) + gain) / length;
    avgLoss = (avgLoss * (length - 1) + loss) / length;
    push(i);
  }
  return out;
}

function emaSeries(values: { time: number; value: number }[], length: number) {
  const out: { time: number; value: number }[] = [];
  const k = 2 / (length + 1);
  let prev = 0;
  for (let i = 0; i < values.length; i++) {
    if (i === 0) prev = values[i].value;
    else prev = values[i].value * k + prev * (1 - k);
    out.push({ time: values[i].time, value: prev });
  }
  return out;
}

/** MACD line, signal line, and histogram. */
export function macd(candles: Candle[], fast: number, slow: number, signal: number) {
  const closes = candles.map((c) => ({ time: c.time, value: c.close }));
  const fastE = emaSeries(closes, fast);
  const slowE = emaSeries(closes, slow);
  const macdLine = fastE.map((f, i) => ({ time: f.time, value: f.value - slowE[i].value }));
  const signalLine = emaSeries(macdLine, signal);
  const hist = macdLine.map((m, i) => ({ time: m.time, value: m.value - signalLine[i].value }));
  return { macdLine, signalLine, hist };
}

/**
 * Average Daily Range levels. Computes the mean high-low range over the last
 * `length` completed days and projects ADR high/low around today's open.
 */
export function adrLevels(candles: Candle[], length: number) {
  // Group into UTC days.
  const days = new Map<string, Candle>();
  for (const c of candles) {
    const d = dayKey(c.time);
    const agg = days.get(d);
    if (!agg) days.set(d, { ...c });
    else {
      agg.high = Math.max(agg.high, c.high);
      agg.low = Math.min(agg.low, c.low);
      agg.close = c.close;
      agg.volume += c.volume;
    }
  }
  const dayArr = [...days.values()];
  if (dayArr.length < 2) return { adr: 0, high: 0, low: 0, openTime: 0 };
  const completed = dayArr.slice(-length - 1, -1);
  const adr =
    completed.reduce((s, d) => s + (d.high - d.low), 0) / Math.max(1, completed.length);
  const today = dayArr[dayArr.length - 1];
  const mid = (today.high + today.low) / 2;
  return { adr, high: mid + adr / 2, low: mid - adr / 2, openTime: today.time };
}

/** Compute a configured indicator into the generic IndicatorResult shape. */
export function computeIndicator(cfg: IndicatorConfig, candles: Candle[]): IndicatorResult {
  switch (cfg.type) {
    case 'SMA':
      return {
        id: cfg.id,
        series: compactSeries([
          styledBuiltInSeries(
            { key: 'sma', color: cfg.color, data: sma(candles, cfg.length) },
            cfg.styleValues,
            'builtin:primary',
          ),
        ], cfg.styleValues),
      };
    case 'EMA':
      return {
        id: cfg.id,
        series: compactSeries([
          styledBuiltInSeries(
            { key: 'ema', color: cfg.color, data: ema(candles, cfg.length) },
            cfg.styleValues,
            'builtin:primary',
          ),
        ], cfg.styleValues),
      };
    case 'VWAP':
      return {
        id: cfg.id,
        series: compactSeries([
          styledBuiltInSeries(
            { key: 'vwap', color: cfg.color, data: vwap(candles) },
            cfg.styleValues,
            'builtin:primary',
          ),
        ], cfg.styleValues),
      };
    case 'RSI':
      return {
        id: cfg.id,
        series: compactSeries([
          styledBuiltInSeries(
            { key: 'rsi', color: cfg.color, data: rsi(candles, cfg.length) },
            cfg.styleValues,
            'builtin:primary',
          ),
        ], cfg.styleValues),
      };
    case 'MACD': {
      const { macdLine, signalLine, hist } = macd(
        candles,
        cfg.length,
        cfg.length3 ?? 26,
        cfg.length2 ?? 9,
      );
      return {
        id: cfg.id,
        series: [
          ...compactSeries([
            styledBuiltInSeries(
              { key: 'macd', color: cfg.color, data: macdLine },
              cfg.styleValues,
              'builtin:primary',
            ),
            styledBuiltInSeries(
              { key: 'signal', color: cfg.color2 ?? '#ff9800', data: signalLine },
              cfg.styleValues,
              'builtin:secondary',
            ),
          ], cfg.styleValues),
          applyCommonSeriesStyle(
            { key: 'hist', color: '#787b86', data: hist, type: 'histogram' },
            cfg.styleValues,
          ),
        ],
      };
    }
    case 'ADR': {
      // Need at least two distinct candle times to draw the flat levels, and a
      // valid (non-zero) ADR. Otherwise emit no data — returning points with
      // duplicate/zero times would violate lightweight-charts' strictly-ascending
      // time requirement ("data must be asc ordered by time").
      const first = candles[0]?.time;
      const last = candles[candles.length - 1]?.time;
      const { high, low } = adrLevels(candles, cfg.length);
      if (first == null || last == null || last <= first || !(high > 0)) {
        return { id: cfg.id, series: [] };
      }
      const flat = (v: number) => [
        { time: first, value: v },
        { time: last, value: v },
      ];
      return {
        id: cfg.id,
        series: compactSeries([
          styledBuiltInSeries(
            { key: 'adr-high', color: cfg.color, data: flat(high) },
            cfg.styleValues,
            'builtin:primary',
          ),
          styledBuiltInSeries(
            { key: 'adr-low', color: cfg.color2 ?? cfg.color, data: flat(low) },
            cfg.styleValues,
            'builtin:secondary',
          ),
        ], cfg.styleValues),
      };
    }
    case 'CUSTOM':
      return getCachedPineIndicatorResult(cfg, candles) ?? { id: cfg.id, series: [] };
    default:
      return { id: cfg.id, series: [] };
  }
}

/** Sensible defaults when a user adds an indicator from the menu. */
export function defaultIndicator(type: BuiltInIndicatorType, id: string): IndicatorConfig {
  switch (type) {
    case 'SMA': return { id, type, length: 50, color: '#2962ff', visible: true };
    case 'EMA': return { id, type, length: 21, color: '#ff6d00', visible: true };
    case 'VWAP': return { id, type, length: 0, color: '#ab47bc', visible: true };
    case 'RSI': return { id, type, length: 14, color: '#26a69a', visible: true, separatePane: true };
    case 'MACD': return { id, type, length: 12, length3: 26, length2: 9, color: '#2962ff', color2: '#ff9800', visible: true, separatePane: true };
    case 'ADR': return { id, type, length: 14, color: '#26a69a', color2: '#ef5350', visible: true };
  }
}
