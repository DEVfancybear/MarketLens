import assert from "node:assert/strict";
import test from "node:test";

import { makeClientCommandId } from "../../src/services/execution/identifiers";

test("execution command ids use cryptographically random UUIDs", () => {
  const ids = new Set(
    Array.from({ length: 256 }, () => makeClientCommandId("exec_test")),
  );

  assert.equal(ids.size, 256);
  for (const id of ids) {
    assert.match(
      id,
      /^exec_test_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  }
});
