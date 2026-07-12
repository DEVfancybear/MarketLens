import assert from "node:assert/strict";
import { test } from "node:test";

import { viewportModeForWidth } from "../../src/hooks/useViewportMode";

test("viewport policy has stable phone, tablet, and desktop boundaries", () => {
  assert.equal(viewportModeForWidth(390), "phone");
  assert.equal(viewportModeForWidth(767), "phone");
  assert.equal(viewportModeForWidth(768), "tablet");
  assert.equal(viewportModeForWidth(1023), "tablet");
  assert.equal(viewportModeForWidth(1024), "desktop");
  assert.equal(viewportModeForWidth(1920), "desktop");
});
