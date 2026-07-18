import ky, { HTTPError, type Options } from "ky";
import { ApiError, type BackendErrorEnvelope } from "./errors";

const configuredApiBase = process.env.NEXT_PUBLIC_API_BASE_URL?.trim() ?? "";

// Resolve the backend origin the browser should call.
// A production bundle may be served both from localhost and from the machine's
// LAN/public hostname. Keep localhost self-contained even when the bundle was
// built with a LAN/public API URL; non-local hosts use the explicit deployment
// URL from NEXT_PUBLIC_API_BASE_URL.
function resolveApiBase(): string {
  if (typeof window !== "undefined") {
    const { hostname, protocol } = window.location;
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      return `${protocol}//${hostname}:8080`;
    }

    // When the local bundle is opened through a LAN address while its env
    // still points at localhost, keep the API on the same host. This is
    // important for browser cookie/site rules: localhost and 192.168.x.x are
    // different sites even when they resolve to the same machine.
    if (configuredApiBase) {
      try {
        const configured = new URL(configuredApiBase);
        if (
          configured.hostname === "localhost" ||
          configured.hostname === "127.0.0.1"
        ) {
          return `${protocol}//${hostname}:8080`;
        }
      } catch {
        // Fall through to the configured value below when it is malformed.
      }
    }
  }
  if (configuredApiBase) return configuredApiBase.replace(/\/+$/, "");
  if (process.env.NODE_ENV === "development") return "http://localhost:8080";
  return "";
}

function apiUrl(path: string): string {
  const cleanPath = path.replace(/^\/+/, "");
  const apiBase = resolveApiBase();
  if (!apiBase) return `/api/v1/${cleanPath}`;
  return `${apiBase}/api/v1/${cleanPath}`;
}

export function apiWebSocketUrl(path: string): string {
  const cleanPath = path.replace(/^\/+/, "");
  const httpUrl = apiUrl(cleanPath);
  const base =
    typeof window !== "undefined" ? window.location.origin : "http://localhost";
  const url = new URL(httpUrl, base);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

const apiDefaults = {
  credentials: "include" as const,
  timeout: 15_000,
  retry: {
    limit: 1,
    methods: ["get"],
    statusCodes: [408, 429, 500, 502, 503, 504],
  },
};

export function isBackendApiConfigured(): boolean {
  return resolveApiBase().length > 0;
}

export const apiClient = ky.create(apiDefaults);

let sessionRefreshPromise: Promise<boolean> | null = null;
let sessionExchangePromise: Promise<boolean> | null = null;
let currentIdTokenProviderForTests: (() => Promise<string | null>) | null = null;

async function apiErrorFromHTTP(error: HTTPError): Promise<ApiError> {
  const { response } = error;
  try {
    const body = (await response.clone().json()) as BackendErrorEnvelope;
    const code = body.error?.code ?? "http_error";
    const message = body.error?.message ?? response.statusText;
    return new ApiError(response.status, code, message, body.error?.details);
  } catch {
    return new ApiError(response.status, "http_error", response.statusText);
  }
}

function cleanApiPath(path: string): string {
  return path.replace(/^\/+/, "").split("?")[0] ?? "";
}

function shouldAttemptSessionRecovery(path: string): boolean {
  const cleanPath = cleanApiPath(path);
  return cleanPath !== "auth/refresh" && cleanPath !== "auth/google";
}

async function refreshBackendSession(): Promise<boolean> {
  sessionRefreshPromise ??= apiClient
    .post(apiUrl("auth/refresh"), {
      retry: { limit: 0 },
      timeout: 15_000,
    })
    .then(() => true)
    .catch(() => false)
    .finally(() => {
      sessionRefreshPromise = null;
    });
  return sessionRefreshPromise;
}

async function exchangeFirebaseSession(): Promise<boolean> {
  if (typeof window === "undefined" && !currentIdTokenProviderForTests) {
    return false;
  }
  sessionExchangePromise ??= (async () => {
    try {
      const idToken = currentIdTokenProviderForTests
        ? await currentIdTokenProviderForTests()
        : await import("../auth/firebaseAuth").then((mod) =>
            mod.currentIdToken(),
          );
      if (!idToken) return false;
      await apiClient.post(apiUrl("auth/google"), {
        json: { idToken },
        retry: { limit: 0 },
        timeout: 15_000,
      });
      return true;
    } catch {
      return false;
    }
  })().finally(() => {
    sessionExchangePromise = null;
  });
  return sessionExchangePromise;
}

async function recoverBackendSession(): Promise<boolean> {
  if (await refreshBackendSession()) return true;
  return exchangeFirebaseSession();
}

export function __setCurrentIdTokenProviderForTests(
  provider: (() => Promise<string | null>) | null,
): void {
  currentIdTokenProviderForTests = provider;
}

export async function normalizeApiError(error: unknown): Promise<never> {
  if (error instanceof HTTPError) {
    throw await apiErrorFromHTTP(error);
  }
  throw error;
}

async function withSessionRefresh<T>(
  path: string,
  request: () => Promise<T>,
): Promise<T> {
  try {
    return await request();
  } catch (error) {
    if (
      error instanceof HTTPError &&
      error.response.status === 401 &&
      shouldAttemptSessionRecovery(path) &&
      (await recoverBackendSession())
    ) {
      try {
        return await request();
      } catch (retryError) {
        return normalizeApiError(retryError);
      }
    }
    return normalizeApiError(error);
  }
}

export async function getJson<T>(path: string, options?: Options): Promise<T> {
  return withSessionRefresh(path, () =>
    apiClient.get(apiUrl(path), options).json<T>(),
  );
}

export async function postJson<T>(
  path: string,
  json?: unknown,
  options?: Options,
): Promise<T> {
  return withSessionRefresh(path, () =>
    apiClient.post(apiUrl(path), { ...options, json }).json<T>(),
  );
}

export async function putJson<T>(
  path: string,
  json?: unknown,
  options?: Options,
): Promise<T> {
  return withSessionRefresh(path, () =>
    apiClient.put(apiUrl(path), { ...options, json }).json<T>(),
  );
}

export async function patchJson<T>(
  path: string,
  json?: unknown,
  options?: Options,
): Promise<T> {
  return withSessionRefresh(path, () =>
    apiClient.patch(apiUrl(path), { ...options, json }).json<T>(),
  );
}

export async function deleteJson<T>(
  path: string,
  options?: Options,
): Promise<T> {
  return withSessionRefresh(path, () =>
    apiClient.delete(apiUrl(path), options).json<T>(),
  );
}
