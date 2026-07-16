import type { DrawingDataSample } from "../../../../types/drawing";
import {
  resolveRegressionTrendConfig,
  type RegressionTrendProperties,
  type RegressionTrendSource,
} from "../../../../types/regressionTrend";
import { hasCompleteLowerTimeframeCoverage } from "./volumeProfileDetail";

export interface VolumeProfileBin {
  low: number;
  high: number;
  upVolume: number;
  downVolume: number;
  volume: number;
  /** True for the single deterministic maximum-volume row. */
  isPointOfControl?: boolean;
  /** True when the row is included in the contiguous value area. */
  isValueArea?: boolean;
}

export interface VolumeProfileMetadata {
  /** Finest complete source available for the whole requested profile range. */
  source: VolumeProfileSource | null;
  observationCount: number;
  profileLow: number | null;
  profileHigh: number | null;
  totalVolume: number;
  valueAreaPercent: number;
  targetValueAreaVolume: number;
  valueAreaVolume: number;
  pointOfControlIndex: number | null;
  pointOfControlPrice: number | null;
  valueAreaLowIndex: number | null;
  valueAreaHighIndex: number | null;
  valueAreaLow: number | null;
  valueAreaHigh: number | null;
}

export interface VolumeProfileResult {
  bins: VolumeProfileBin[];
  metadata: VolumeProfileMetadata;
}

export type VolumeProfileSource =
  | "ticks"
  | "lower-timeframe"
  | "chart-timeframe";

export const DEFAULT_VOLUME_PROFILE_VALUE_AREA_PERCENT = 70;
export const MAX_VOLUME_PROFILE_BINS = 1_000;

export function anchoredVwap(samples: readonly DrawingDataSample[]) {
  let cumulativeVolume = 0;
  let cumulativeValue = 0;
  return samples.map((sample) => {
    const volume = Math.max(0, sample.volume);
    cumulativeVolume += volume;
    cumulativeValue += ((sample.high + sample.low + sample.close) / 3) * volume;
    return { time: sample.time, value: cumulativeVolume ? cumulativeValue / cumulativeVolume : sample.close };
  });
}

export function regressionSourceValue(
  sample: DrawingDataSample,
  source: RegressionTrendSource,
): number {
  switch (source) {
    case "open": return sample.open;
    case "high": return sample.high;
    case "low": return sample.low;
    case "hl2": return (sample.high + sample.low) / 2;
    case "hlc3": return (sample.high + sample.low + sample.close) / 3;
    case "ohlc4": return (sample.open + sample.high + sample.low + sample.close) / 4;
    case "hlcc4": return (sample.high + sample.low + sample.close + sample.close) / 4;
    case "close":
    default:
      return sample.close;
  }
}

export function regressionChannel(
  samples: readonly DrawingDataSample[],
  options?: RegressionTrendProperties,
) {
  const config = resolveRegressionTrendConfig(options);
  const sourceValues = samples.map((sample) =>
    regressionSourceValue(sample, config.regressionSource),
  );
  if (samples.length === 0) {
    return {
      slope: 0,
      intercept: 0,
      deviation: 0,
      correlation: 0,
      sourceValues,
      values: [] as number[],
      upperValues: [] as number[],
      lowerValues: [] as number[],
      config,
    };
  }
  const n = samples.length;
  const meanX = (n - 1) / 2;
  const meanY = sourceValues.reduce((sum, value) => sum + value, 0) / n;
  let covariance = 0, varianceX = 0, varianceY = 0;
  for (let index = 0; index < n; index++) {
    const dx = index - meanX, dy = sourceValues[index] - meanY;
    covariance += dx * dy; varianceX += dx * dx; varianceY += dy * dy;
  }
  const slope = varianceX ? covariance / varianceX : 0;
  const intercept = meanY - slope * meanX;
  const values = samples.map((_, index) => intercept + slope * index);
  const deviation = Math.sqrt(
    sourceValues.reduce(
      (sum, value, index) => sum + (value - values[index]) ** 2,
      0,
    ) / n,
  );
  const correlation = varianceX && varianceY ? covariance / Math.sqrt(varianceX * varianceY) : 0;
  return {
    slope,
    intercept,
    deviation,
    correlation,
    sourceValues,
    values,
    upperValues: config.regressionUseUpperDeviation
      ? values.map(
          (value) => value + deviation * config.regressionUpperDeviation,
        )
      : [],
    lowerValues: config.regressionUseLowerDeviation
      ? values.map(
          (value) => value + deviation * config.regressionLowerDeviation,
        )
      : [],
    config,
  };
}

