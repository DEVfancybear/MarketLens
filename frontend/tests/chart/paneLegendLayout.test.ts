import test from "node:test";
import assert from "node:assert/strict";
import {
  paneLegendTopsEqual,
  resolvePaneLegendTops,
} from "../../src/components/chart/paneLegendLayout";

test("pane legends use chart-local offsets for every indicator pane", () => {
  assert.deepEqual(
    resolvePaneLegendTops(
      { top: 80, height: 600 },
      [
        { id: "vsa", rect: { top: 432, height: 124 } },
        { id: "rsi", rect: { top: 556, height: 124 } },
      ],
    ),
    { vsa: 356, rsi: 480 },
  );
});

test("pane legend geometry follows native pane resizing", () => {
  const before = resolvePaneLegendTops(
    { top: 40, height: 500 },
    [{ id: "vsa", rect: { top: 360, height: 124 } }],
  );
  const after = resolvePaneLegendTops(
    { top: 40, height: 500 },
    [{ id: "vsa", rect: { top: 300, height: 184 } }],
  );
  assert.deepEqual(before, { vsa: 324 });
  assert.deepEqual(after, { vsa: 264 });
});

test("unlaid-out panes are omitted instead of flashing at chart top", () => {
  assert.deepEqual(
    resolvePaneLegendTops(
      { top: 100, height: 500 },
      [
        { id: "ready", rect: { top: 380, height: 124 } },
        { id: "pending", rect: { top: 100, height: 0 } },
      ],
    ),
    { ready: 284 },
  );
});

test("pane legend equality is identity and value based", () => {
  assert.equal(paneLegendTopsEqual({ vsa: 284, rsi: 408 }, { rsi: 408, vsa: 284 }), true);
  assert.equal(paneLegendTopsEqual({ vsa: 284 }, { vsa: 285 }), false);
  assert.equal(paneLegendTopsEqual({ vsa: 284 }, { vsa: 284, rsi: 408 }), false);
});
