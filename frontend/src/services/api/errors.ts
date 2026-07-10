export interface BackendErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function isUnauthorizedApiError(error: unknown): boolean {
  return isApiError(error) && error.status === 401;
}

export interface UserFacingError {
  title: string;
  message: string;
  technical?: string;
}

interface ErrorLike {
  name?: string;
  message?: string;
  code?: string;
}

const FIREBASE_MESSAGES: Record<string, string> = {
  "auth/popup-blocked":
    "Browser blocked the Google sign-in popup. Allow popups for this site and try again.",
  "auth/unauthorized-domain":
    "This domain is not allowed in Firebase Auth. Add it to Firebase Authorized domains.",
  "auth/network-request-failed":
    "Firebase Auth could not reach Google. Check your connection and try again.",
  "auth/account-exists-with-different-credential":
    "This email already exists with a different sign-in method.",
  "auth/operation-not-allowed":
    "Google sign-in is disabled in Firebase. Enable the Google provider in Firebase Auth.",
};

export function errorMessage(error: unknown, fallback = "Unknown error"): string {
  if (isApiError(error)) return error.message || fallback;
  if (error instanceof Error && error.message) return error.message;
  const maybe = error as ErrorLike | undefined;
  return maybe?.message || fallback;
}

export function describeUserFacingError(
  error: unknown,
  title = "Request failed",
): UserFacingError {
  if (isApiError(error)) {
    return {
      title,
      message: apiErrorMessage(error),
      technical: `${error.status} ${error.code}: ${error.message}`,
    };
  }

  const maybe = error as ErrorLike | undefined;
  if (maybe?.code && FIREBASE_MESSAGES[maybe.code]) {
    return {
      title,
      message: FIREBASE_MESSAGES[maybe.code],
      technical: maybe.message,
    };
  }

  if (maybe?.name === "TimeoutError") {
    return {
      title,
      message:
        "The backend did not respond in time. Check that the Go API and MT5 bridge are running, then try again.",
      technical: maybe.message,
    };
  }

  const rawMessage = errorMessage(error, "");
  if (isNetworkFailure(rawMessage)) {
    return {
      title,
      message:
        "Cannot connect to the backend API. Check that the Go backend is running and NEXT_PUBLIC_API_BASE_URL points to the correct host.",
      technical: rawMessage,
    };
  }

  return {
    title,
    message: rawMessage || "Something went wrong. Check Logs for details.",
    technical: rawMessage || undefined,
  };
}

function apiErrorMessage(error: ApiError): string {
  if (error.status === 401) {
    return "Your backend session expired. Sign in again to continue syncing your workspace.";
  }
  if (error.status === 403) {
    return "You do not have permission to perform this action.";
  }
  if (error.status === 404) {
    return "The requested backend resource was not found.";
  }
  if (error.status >= 500) {
    return `Backend error (${error.status}). ${error.message || "Check backend logs."}`;
  }
  return error.message || `Request failed with status ${error.status}.`;
}

function isNetworkFailure(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("failed to fetch") ||
    lower.includes("networkerror") ||
    lower.includes("network request failed") ||
    lower.includes("load failed")
  );
}