interface VolumeProfileObservation {
  low: number;
  high: number;
  price: number;
  volume: number;
  isUp: boolean;
}

function finitePrice(value: number): boolean {
  return Number.isFinite(value);
}

function barObservation(bar: {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}, strictUp = false): VolumeProfileObservation | null {
  if (
    !finitePrice(bar.open) ||
    !finitePrice(bar.high) ||
    !finitePrice(bar.low) ||
    !finitePrice(bar.close) ||
    !Number.isFinite(bar.volume)
  ) {
    return null;
  }
  return {
    low: Math.min(bar.low, bar.high),
    high: Math.max(bar.low, bar.high),
    price: (bar.high + bar.low + bar.close) / 3,
    volume: Math.max(0, bar.volume),
    // AVP/FRVP document the strict close > open rule for a profile built from
    // one chart bar. Lower-timeframe bars use the shared close >= open rule.
    isUp: strictUp ? bar.close > bar.open : bar.close >= bar.open,
  };
}

interface SelectedVolumeProfileObservations {
  source: VolumeProfileSource;
  observations: VolumeProfileObservation[];
}

interface TickObservationSelection {
  observations: VolumeProfileObservation[];
  hasCompleteMeasuredVolume: boolean;
}

function tickObservations(
  samples: readonly DrawingDataSample[],
): TickObservationSelection | null {
  const observations: VolumeProfileObservation[] = [];
  let hasCompleteMeasuredVolume = true;
  let previousPrice: number | null = null;
  for (const sample of samples) {
    if (!sample.ticks?.length || sample.ticksComplete !== true) return null;
    for (const tick of sample.ticks) {
      if (!finitePrice(tick.price)) continue;
      const volume = tick.volume == null ? 1 : Math.max(0, tick.volume);
      if (!Number.isFinite(volume)) continue;
      if (tick.volume == null) hasCompleteMeasuredVolume = false;
      const reference = previousPrice ?? sample.open;
      observations.push({
        low: tick.price,
        high: tick.price,
        price: tick.price,
        volume,
        isUp: tick.direction
          ? tick.direction === "up"
          : tick.price >= reference,
      });
      previousPrice = tick.price;
    }
  }
  return observations.length
    ? { observations, hasCompleteMeasuredVolume }
    : null;
}

function lowerTimeframeObservations(
  samples: readonly DrawingDataSample[],
): VolumeProfileObservation[] | null {
  if (!hasCompleteLowerTimeframeCoverage(samples)) return null;
  const observations = samples.flatMap((sample) =>
    sample.subBars!.flatMap((bar) => {
      const observation = barObservation(bar);
      return observation ? [observation] : [];
    }),
  );
  return observations.length ? observations : null;
}

/**
 * TradingView calculates one profile at one consistent resolution. A partial
 * detailed snapshot therefore falls back for the complete range instead of
 * silently mixing chart bars with lower-timeframe or tick observations.
 */
function profileObservations(
  samples: readonly DrawingDataSample[],
): SelectedVolumeProfileObservations {
  const ticks = tickObservations(samples);
  const lowerTimeframe = lowerTimeframeObservations(samples);
  // Price-level ticks are the finest source when they carry measured quote
  // volume. A stream of unit-volume price updates, however, must not displace
  // complete OHLCV bars whose volume is materially better evidence.
  if (ticks?.hasCompleteMeasuredVolume) {
    return { source: "ticks", observations: ticks.observations };
  }
  if (lowerTimeframe) {
    return { source: "lower-timeframe", observations: lowerTimeframe };
  }
  if (ticks) return { source: "ticks", observations: ticks.observations };

  const strictSingleBar = samples.length === 1;
  return {
    source: "chart-timeframe",
    observations: samples.flatMap((sample) => {
      const observation = barObservation(sample, strictSingleBar);
      return observation ? [observation] : [];
    }),
  };
}

