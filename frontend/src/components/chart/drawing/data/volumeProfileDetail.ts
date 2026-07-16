import type { DrawingDataSample, DrawingDataSubBar } from "../../../../types/drawing";
import type { Candle } from "../../../../types/market";

const TIME_TOLERANCE_SECONDS = 1e-6;

/**
 * Returns the finest positive spacing represented by a bar series. Providers
 * can leave session gaps, so the minimum spacing is the useful timeframe while
 * larger deltas are coverage gaps that must be checked separately.
 */
export function inferBarInterval(
  bars: readonly Pick<DrawingDataSubBar, "time">[],
): number | null {
  const orderedTimes = [...new Set(
    bars
      .map((bar) => bar.time)
      .filter((time) => Number.isFinite(time)),
  )].sort((left, right) => left - right);
  let interval = Number.POSITIVE_INFINITY;
  for (let index = 1; index < orderedTimes.length; index++) {
    const delta = orderedTimes[index] - orderedTimes[index - 1];
    if (delta > TIME_TOLERANCE_SECONDS) interval = Math.min(interval, delta);
  }
  return Number.isFinite(interval) ? interval : null;
}

/**
 * A parent candle is complete only when every lower-timeframe slot is present.
 * Merely having one sub-bar is not enough: using it would silently discard the
 * rest of the parent candle's volume.
 */
export function lowerTimeframeCoversParent(
  parentStart: number,
  parentInterval: number,
  subBars: readonly Pick<DrawingDataSubBar, "time">[],
  subBarInterval: number,
): boolean {
  if (
    !Number.isFinite(parentStart) ||
    !Number.isFinite(parentInterval) ||
    !Number.isFinite(subBarInterval) ||
    parentInterval <= 0 ||
    subBarInterval <= 0 ||
    subBarInterval >= parentInterval
  ) return false;

  const times = [...new Set(
    subBars
      .map((bar) => bar.time)
      .filter((time) =>
        Number.isFinite(time) &&
        time >= parentStart - TIME_TOLERANCE_SECONDS &&
        time < parentStart + parentInterval - TIME_TOLERANCE_SECONDS
      ),
  )].sort((left, right) => left - right);
  const expectedSlots = Math.ceil(
    parentInterval / subBarInterval - TIME_TOLERANCE_SECONDS,
  );
  if (times.length !== expectedSlots) return false;
  return times.every((time, index) =>
    Math.abs(time - (parentStart + index * subBarInterval)) <=
      TIME_TOLERANCE_SECONDS,
  );
}

/**
 * Session markets intentionally have no lower-timeframe bars outside trading
 * hours. In that case wall-clock slot coverage is impossible, but conserving
 * the parent candle's volume proves that the economically relevant samples are
 * present. Zero-volume parents still require slot coverage because equality at
 * zero provides no completeness evidence.
 */
export function lowerTimeframeConservesParentVolume(
  parentVolume: number,
  subBars: readonly Pick<DrawingDataSubBar, "volume">[],
): boolean {
  if (
    !Number.isFinite(parentVolume) ||
    parentVolume <= 0 ||
    subBars.length === 0 ||
    subBars.some((bar) => !Number.isFinite(bar.volume) || bar.volume < 0)
  ) return false;
  const detailVolume = subBars.reduce((sum, bar) => sum + bar.volume, 0);
  const tolerance = Math.max(1e-8, Math.abs(parentVolume) * 1e-8);
  return Math.abs(detailVolume - parentVolume) <= tolerance;
}

/** Shared capture/runtime guard, including persisted snapshots from older code. */
export function hasCompleteLowerTimeframeCoverage(
  samples: readonly Pick<
    DrawingDataSample,
    "time" | "volume" | "subBars" | "subBarsComplete"
  >[],
  knownParentInterval?: number,
): boolean {
  if (
    samples.length === 0 ||
    samples.some(
      (sample) => !sample.subBars?.length || sample.subBarsComplete === false,
    )
  ) return false;

  const parentInterval = knownParentInterval ?? inferBarInterval(samples);
  const volumeIsConserved = samples.every((sample) =>
    lowerTimeframeConservesParentVolume(
      sample.volume,
      sample.subBars ?? [],
    ),
  );

  // A one-parent persisted snapshot has no way to recover its wall-clock
  // timeframe. Volume conservation still provides independent evidence.
  if (parentInterval == null) return volumeIsConserved;
  const subBarInterval = inferBarInterval(
    samples.flatMap((sample) => sample.subBars ?? []),
  );
  if (subBarInterval == null) return volumeIsConserved;

  return samples.every((sample) => {
    const subBars = sample.subBars ?? [];
    return lowerTimeframeCoversParent(
      sample.time,
      parentInterval,
      subBars,
      subBarInterval,
    ) || lowerTimeframeConservesParentVolume(sample.volume, subBars);
  });
}

export interface LowerTimeframeCandidate<TId = string> {
  id: TId;
  bars: readonly Candle[];
}

/**
 * Selects the first candidate that is both persistence-bounded and complete
 * for every parent candle. Candidate ordering is the caller's policy (normally
 * finest to coarsest); incomplete fine data therefore falls through instead
 * of silently winning over a complete coarser series.
 */
export function selectCompleteLowerTimeframeCandidate<TId>(
  parents: readonly Candle[],
  parentInterval: number,
  candidates: readonly LowerTimeframeCandidate<TId>[],
  maxBars = 5_000,
): { id: TId; bars: Candle[] } | undefined {
  if (parents.length === 0 || !Number.isFinite(parentInterval) || parentInterval <= 0) {
    return undefined;
  }
  const rangeStart = parents[0].time;
  const rangeEnd = parents.at(-1)!.time + parentInterval;
  for (const candidate of candidates) {
    const bars = candidate.bars
      .filter((bar) => bar.time >= rangeStart && bar.time < rangeEnd)
      .sort((left, right) => left.time - right.time);
    if (bars.length === 0 || bars.length > maxBars) continue;
    const samples: DrawingDataSample[] = parents.map((parent) => ({
      ...parent,
      subBars: bars.filter(
        (bar) => bar.time >= parent.time && bar.time < parent.time + parentInterval,
      ),
      subBarsComplete: true,
    }));
    if (hasCompleteLowerTimeframeCoverage(samples, parentInterval)) {
      return { id: candidate.id, bars: bars.map((bar) => ({ ...bar })) };
    }
  }
  return undefined;
}
