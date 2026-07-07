import ky, { HTTPError, type Options } from "ky";
import { ApiError, type BackendErrorEnvelope } from "./errors";

const configuredApiBase = process.env.NEXT_PUBLIC_API_BASE_URL?.trim() ?? "";

// Resolve the backend origin the browser should call.
//   1. An explicit NEXT_PUBLIC_API_BASE_URL always wins (required for real deploys).
//   2. `next dev` defaults to the local Go Fiber backend on :8080.
//   3. A production build served from localhost (e.g. `next start` on the dev
//      box) also targets :8080 so it works without a rebuild. Real deployments
//      serve from a non-localhost host, where we refuse to guess.
function resolveApiBase(): string {
  if (configuredApiBase) return configuredApiBase.replace(/\/+$/, "");
  if (process.env.NODE_ENV === "development") return "http://localhost:8080";
  if (typeof window !== "undefined") {
    const { hostname, protocol } = window.location;
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      return `${protocol}//${hostname}:8080`;
    }
  }
  return "";
}

function apiUrl(path: string): string {
  const cleanPath = path.replace(/^\/+/, "");
  const apiBase = resolveApiBase();
  if (!apiBase) return `/api/v1/${cleanPath}`;
  return `${apiBase}/api/v1/${cleanPath}`;
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

async function apiErrorFromHTTP(error: HTTPError): Promise<ApiError> {
  const { response } = error;
  try {
    const body = (await response.clone().json()) as BackendErrorEnvelope;
    const code = body.error?.code ?? "http_error";
    const message = body.error?.message ?? response.statusText;
    return new ApiError(response.status, code, message);
  } catch {
    return new ApiError(response.status, "http_error", response.statusText);
  }
}

export async function normalizeApiError(error: unknown): Promise<never> {
  if (error instanceof HTTPError) {
    throw await apiErrorFromHTTP(error);
  }
  throw error;
}

export async function getJson<T>(path: string, options?: Options): Promise<T> {
  try {
    return await apiClient.get(apiUrl(path), options).json<T>();
  } catch (error) {
    return normalizeApiError(error);
  }
}

export async function postJson<T>(
  path: string,
  json?: unknown,
  options?: Options,
): Promise<T> {
  try {
    return await apiClient.post(apiUrl(path), { ...options, json }).json<T>();
  } catch (error) {
    return normalizeApiError(error);
  }
}

export async function putJson<T>(
  path: string,
  json?: unknown,
  options?: Options,
): Promise<T> {
  try {
    return await apiClient.put(apiUrl(path), { ...options, json }).json<T>();
  } catch (error) {
    return normalizeApiError(error);
  }
}

export async function patchJson<T>(
  path: string,
  json?: unknown,
  options?: Options,
): Promise<T> {
  try {
    return await apiClient.patch(apiUrl(path), { ...options, json }).json<T>();
  } catch (error) {
    return normalizeApiError(error);
  }
}

export async function deleteJson<T>(
  path: string,
  options?: Options,
): Promise<T> {
  try {
    return await apiClient.delete(apiUrl(path), options).json<T>();
  } catch (error) {
    return normalizeApiError(error);
  }
}
