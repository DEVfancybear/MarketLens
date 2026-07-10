import assert from "node:assert/strict";
import test from "node:test";

import { ApiError } from "../../src/services/api/errors";
import {
  replayConflictVersion,
  withReplayVersionRetry,
} from "../../src/services/replay/replayCommandRetry";

test("version conflict exposes the backend currentVersion detail", () => {
  const error = new ApiError(409, "version_conflict", "refresh", { currentVersion: 13 });
  assert.equal(replayConflictVersion(error), 13);
  assert.equal(replayConflictVersion(new ApiError(409, "session_busy", "busy")), null);
});

test("versioned Replay command refreshes and retries with a new attempt", async () => {
  const versions: number[] = [];
  const result = await withReplayVersionRetry(
    12,
    async (version, attempt) => {
      versions.push(version);
      if (attempt === 0) {
        throw new ApiError(409, "version_conflict", "refresh", { currentVersion: 13 });
      }
      return "applied";
    },
    async () => 99,
  );
  assert.equal(result, "applied");
  assert.deepEqual(versions, [12, 13]);
});

test("missing conflict details falls back to a fresh snapshot version", async () => {
  const versions: number[] = [];
  await withReplayVersionRetry(
    20,
    async (version, attempt) => {
      versions.push(version);
      if (attempt === 0) throw new ApiError(409, "version_conflict", "refresh");
      return undefined;
    },
    async () => 24,
  );
  assert.deepEqual(versions, [20, 24]);
});
