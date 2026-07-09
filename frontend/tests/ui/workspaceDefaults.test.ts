import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_SMC_SETTINGS,
  DEFAULT_UI_SETTINGS,
} from "../../src/store/workspaceDefaults";

test("workspace UI defaults keep the bottom panel collapsed", () => {
  assert.equal(DEFAULT_UI_SETTINGS.bottomOpen, false);
  assert.deepEqual(DEFAULT_UI_SETTINGS.panels, {
    right: 320,
    bottom: 240,
    left: 52,
  });
});

test("SMC overlays default to all disabled", () => {
  assert.deepEqual(DEFAULT_SMC_SETTINGS, {
    structure: false,
    fvg: false,
    orderBlocks: false,
    liquidity: false,
    displacement: false,
    sessions: false,
    killzones: false,
    swings: false,
  });
});
