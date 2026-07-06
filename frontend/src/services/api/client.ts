import ky, { HTTPError, type Options } from "ky";
import { ApiError, type BackendErrorEnvelope } from "./errors";

const configuredApiBase = process.env.NEXT_PUBLIC_API_BASE_URL?.trim() ?? "";

// Local development defaults to the Go Fiber backend port. Production must set
// NEXT_PUBLIC_API_BASE_URL explicitly so the browser never guesses an API host.
const API_BASE = (
  configuredApiBase ||
  (process.env.NODE_ENV === "development" ? "http://localhost:8080" : "")
).replace(/\/+$/, "");

export function isBackendApiConfigured(): boolean {
  return API_BASE.length > 0;
}

export const apiClient = ky.create({
  ...(API_BASE ? { prefixUrl: `${API_BASE}/api/v1` } : {}),
  credentials: "include",
  timeout: 15_000,
  retry: {
    limit: 1,
    methods: ["get"],
    statusCodes: [408, 429, 500, 502, 503, 504],
  },
});

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
    return await apiClient.get(path, options).json<T>();
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
    return await apiClient.post(path, { ...options, json }).json<T>();
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
    return await apiClient.put(path, { ...options, json }).json<T>();
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
    return await apiClient.patch(path, { ...options, json }).json<T>();
  } catch (error) {
    return normalizeApiError(error);
  }
}

export async function deleteJson<T>(
  path: string,
  options?: Options,
): Promise<T> {
  try {
    return await apiClient.delete(path, options).json<T>();
  } catch (error) {
    return normalizeApiError(error);
  }
}
