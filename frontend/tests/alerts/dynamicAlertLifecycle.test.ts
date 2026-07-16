import assert from "node:assert/strict";
import { test } from "node:test";

import {
  evaluateTechnicalAlert,
  findTechnicalAlertTrigger,
  sanitizeTechnicalAlertEvidence,
} from "../../src/services/dynamicAlertTargets";
import type { DynamicLineTarget } from "../../src/types/technicalAlerts";

const segment: DynamicLineTarget = {
  version: 1,
  kind: "dynamic-line",
  a: { time: 1_750_000_000, price: 100 },
  b: { time: 1_750_000_100, price: 110 },
  domain: "segment",
  interpolation: "linear",
};

test("technical evaluator exposes an explicit expired lifecycle reason", () => {
  assert.deepEqual(
    evaluateTechnicalAlert("crossUp", segment, undefined, {
      price: 120,
      timestamp: 1_750_000_101_000,
    }),
    { triggered: false, active: false, inactiveReason: "expired" },
  );
});

test("open evaluator emits normalized previous/current trigger evidence", () => {
  const result = evaluateTechnicalAlert(
    "crossUp",
    segment,
    { price: 103, timestamp: 1_750_000_050_000 },
    { price: 106, timestamp: 1_750_000_060_000 },
  );
  assert.equal(result.triggered, true);
  assert.deepEqual(result.evidence, {
    previous: { price: 103, timestamp: 1_750_000_050 },
    current: { price: 106, timestamp: 1_750_000_060 },
  });
});

test("closed replay attaches the consecutive evidence pair that crossed", () => {
  const match = findTechnicalAlertTrigger(
    "crossUp",
    segment,
    { price: 103, timestamp: 1_750_000_050 },
    [
      { price: 104, timestamp: 1_750_000_055 },
      { price: 106, timestamp: 1_750_000_060 },
    ],
  );
  assert.deepEqual(match?.evidence, {
    previous: { price: 104, timestamp: 1_750_000_055 },
    current: { price: 106, timestamp: 1_750_000_060 },
  });
});

test("trigger evidence sanitizer rejects time travel and normalizes milliseconds", () => {
  assert.deepEqual(
    sanitizeTechnicalAlertEvidence({
      previous: { price: 100, timestamp: 1_750_000_150_000 },
      current: { price: 101, timestamp: 1_750_000_160_000 },
    }),
    {
      previous: { price: 100, timestamp: 1_750_000_150 },
      current: { price: 101, timestamp: 1_750_000_160 },
    },
  );
  assert.equal(
    sanitizeTechnicalAlertEvidence({
      previous: { price: 100, timestamp: 170 },
      current: { price: 101, timestamp: 160 },
    }),
    undefined,
  );
});
