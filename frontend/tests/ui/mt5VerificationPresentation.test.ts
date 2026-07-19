import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MT5_CONNECT_ACTION_LABEL,
  MT5_CONNECTOR_RUNNING_NOTE,
  MT5_SETUP_NOTE,
  mt5VerificationErrorMessage,
} from "../../src/components/settings/mt5VerificationPresentation";
import { ApiError } from "../../src/services/api/errors";

const OPERATOR_DETAILS =
  "Set MT5_VERIFY_TERMINAL_PATH=C:\\Broker\\terminal64.exe, install Python, edit .env, and run build-production.ps1.";

test("MT5 setup copy requires credentials only", () => {
  assert.equal(MT5_CONNECT_ACTION_LABEL, "Connect & Verify MT5");
  assert.match(MT5_SETUP_NOTE, /No source code or environment-variable setup/i);
  assert.doesNotMatch(MT5_SETUP_NOTE, /terminal64|python|build-production/i);
  assert.match(MT5_CONNECTOR_RUNNING_NOTE, /Windows MT5 Connector must be running/i);
  assert.doesNotMatch(
    MT5_CONNECTOR_RUNNING_NOTE,
    /MT5_VERIFY|terminal64|python|build-production|\.env/i,
  );
});

test("MT5 infrastructure errors never expose operator instructions", () => {
  const cases = [
    new ApiError(503, "MT5_VERIFIER_TERMINAL_REQUIRED", OPERATOR_DETAILS),
    new ApiError(503, "MT5_VERIFIER_TERMINAL_NOT_ISOLATED", OPERATOR_DETAILS),
    new ApiError(503, "MT5_VERIFIER_TERMINAL_UNAVAILABLE", OPERATOR_DETAILS),
    new ApiError(422, "dependency_unavailable", OPERATOR_DETAILS),
    new ApiError(502, "MT5_VERIFICATION_UNAVAILABLE", OPERATOR_DETAILS),
  ];

  for (const error of cases) {
    const message = mt5VerificationErrorMessage(error);
    assert.match(message, /temporarily unavailable/i);
    assert.doesNotMatch(
      message,
      /MT5_VERIFY|terminal64|python|build-production|\.env/i,
    );
  }
});

test("MT5 verification timeouts have a user-actionable message", () => {
  const apiTimeout = mt5VerificationErrorMessage(
    new ApiError(504, "MT5_VERIFICATION_TIMEOUT", OPERATOR_DETAILS),
  );
  const browserTimeout = new Error(OPERATOR_DETAILS);
  browserTimeout.name = "TimeoutError";

  assert.match(apiTimeout, /took too long/i);
  assert.match(apiTimeout, /login and exact broker server/i);
  assert.equal(mt5VerificationErrorMessage(browserTimeout), apiTimeout);
  assert.doesNotMatch(apiTimeout, /MT5_VERIFY|terminal64|python|\.env/i);
});

test("MT5 credential failures remain actionable without echoing backend text", () => {
  const message = mt5VerificationErrorMessage(
    new ApiError(422, "login_failed", OPERATOR_DETAILS),
  );

  assert.match(message, /login, broker server, or password/i);
  assert.doesNotMatch(message, /MT5_VERIFY|terminal64|python|\.env/i);
});
