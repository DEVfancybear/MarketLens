/**
 * Smart Money Concept domain types.
 * All structures carry the index of the candle that *confirmed* them so the
 * replay engine can guarantee no look-ahead: a structure is only shown once
 * `confirmedAtIndex <= replayCursor`.
 */

export type Direction = 'bullish' | 'bearish';

/** Swing pivot classification. */
export type SwingType = 'HH' | 'HL' | 'LH' | 'LL';

export interface SwingPoint {
  index: number;
  time: number;
  price: number;
  kind: 'high' | 'low';
  label?: SwingType;
}

/** Break of Structure / Change of Character / Market Structure Shift. */
export type StructureEvent = 'BOS' | 'CHOCH' | 'MSS';

export interface MarketStructure {
  id: string;
  event: StructureEvent;
  direction: Direction;
  /** The swing level that was broken. */
  price: number;
  /** Candle index where the break was confirmed. */
  confirmedAtIndex: number;
  confirmedAtTime: number;
  /** Swing the break originated from (for drawing the structure line). */
  fromIndex: number;
  fromTime: number;
}

export interface FairValueGap {
  id: string;
  direction: Direction;
  /** Gap boundaries. */
  top: number;
  bottom: number;
  /** Middle candle of the 3-candle pattern. */
  index: number;
  time: number;
  state: 'active' | 'mitigated';
  /** Index at which the gap was filled/mitigated, if any. */
  mitigatedAtIndex?: number;
}

export interface OrderBlock {
  id: string;
  direction: Direction;
  top: number;
  bottom: number;
  index: number;
  time: number;
  state: 'fresh' | 'mitigated' | 'invalidated';
  /** Whether a displacement leg confirmed the OB. */
  hasDisplacement: boolean;
  /** Index of the BOS that validated this OB. */
  bosIndex: number;
  mitigatedAtIndex?: number;
}

export interface LiquidityZone {
  id: string;
  kind: 'EQH' | 'EQL'; // equal highs / equal lows
  side: 'buyside' | 'sellside';
  price: number;
  /** Indices of the candles forming the equal level cluster. */
  indices: number[];
  time: number;
  swept: boolean;
  sweptAtIndex?: number;
}

export interface Displacement {
  id: string;
  direction: Direction;
  index: number;
  time: number;
  atrMultiple: number;
  bodyExpansion: number;
  relativeVolume: number;
}

export type SessionName = 'asian' | 'london' | 'newyork';

export interface SessionRange {
  name: SessionName;
  /** Day key e.g. "2026-06-24". */
  day: string;
  startTime: number;
  endTime: number;
  high: number;
  low: number;
  mid: number;
}

export interface KillZone {
  name: 'london-open' | 'newyork-open';
  startTime: number;
  endTime: number;
}

/** Snapshot of everything the SMC engine knows up to the replay cursor. */
export interface SmcSnapshot {
  swings: SwingPoint[];
  structures: MarketStructure[];
  fvgs: FairValueGap[];
  orderBlocks: OrderBlock[];
  liquidity: LiquidityZone[];
  displacements: Displacement[];
  sessions: SessionRange[];
  killZones: KillZone[];
  /** Current higher-level trend derived from structure. */
  trend: Direction | 'ranging';
}
