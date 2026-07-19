import assert from "node:assert/strict";
import { test } from "node:test";

import { MT5_VERIFICATION_REQUEST_TIMEOUT_MS } from "../../src/services/api/timeouts";

test("MT5 verification request outlives the backend verifier budget", () => {
  assert.equal(MT5_VERIFICATION_REQUEST_TIMEOUT_MS, 45_000);
  assert.ok(MT5_VERIFICATION_REQUEST_TIMEOUT_MS > 30_000);
});
