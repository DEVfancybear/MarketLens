const DEFAULT_DOWNLOAD_URL = "/downloads/SMCExecutionEA.ex5";
const DEFAULT_CHECKSUM_URL = "/downloads/SMCExecutionEA.sha256.txt";
const LOCAL_API_ORIGIN = "http://localhost:8080";

function safeHttpUrl(
  value: string,
  options: { allowQueryOrFragment?: boolean } = {},
): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    if (!options.allowQueryOrFragment && (url.search || url.hash)) return null;
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function safeBrowserDownloadUrl(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return trimmed;
  return safeHttpUrl(trimmed, { allowQueryOrFragment: true });
}

function safeGatewayUrl(value: string): string | null {
  const normalized = safeHttpUrl(value);
  if (!normalized) return null;
  const url = new URL(normalized);
  const loopback =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]";
  return url.protocol === "https:" || loopback ? normalized : null;
}

export function resolveExecutionEaDownloadUrl(
  configuredUrl = "",
): string {
  return safeBrowserDownloadUrl(configuredUrl) ?? DEFAULT_DOWNLOAD_URL;
}

export function resolveExecutionEaChecksumUrl(
  configuredUrl = "",
): string {
  return safeBrowserDownloadUrl(configuredUrl) ?? DEFAULT_CHECKSUM_URL;
}

export function resolveExecutionEaGatewayUrl(options: {
  configuredUrl?: string;
  apiBaseUrl?: string;
  browserOrigin?: string;
} = {}): string {
  const configured = safeGatewayUrl(options.configuredUrl?.trim() ?? "");
  if (configured) return configured;

  const apiOrigin =
    safeGatewayUrl(options.apiBaseUrl?.trim() ?? "") ??
    safeGatewayUrl(options.browserOrigin?.trim() ?? "") ??
    LOCAL_API_ORIGIN;
  return `${apiOrigin}/execution-ea`;
}

export function executionEaDistribution() {
  return {
    downloadUrl: resolveExecutionEaDownloadUrl(
      process.env.NEXT_PUBLIC_EXECUTION_EA_DOWNLOAD_URL,
    ),
    checksumUrl: resolveExecutionEaChecksumUrl(
      process.env.NEXT_PUBLIC_EXECUTION_EA_CHECKSUM_URL,
    ),
    gatewayUrl: resolveExecutionEaGatewayUrl({
      configuredUrl: process.env.NEXT_PUBLIC_EXECUTION_EA_URL,
      apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL,
    }),
  };
}
