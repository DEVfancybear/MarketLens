import assert from "node:assert/strict";
import { test } from "node:test";

import { rebaseDrawingBatchForLastWriteWins } from "../../src/components/chart/drawing/persistence/drawingConflictPolicy";
import type {
  BackendDrawing,
  BackendDrawingBatchRequest,
} from "../../src/services/api/resources/drawingsApi";

const payload = {
  schemaVersion: 1,
  id: "dw-1",
  tool: "trendline" as const,
  color: "#2962ff",
  lineWidth: 1.5,
  points: [
    { time: 1, price: 1 },
    { time: 2, price: 2 },
  ],
};

test("last-write-wins rebases updates and deletes to observed server revision", () => {
  const request: BackendDrawingBatchRequest = {
    upserts: [{ symbol: "EURUSD", toolType: "trendline", clientId: "dw-1", payload }],
    deletes: [{ symbol: "EURUSD", clientId: "dw-2", expectedRevision: 1 }],
  };
  const remote = [
    { id: "server-1", symbol: "EURUSD", toolType: "trendline", clientId: "dw-1", payload, locked: false, hidden: false, revision: 7, createdAt: "", updatedAt: "" },
    { id: "server-2", symbol: "EURUSD", toolType: "trendline", clientId: "dw-2", payload: { ...payload, id: "dw-2" }, locked: false, hidden: false, revision: 4, createdAt: "", updatedAt: "" },
  ] satisfies BackendDrawing[];
  const rebased = rebaseDrawingBatchForLastWriteWins(request, remote);
  assert.equal(rebased.upserts[0].expectedRevision, 7);
  assert.equal(rebased.deletes[0].expectedRevision, 4);
});
