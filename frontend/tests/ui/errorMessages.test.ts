import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ApiError,
  describeUserFacingError,
} from "../../src/services/api/errors";

test("backend API errors include useful status context", () => {
  const described = describeUserFacingError(
    new ApiError(500, "internal_server_error", "database unavailable"),
    "Workspace sync failed",
  );

  assert.equal(described.title, "Workspace sync failed");
  assert.match(described.message, /Backend error \(500\)/);
  assert.match(described.message, /database unavailable/);
  assert.match(described.technical ?? "", /500 internal_server_error/);
});

test("backend 401 errors are shown as expired backend sessions", () => {
  const described = describeUserFacingError(
    new ApiError(401, "unauthorized", "unauthorized"),
    "Publish script failed",
  );

  assert.match(described.message, /backend session expired/i);
  assert.match(described.message, /Sign in again/i);
});

test("network failures explain backend connectivity", () => {
  const described = describeUserFacingError(
    new TypeError("Failed to fetch"),
    "Backend login failed",
  );

  assert.match(described.message, /Cannot connect to the backend API/);
  assert.match(described.message, /NEXT_PUBLIC_API_BASE_URL/);
});

test("timeouts explain backend and MT5 bridge readiness", () => {
  const timeout = new Error("Request timed out");
  timeout.name = "TimeoutError";
  const described = describeUserFacingError(timeout, "History load failed");

  assert.match(described.message, /Go API and MT5 bridge/);
});

test("Firebase auth codes map to setup actions", () => {
  const described = describeUserFacingError(
    {
      code: "auth/unauthorized-domain",
      message: "Firebase: Error (auth/unauthorized-domain).",
    },
    "Google sign-in failed",
  );

  assert.match(described.message, /Firebase Authorized domains/);
});
