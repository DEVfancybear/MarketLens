'use client';
import { createContext, useContext } from 'react';
import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import type { Candle } from '@/types';
import type { IndicatorMagnetPoint } from './drawing/interaction/OhlcMagnetSnap';

export interface ChartCtx {
  chart: IChartApi;
  candleSeries: ISeriesApi<'Candlestick'>;
  /** The candles currently plotted (replay-aware visible slice). */
  candles: Candle[];
  /** Monotonic counter that bumps whenever the visible range/size changes,
   *  so overlay canvases know to repaint. */
  version: number;
  /** Values from visible overlay indicators eligible for magnet snapping. */
  indicatorPoints?: readonly IndicatorMagnetPoint[];
}

export const ChartContextObj = createContext<ChartCtx | null>(null);

export function useChartCtx(): ChartCtx | null {
  return useContext(ChartContextObj);
}
