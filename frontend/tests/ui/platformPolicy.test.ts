import assert from "node:assert/strict";
import test from "node:test";
import { resolveTerminalPlatform } from "../../src/platform/platformPolicy";

test("phones and tablets use the isolated mobile shell", () => {
  assert.equal(resolveTerminalPlatform({ width: 390, coarsePointer: true }), "mobile");
  assert.equal(resolveTerminalPlatform({ width: 1024, coarsePointer: false }), "mobile");
});

test("coarse pointer devices never receive desktop drag affordances", () => {
  assert.equal(resolveTerminalPlatform({ width: 1440, coarsePointer: true }), "mobile");
});

test("wide fine-pointer devices use the desktop workspace", () => {
  assert.equal(resolveTerminalPlatform({ width: 1366, coarsePointer: false }), "desktop");
});
