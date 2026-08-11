"use client";

import { deleteJson, getJson, postJson, putJson } from "@/services/api/client";
import { ApiError } from "@/services/api/errors";

export type TradeAuthorizationOperation = "order" | "command" | "copyGroup";

export type TradeSecurityStatus = {
  enabled: boolean;
  configured: boolean;
  unlocked: boolean;
  lockedUntilMs?: number;
};

type AuthorizationResponse = {
  token: string;
  expiresAtMs: number;
};

export type TradePasswordPrompt = (error?: string) => Promise<string | null>;

let passwordPrompt: TradePasswordPrompt | null = null;
let authorizationInFlight = false;

export function registerTradePasswordPrompt(
  prompt: TradePasswordPrompt | null,
): void {
  passwordPrompt = prompt;
}

export function openTradeSecuritySettings(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("trade-security-settings-open"));
  }
}

export function getTradeSecurityStatus(): Promise<TradeSecurityStatus> {
  return getJson<TradeSecurityStatus>("execution/trade-security", {
    retry: { limit: 0 },
  });
}

export function configureTradeSecurity(input: {
  enabled: boolean;
  password?: string;
  currentPassword?: string;
  idToken: string;
}): Promise<TradeSecurityStatus> {
  return putJson<TradeSecurityStatus>("execution/trade-security", input, {
    retry: { limit: 0 },
  });
}

export function lockTradeSession(): Promise<{ ok: true }> {
  return deleteJson<{ ok: true }>("execution/trade-security/unlock", {
    retry: { limit: 0 },
  });
}

async function requestAuthorization(
  operation: TradeAuthorizationOperation,
  payload: Record<string, unknown>,
  password?: string,
): Promise<AuthorizationResponse> {
  return postJson<AuthorizationResponse>(
    "execution/authorizations",
    password ? { operation, payload, password } : { operation, payload },
    { retry: { limit: 0 } },
  );
}

function validAuthorizationToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(value);
}

function passwordRequired(error: unknown): boolean {
  return error instanceof ApiError && error.status === 428;
}

async function withBrowserApprovalLock<T>(action: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks) {
    return navigator.locks.request(
      "smc-trade-password-approval",
      { mode: "exclusive" },
      action,
    );
  }
  return action();
}

async function unlockAndAuthorize(
  operation: TradeAuthorizationOperation,
  payload: Record<string, unknown>,
): Promise<AuthorizationResponse> {
  // Another tab may have unlocked the shared browser-session cookie while
  // this tab waited for the Web Lock. Recheck before showing a dialog.
  try {
    return await requestAuthorization(operation, payload);
  } catch (error) {
    if (!passwordRequired(error)) throw error;
  }
  if (!passwordPrompt) {
    throw new Error("Trade password dialog is unavailable. Reload and try again.");
  }

  let promptError: string | undefined;
  for (;;) {
    const password = await passwordPrompt(promptError);
    if (password === null) {
      throw new Error("Trade approval was cancelled.");
    }
    try {
      return await requestAuthorization(operation, payload, password);
    } catch (verificationError) {
      if (
        verificationError instanceof ApiError &&
        verificationError.status === 403
      ) {
        promptError = "Incorrect trade password. Please try again.";
        continue;
      }
      throw verificationError;
    }
  }
}

async function performTradeAuthorization(
  operation: TradeAuthorizationOperation,
  payload: Record<string, unknown>,
): Promise<string> {
  let authorization: AuthorizationResponse;
  try {
    authorization = await requestAuthorization(operation, payload);
  } catch (error) {
    if (!passwordRequired(error)) throw error;
    authorization = await withBrowserApprovalLock(() =>
      unlockAndAuthorize(operation, payload),
    );
  }
  if (!validAuthorizationToken(authorization.token)) {
    throw new Error("The server returned an invalid trade authorization.");
  }
  return authorization.token;
}

export async function authorizeTradeTransaction(
  operation: TradeAuthorizationOperation,
  payload: Record<string, unknown>,
): Promise<string> {
  if (authorizationInFlight) {
    throw new Error(
      "Another trade approval is already in progress. Complete or cancel it, then try again.",
    );
  }
  authorizationInFlight = true;
  try {
    return await performTradeAuthorization(operation, payload);
  } finally {
    authorizationInFlight = false;
  }
}