function emptyVolumeProfileMetadata(
  valueAreaPercent: number,
  source: VolumeProfileSource | null = null,
  observationCount = 0,
  profileLow: number | null = null,
  profileHigh: number | null = null,
): VolumeProfileMetadata {
  return {
    source,
    observationCount,
    profileLow,
    profileHigh,
    totalVolume: 0,
    valueAreaPercent,
    targetValueAreaVolume: 0,
    valueAreaVolume: 0,
    pointOfControlIndex: null,
    pointOfControlPrice: null,
    valueAreaLowIndex: null,
    valueAreaHighIndex: null,
    valueAreaLow: null,
    valueAreaHigh: null,
  };
}

function annotateVolumeProfile(
  bins: VolumeProfileBin[],
  valueAreaPercent: number,
  source: VolumeProfileSource,
  observationCount: number,
  profileLow: number,
  profileHigh: number,
): VolumeProfileMetadata {
  const totalVolume = bins.reduce((sum, bin) => sum + bin.volume, 0);
  const targetValueAreaVolume = totalVolume * valueAreaPercent / 100;
  if (totalVolume <= 0) {
    return emptyVolumeProfileMetadata(
      valueAreaPercent,
      source,
      observationCount,
      profileLow,
      profileHigh,
    );
  }

  // Keeping the first maximum makes equal-volume POC rows deterministic.
  let pointOfControlIndex = 0;
  for (let index = 1; index < bins.length; index++) {
    if (bins[index].volume > bins[pointOfControlIndex].volume) {
      pointOfControlIndex = index;
    }
  }

  let valueAreaLowIndex = pointOfControlIndex;
  let valueAreaHighIndex = pointOfControlIndex;
  let valueAreaVolume = bins[pointOfControlIndex].volume;
  while (valueAreaVolume < targetValueAreaVolume) {
    const below = valueAreaLowIndex - 1;
    const above = valueAreaHighIndex + 1;
    if (below < 0 && above >= bins.length) break;

    let candidate: number;
    if (below < 0) candidate = above;
    else if (above >= bins.length) candidate = below;
    else if (bins[above].volume > bins[below].volume) candidate = above;
    else if (bins[below].volume > bins[above].volume) candidate = below;
    else {
      const belowDistance = pointOfControlIndex - below;
      const aboveDistance = above - pointOfControlIndex;
      candidate = aboveDistance <= belowDistance ? above : below;
    }

    const remaining = targetValueAreaVolume - valueAreaVolume;
    // TradingView stops before a row that would exceed the selected VA target.
    if (bins[candidate].volume > remaining) break;
    valueAreaVolume += bins[candidate].volume;
    valueAreaLowIndex = Math.min(valueAreaLowIndex, candidate);
    valueAreaHighIndex = Math.max(valueAreaHighIndex, candidate);
  }

  bins.forEach((bin, index) => {
    bin.isPointOfControl = index === pointOfControlIndex;
    bin.isValueArea =
      index >= valueAreaLowIndex && index <= valueAreaHighIndex;
  });
  const pointOfControl = bins[pointOfControlIndex];
  return {
    source,
    observationCount,
    profileLow,
    profileHigh,
    totalVolume,
    valueAreaPercent,
    targetValueAreaVolume,
    valueAreaVolume,
    pointOfControlIndex,
    pointOfControlPrice: (pointOfControl.low + pointOfControl.high) / 2,
    valueAreaLowIndex,
    valueAreaHighIndex,
    valueAreaLow: bins[valueAreaLowIndex].low,
    valueAreaHigh: bins[valueAreaHighIndex].high,
  };
}

