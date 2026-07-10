import assert from "node:assert/strict";
import test from "node:test";

import { isReplayBackendV1Enabled } from "../../src/services/replay/backendReplayFlag";

test("backend replay Phase 1 requires an explicit true feature flag", () => {
  assert.equal(isReplayBackendV1Enabled(undefined), false);
  assert.equal(isReplayBackendV1Enabled("false"), false);
  assert.equal(isReplayBackendV1Enabled("1"), false);
  assert.equal(isReplayBackendV1Enabled(" TRUE "), true);
});
