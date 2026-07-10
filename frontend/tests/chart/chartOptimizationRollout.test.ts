import assert from "node:assert/strict";
import test from "node:test";
import { resolveChartOptimizationDecision } from "../../src/services/chartOptimizationRollout";

test("query override provides instant optimized and legacy rollback modes", () => {
  assert.equal(resolveChartOptimizationDecision({
    queryMode: "legacy",
    storedMode: "optimized",
    candleCount: 100_000,
    hardwareConcurrency: 16,
  }).effectiveMode, "legacy");
  assert.equal(resolveChartOptimizationDecision({
    queryMode: "optimized",
    candleCount: 10,
    hardwareConcurrency: 1,
    deviceMemoryGb: 1,
  }).effectiveMode, "optimized");
});

test("storage overrides environment while invalid values safely fall back", () => {
  const stored = resolveChartOptimizationDecision({
    storedMode: "legacy",
    environmentMode: "optimized",
    candleCount: 5_000,
  });
  assert.equal(stored.source, "storage");
  assert.equal(stored.effectiveMode, "legacy");

  const fallback = resolveChartOptimizationDecision({
    queryMode: "broken",
    storedMode: "broken",
    candleCount: 900,
    hardwareConcurrency: 8,
    deviceMemoryGb: 8,
  });
  assert.equal(fallback.requestedMode, "auto");
  assert.equal(fallback.effectiveMode, "optimized");
});

test("auto rollout uses history size and device capability", () => {
  assert.equal(resolveChartOptimizationDecision({
    candleCount: 899,
    hardwareConcurrency: 16,
    deviceMemoryGb: 16,
  }).effectiveMode, "legacy");
  assert.equal(resolveChartOptimizationDecision({
    candleCount: 900,
    hardwareConcurrency: 4,
    deviceMemoryGb: 4,
  }).effectiveMode, "optimized");
  const largeLimited = resolveChartOptimizationDecision({
    candleCount: 5_000,
    hardwareConcurrency: 2,
    deviceMemoryGb: 2,
  });
  assert.equal(largeLimited.effectiveMode, "optimized");
  assert.equal(largeLimited.reason, "large-history");
});
