import assert from "node:assert/strict";
import test from "node:test";

import { ApiError } from "../../src/services/api/errors";
import { replayErrorMessage } from "../../src/services/replay/replayErrorMessage";

test("Replay data errors expose the complete available UTC range", () => {
  const error = new ApiError(
    422,
    "data_point_unavailable",
    "the requested replay data point is unavailable",
    {
      firstAvailableTime: "2026-07-01T09:00:00.000Z",
      lastAvailableTime: "2026-07-13T20:15:00.000Z",
    },
  );

  assert.equal(
    replayErrorMessage(error),
    "Replay data is unavailable at the selected time. Choose a bar in the available UTC range: 2026-07-01 09:00 UTC to 2026-07-13 20:15 UTC.",
  );
});

test("Replay data errors still give UTC guidance when availability details are absent", () => {
  assert.equal(
    replayErrorMessage(new ApiError(422, "data_point_unavailable", "Unavailable")),
    "Replay data is unavailable at the selected time. Choose another UTC bar and try again.",
  );
});

test("other Replay failures keep their specific message and fallback", () => {
  assert.equal(
    replayErrorMessage(new ApiError(409, "version_conflict", "Replay state changed")),
    "Replay state changed",
  );
  assert.equal(replayErrorMessage(null, "Replay command failed"), "Replay command failed");
});