function addObservationToBins(
  bins: VolumeProfileBin[],
  observation: VolumeProfileObservation,
  profileLow: number,
  step: number,
) {
  if (observation.volume <= 0 || bins.length === 0) return;
  const pointIndex = (price: number) => Math.min(
    bins.length - 1,
    Math.max(0, Math.floor((price - profileLow) / step)),
  );
  const span = observation.high - observation.low;
  const tolerance = Number.EPSILON * Math.max(
    1,
    Math.abs(observation.high),
    Math.abs(observation.low),
  );
  if (span <= tolerance) {
    const bin = bins[pointIndex(observation.price)];
    bin.volume += observation.volume;
    if (observation.isUp) bin.upVolume += observation.volume;
    else bin.downVolume += observation.volume;
    return;
  }

  const first = pointIndex(observation.low);
  const last = Math.min(
    bins.length - 1,
    Math.max(first, Math.ceil((observation.high - profileLow) / step) - 1),
  );
  const overlaps: Array<{ index: number; amount: number }> = [];
  let totalOverlap = 0;
  for (let index = first; index <= last; index++) {
    const bin = bins[index];
    const amount = Math.max(
      0,
      Math.min(observation.high, bin.high) - Math.max(observation.low, bin.low),
    );
    if (amount <= 0) continue;
    overlaps.push({ index, amount });
    totalOverlap += amount;
  }
  if (totalOverlap <= tolerance || overlaps.length === 0) {
    const bin = bins[pointIndex(observation.price)];
    bin.volume += observation.volume;
    if (observation.isUp) bin.upVolume += observation.volume;
    else bin.downVolume += observation.volume;
    return;
  }

  let assigned = 0;
  overlaps.forEach(({ index, amount }, overlapIndex) => {
    const volume = overlapIndex === overlaps.length - 1
      ? observation.volume - assigned
      : observation.volume * amount / totalOverlap;
    assigned += volume;
    bins[index].volume += volume;
    if (observation.isUp) bins[index].upVolume += volume;
    else bins[index].downVolume += volume;
  });
}

/**
 * Calculates the histogram plus POC/value-area metadata. Tick data is the most
 * precise source, followed by lower-timeframe bars. Historical snapshots that
 * have neither fall back to chart bars for the complete range.
 */
export function calculateVolumeProfile(
  samples: readonly DrawingDataSample[],
  requestedBins = 24,
  requestedValueAreaPercent = DEFAULT_VOLUME_PROFILE_VALUE_AREA_PERCENT,
): VolumeProfileResult {
  const valueAreaPercent = Number.isFinite(requestedValueAreaPercent)
    ? Math.max(0, Math.min(100, requestedValueAreaPercent))
    : DEFAULT_VOLUME_PROFILE_VALUE_AREA_PERCENT;
  const selected = profileObservations(samples);
  const { observations, source } = selected;
  if (!observations.length) {
    return {
      bins: [],
      metadata: emptyVolumeProfileMetadata(valueAreaPercent, source),
    };
  }

  const low = Math.min(...observations.map((observation) => observation.low));
  const high = Math.max(...observations.map((observation) => observation.high));
  const requestedCount = Number.isFinite(requestedBins)
    ? Math.max(1, Math.min(MAX_VOLUME_PROFILE_BINS, Math.floor(requestedBins)))
    : 24;
  const flat = high === low;
  const count = flat ? 1 : requestedCount;
  const flatStep = Math.max(Math.abs(low) * 1e-12, Number.EPSILON);
  const profileLow = flat ? low - flatStep / 2 : low;
  const profileHigh = flat ? high + flatStep / 2 : high;
  const step = (profileHigh - profileLow) / count;
  const bins: VolumeProfileBin[] = Array.from({ length: count }, (_, index) => ({
    low: profileLow + index * step,
    high: index === count - 1
      ? profileHigh
      : profileLow + (index + 1) * step,
    upVolume: 0,
    downVolume: 0,
    volume: 0,
  }));
  for (const observation of observations) {
    addObservationToBins(bins, observation, profileLow, step);
  }
  return {
    bins,
    metadata: annotateVolumeProfile(
      bins,
      valueAreaPercent,
      source,
      observations.length,
      low,
      high,
    ),
  };
}

/** Backward-compatible histogram-only API used by existing profile adapters. */
export function volumeProfile(
  samples: readonly DrawingDataSample[],
  requestedBins = 24,
  requestedValueAreaPercent = DEFAULT_VOLUME_PROFILE_VALUE_AREA_PERCENT,
): VolumeProfileBin[] {
  return calculateVolumeProfile(
    samples,
    requestedBins,
    requestedValueAreaPercent,
  ).bins;
}
