import assert from "node:assert/strict";
import test from "node:test";
import {
  clampSurfaceOffset,
  sameSurfaceOffset,
} from "../../src/hooks/useDraggableSurface";

test("chart popup offsets clamp every edge inside shared bounds", () => {
  const base = { left: 100, top: 80, right: 200, bottom: 140 };
  const bounds = { left: 0, top: 0, right: 300, bottom: 220 };

  assert.deepEqual(
    clampSurfaceOffset({ x: -500, y: -500 }, base, bounds, 10),
    { x: -90, y: -70 },
  );
  assert.deepEqual(
    clampSurfaceOffset({ x: 500, y: 500 }, base, bounds, 10),
    { x: 90, y: 70 },
  );
});

test("chart popup offsets preserve valid placement", () => {
  const base = { left: 40, top: 40, right: 140, bottom: 100 };
  const bounds = { left: 0, top: 0, right: 240, bottom: 180 };
  assert.deepEqual(
    clampSurfaceOffset({ x: 20, y: 12 }, base, bounds, 6),
    { x: 20, y: 12 },
  );
});

test("an oversized popup is centred on the constrained axis", () => {
  const base = { left: 0, top: 20, right: 320, bottom: 80 };
  const bounds = { left: 0, top: 0, right: 300, bottom: 160 };
  assert.deepEqual(
    clampSurfaceOffset({ x: 90, y: 0 }, base, bounds, 10),
    { x: -10, y: 0 },
  );
});

test("sub-pixel measurement noise does not schedule another popup update", () => {
  assert.equal(
    sameSurfaceOffset(
      { x: 12.25, y: -4.75 },
      { x: 12.25001, y: -4.74999 },
    ),
    true,
  );
  assert.equal(
    sameSurfaceOffset(
      { x: 12.25, y: -4.75 },
      { x: 12.5, y: -4.75 },
    ),
    false,
  );
});
