import type { ReplayBar } from "@/services/api/resources/replayApi";
import type { Candle } from "@/types";

export type ReplayCandleProjector = (bar: ReplayBar) => Candle;

/** Preserve candle object identity so replay can use Lightweight Charts' O(1) update path. */
export function createReplayCandleProjector(): ReplayCandleProjector {
  const cache = new WeakMap<ReplayBar, Candle>();
  return (bar) => {
    const cached = cache.get(bar);
    if (cached) return cached;
    const candle = {
      time: Math.floor(Date.parse(bar.time) / 1000),
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
    };
    cache.set(bar, candle);
    return candle;
  };
}

/** Keep the live frame visible until the first authoritative Replay batch lands. */
export function replaySeriesOrLive(
  liveCandles: Candle[],
  replayBars: ReplayBar[] | undefined,
  project: ReplayCandleProjector,
): Candle[] {
  if (!replayBars?.length) return liveCandles;
  return replayBars.map(project);
}

/** Keep the animation just shorter than the backend clock period. */
export function replayCandleAnimationDuration(speed: number): number {
  const safeSpeed = Number.isFinite(speed) && speed > 0 ? speed : 1;
  return Math.min(850, Math.max(90, 920 / safeSpeed));
}

export function replayCandleAnimationStart(
  rendered: Candle | null,
  target: Candle,
): Candle {
  if (rendered?.time === target.time) return rendered;
  return {
    ...target,
    high: target.open,
    low: target.open,
    close: target.open,
    volume: 0,
  };
}

/**
 * A pause may freeze an in-flight candle only when it belongs to the exact
 * Replay session and authoritative candle batch that started the animation.
 * A fork/seek can publish a paused replacement while the previous session's
 * animation frame is still pending; freezing that frame would leave the old
 * candlestick series installed on the replacement session's timeline.
 */
export function shouldFreezeReplayCandleAnimation({
  replayActive,
  replayPlaying,
  animationWasRunning,
  activeSessionId,
  renderedSessionId,
  candles,
  renderedCandles,
}: {
  replayActive: boolean;
  replayPlaying: boolean;
  animationWasRunning: boolean;
  activeSessionId: string | null;
  renderedSessionId: string | null;
  candles: readonly Candle[];
  renderedCandles: readonly Candle[];
}): boolean {
  return replayActive &&
    !replayPlaying &&
    animationWasRunning &&
    activeSessionId !== null &&
    activeSessionId === renderedSessionId &&
    candles === renderedCandles;
}

export function interpolateReplayCandle(
  start: Candle,
  target: Candle,
  progress: number,
): Candle {
  const t = Math.min(1, Math.max(0, progress));
  const eased = 1 - (1 - t) ** 3;
  const close = lerp(start.close, target.close, eased);
  return {
    time: target.time,
    open: target.open,
    high: Math.max(target.open, close, lerp(start.high, target.high, eased)),
    low: Math.min(target.open, close, lerp(start.low, target.low, eased)),
    close,
    volume: lerp(start.volume, target.volume, eased),
  };
}

export function replayCandlesEqual(left: Candle, right: Candle): boolean {
  return left.time === right.time &&
    left.open === right.open &&
    left.high === right.high &&
    left.low === right.low &&
    left.close === right.close &&
    left.volume === right.volume;
}

export function replayAppendedCandles(
  previous: readonly Candle[],
  next: readonly Candle[],
): Candle[] | null {
  if (previous.length === 0 || next.length <= previous.length) return null;
  // A replay batch finalizes the previously-forming last candle before it
  // appends the newly revealed candles. That last object therefore changes;
  // only the stable prefix must retain identity for this to be an append.
  for (let index = 0; index < previous.length - 1; index += 1) {
    if (previous[index] !== next[index]) return null;
  }
  if (previous.at(-1)?.time !== next[previous.length - 1]?.time) return null;
  return next.slice(previous.length);
}

function lerp(start: number, end: number, progress: number): number {
  return start + (end - start) * progress;
}
