import assert from "node:assert/strict";
import test from "node:test";
import {
  decideAutoFitCandleWindow,
  MIN_COMPLETE_AUTO_FIT_BARS,
} from "../../src/components/chart/chartAutoFitPolicy";

test("fits a first partial realtime candle without marking initial fit complete", () => {
  const decision = decideAutoFitCandleWindow({
    previousLength: 0,
    nextLength: 1,
    alreadyFitted: false,
    lastAutoFitLength: 0,
    structuralDataWindowChange: true,
    replayActive: false,
  });

  assert.deepEqual(decision, { fitContent: true, markComplete: false });
});

test("does not refit every tick while partial candle count is unchanged", () => {
  const decision = decideAutoFitCandleWindow({
    previousLength: 1,
    nextLength: 1,
    alreadyFitted: false,
    lastAutoFitLength: 1,
    structuralDataWindowChange: false,
    replayActive: false,
  });

  assert.deepEqual(decision, { fitContent: false, markComplete: false });
});

test("refits when REST history expands a partial realtime window", () => {
  const decision = decideAutoFitCandleWindow({
    previousLength: 1,
    nextLength: 1500,
    alreadyFitted: false,
    lastAutoFitLength: 1,
    structuralDataWindowChange: true,
    replayActive: false,
  });

  assert.deepEqual(decision, { fitContent: true, markComplete: true });
});

test("marks initial fit complete when the first dataset is history-sized", () => {
  const decision = decideAutoFitCandleWindow({
    previousLength: 0,
    nextLength: MIN_COMPLETE_AUTO_FIT_BARS,
    alreadyFitted: false,
    lastAutoFitLength: 0,
    structuralDataWindowChange: true,
    replayActive: false,
  });

  assert.deepEqual(decision, { fitContent: true, markComplete: true });
});
