import assert from "node:assert/strict";
import { test } from "node:test";
import type { Drawing } from "../../src/types/drawing";
import { reconcileDrawingLifecycle } from "../../src/components/chart/drawing/lifecycle/drawingLifecycle";

const drawing: Drawing = {
  id: "p",
  tool: "long",
  color: "#fff",
  lineWidth: 1,
  points: [{ time: 10, price: 100 }, { time: 20, price: 110 }, { time: 20, price: 95 }],
};

test("lifecycle reconciliation emits only changed relative hit data", () => {
  const result = reconcileDrawingLifecycle({
    drawings: [drawing],
    samples: [1],
    draggingId: null,
    isEligible: () => true,
    resolveHit: () => ({ status: "tp_hit", time: 15, price: 110 }),
    samplesCoverEntry: () => true,
  });
  assert.equal(result.hasEligible, true);
  assert.deepEqual(result.updates, [{ id: "p", patch: { tradeStatus: "tp_hit", hitTime: 5, hitPrice: 110 } }]);
  assert.equal(reconcileDrawingLifecycle({
    drawings: [{ ...drawing, tradeStatus: "tp_hit", hitTime: 5, hitPrice: 110 }],
    samples: [1],
    draggingId: null,
    isEligible: () => true,
    resolveHit: () => ({ status: "tp_hit", time: 15, price: 110 }),
    samplesCoverEntry: () => true,
  }).updates.length, 0);
});

test("lifecycle reconciliation skips live drags and clears stale resolved hits", () => {
  const stale = { ...drawing, tradeStatus: "sl_hit" as const, hitTime: 2, hitPrice: 95 };
  const base = {
    drawings: [stale], samples: [1], isEligible: () => true,
    resolveHit: () => null, samplesCoverEntry: () => true,
  };
  assert.equal(reconcileDrawingLifecycle({ ...base, draggingId: "p" }).updates.length, 0);
  assert.deepEqual(reconcileDrawingLifecycle({ ...base, draggingId: null }).updates[0], {
    id: "p",
    patch: { tradeStatus: undefined, hitTime: undefined, hitPrice: undefined },
  });
});
