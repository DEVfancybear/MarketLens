import assert from "node:assert/strict";
import { test } from "node:test";

import { viewportModeForWidth } from "../../src/hooks/useViewportMode";
import { viewportModeFor } from "../../src/hooks/useViewport";

test("viewport policy has stable phone, tablet, and desktop boundaries", () => {
  assert.equal(viewportModeForWidth(390), "phone");
  assert.equal(viewportModeForWidth(767), "phone");
  assert.equal(viewportModeForWidth(768), "tablet");
  assert.equal(viewportModeForWidth(1023), "tablet");
  assert.equal(viewportModeForWidth(1024), "tablet");
  assert.equal(viewportModeForWidth(1199), "tablet");
  assert.equal(viewportModeForWidth(1200), "desktop");
  assert.equal(viewportModeForWidth(1920), "desktop");
});

test("coarse pointers retain tablet interaction policy at wide widths", () => {
  assert.equal(viewportModeFor(1366, "coarse"), "tablet");
  assert.equal(viewportModeFor(1366, "fine"), "desktop");
});
