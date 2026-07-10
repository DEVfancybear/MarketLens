import assert from "node:assert/strict";
import test from "node:test";

import { isReplayBackendV1Enabled } from "../../src/services/replay/backendReplayFlag";

test("backend replay defaults on and supports an explicit deployment kill switch", () => {
  assert.equal(isReplayBackendV1Enabled(undefined), true);
  assert.equal(isReplayBackendV1Enabled("false"), false);
  assert.equal(isReplayBackendV1Enabled("0"), false);
  assert.equal(isReplayBackendV1Enabled("off"), false);
  assert.equal(isReplayBackendV1Enabled("1"), true);
  assert.equal(isReplayBackendV1Enabled(" TRUE "), true);
});
