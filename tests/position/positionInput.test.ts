import assert from "node:assert/strict";
import { test } from "node:test";

import { parseNumberDraft } from "../../src/components/chart/drawing/tools/positionInput";

test("numeric drafts that are not complete numbers do not commit as zero", () => {
  for (const draft of ["", " ", "-", "+", ".", "-.", "+."]) {
    assert.equal(parseNumberDraft(draft), null);
  }
});

test("complete numeric drafts parse normally", () => {
  assert.equal(parseNumberDraft("1467"), 1467);
  assert.equal(parseNumberDraft("62061.8"), 62061.8);
  assert.equal(parseNumberDraft("  -12.5 "), -12.5);
});
