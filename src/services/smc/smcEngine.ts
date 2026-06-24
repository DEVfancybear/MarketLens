/**
 * SMC orchestrator — assembles the full snapshot from a visible candle slice.
 *
 * Everything downstream consumes only `candles` (the replay-aware visible
 * window), so the entire snapshot is guaranteed free of look-ahead bias.
 *
 * For very long windows we cap analysis to the most recent `maxBars` candles:
 * SMC overlays are only meaningful near current price, and this keeps each
 * recompute O(maxBars) regardless of total history size.
 */
import type { Candle, SmcSnapshot } from '@/types';
import { computeStructure, type StructureOptions } from './structureEngine';
import { detectFvgs, type FvgOptions } from './fvgEngine';
import { detectOrderBlocks, type OrderBlockOptions } from './orderBlockEngine';
import { detectLiquidity, type LiquidityOptions } from './liquidityEngine';
import { detectDisplacements, type DisplacementOptions } from './displacementEngine';
import { computeSessions, computeKillZones } from './sessionEngine';

export interface SmcOptions {
  maxBars: number;
  structure?: StructureOptions;
  fvg?: FvgOptions;
  orderBlock?: OrderBlockOptions;
  liquidity?: LiquidityOptions;
  displacement?: DisplacementOptions;
}

export const DEFAULT_SMC_OPTIONS: SmcOptions = { maxBars: 1500 };

export function computeSmc(
  allCandles: Candle[],
  opts: SmcOptions = DEFAULT_SMC_OPTIONS,
): SmcSnapshot {
  // Window the analysis but keep absolute indices irrelevant (engines are
  // self-contained on the slice; consumers match by time).
  const candles =
    allCandles.length > opts.maxBars ? allCandles.slice(-opts.maxBars) : allCandles;

  if (candles.length < 10) {
    return {
      swings: [], structures: [], fvgs: [], orderBlocks: [],
      liquidity: [], displacements: [], sessions: [], killZones: [], trend: 'ranging',
    };
  }

  const { swings, structures, trend } = computeStructure(candles, opts.structure);
  const fvgs = detectFvgs(candles, opts.fvg);
  const orderBlocks = detectOrderBlocks(candles, structures, opts.orderBlock);
  const liquidity = detectLiquidity(candles, swings, opts.liquidity);
  const displacements = detectDisplacements(candles, opts.displacement);
  const sessions = computeSessions(candles);
  const killZones = computeKillZones(candles);

  return { swings, structures, fvgs, orderBlocks, liquidity, displacements, sessions, killZones, trend };
}
