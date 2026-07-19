import { isApiError } from "../../services/api/errors";

export const MT5_SETUP_NOTE =
  "Enter your credentials, then download, extract, and run the Windows Connector. No source code or environment-variable setup is required.";

export const MT5_CONNECT_ACTION_LABEL = "Connect & Verify MT5";

export const MT5_CONNECTOR_RUNNING_NOTE =
  "The Windows MT5 Connector must be running for live trading.";

const MT5_SERVICE_UNAVAILABLE_MESSAGE =
  "The MT5 connection service is temporarily unavailable. Please try again shortly.";

const MT5_TIMEOUT_MESSAGE =
  "MT5 took too long to respond. Check the login and exact broker server, then try again.";

const MT5_INFRASTRUCTURE_ERROR_CODES = new Set([
  "dependency_unavailable",
  "initialize_failed",
  "internal_error",
  "MT5_ACCOUNT_UNAVAILABLE",
  "MT5_VERIFICATION_UNAVAILABLE",
]);

const MT5_CREDENTIAL_ERROR_MESSAGES: Record<string, string> = {
  missing_credentials:
    "Enter your MT5 login, exact broker server, and master password.",
  MT5_CREDENTIALS_INCOMPLETE:
    "Enter your MT5 login, exact broker server, and master password.",
  invalid_login: "MT5 login must be a positive number.",
  MT5_LOGIN_INVALID: "MT5 login must be a positive number.",
  login_failed:
    "MT5 rejected the login, broker server, or password. Check them and try again.",
  account_mismatch:
    "MT5 connected to a different account. Check the login and exact broker server, then try again.",
  unsupported_broker:
    "This connection is not an FTMO account. Check the exact FTMO broker server and try again.",
  trading_not_allowed:
    "This MT5 account does not allow trading. Use the master password for a trade-enabled account.",
  MT5_CREDENTIALS_CHANGED:
    "Your MT5 credentials changed while verification was running. Try again.",
};

interface ErrorLike {
  name?: string;
  message?: string;
}

/**
 * Keep deployment details out of the customer-facing MT5 flow. Backend logs
 * retain technical diagnostics; the dialog only presents actions a user can
 * take from the product.
 */
export function mt5VerificationErrorMessage(error: unknown): string {
  if (isApiError(error)) {
    const code = error.code.trim();

    if (code === "MT5_VERIFICATION_TIMEOUT") return MT5_TIMEOUT_MESSAGE;
    if (
      code.startsWith("MT5_VERIFIER_") ||
      MT5_INFRASTRUCTURE_ERROR_CODES.has(code) ||
      error.status >= 500
    ) {
      return MT5_SERVICE_UNAVAILABLE_MESSAGE;
    }
    if (error.status === 401) {
      return "Your session expired. Sign in again, then reconnect your MT5 account.";
    }
    if (MT5_CREDENTIAL_ERROR_MESSAGES[code]) {
      return MT5_CREDENTIAL_ERROR_MESSAGES[code];
    }
    if ([400, 409, 422].includes(error.status)) {
      return "MT5 could not verify these credentials. Check the login, exact broker server, and master password, then try again.";
    }
    return MT5_SERVICE_UNAVAILABLE_MESSAGE;
  }

  const maybeError = error as ErrorLike | undefined;
  if (
    maybeError?.name === "TimeoutError" ||
    maybeError?.message?.toLowerCase().includes("timed out")
  ) {
    return MT5_TIMEOUT_MESSAGE;
  }

  return MT5_SERVICE_UNAVAILABLE_MESSAGE;
}
