export const MIN_COMPLETE_AUTO_FIT_BARS = 20;

export interface AutoFitDecisionInput {
  previousLength: number;
  nextLength: number;
  alreadyFitted: boolean;
  lastAutoFitLength: number;
  structuralDataWindowChange: boolean;
  replayActive: boolean;
}

export interface AutoFitDecision {
  fitContent: boolean;
  markComplete: boolean;
}

/**
 * Decide when the main chart may call `fitContent()`.
 *
 * Realtime providers can deliver a single forming candle before REST history
 * finishes loading. If that one-candle series permanently completes the initial
 * fit, the later 1500-bar history window remains zoomed into one giant candle.
 * This policy allows a temporary fit for partial data, but only marks the fit
 * complete once a real history-sized window is available.
 */
export function decideAutoFitCandleWindow({
  previousLength,
  nextLength,
  alreadyFitted,
  lastAutoFitLength,
  structuralDataWindowChange,
  replayActive,
}: AutoFitDecisionInput): AutoFitDecision {
  if (nextLength <= 0) return { fitContent: false, markComplete: false };

  const enoughHistory = nextLength >= MIN_COMPLETE_AUTO_FIT_BARS;
  const partialWindowExpandedToHistory =
    !replayActive &&
    structuralDataWindowChange &&
    previousLength > 0 &&
    previousLength < MIN_COMPLETE_AUTO_FIT_BARS &&
    enoughHistory;

  if (partialWindowExpandedToHistory) {
    return { fitContent: true, markComplete: true };
  }

  if (!alreadyFitted && nextLength !== lastAutoFitLength) {
    return { fitContent: true, markComplete: enoughHistory };
  }

  return { fitContent: false, markComplete: alreadyFitted };
}
