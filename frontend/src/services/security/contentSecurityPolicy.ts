const quoted = (value: string): string => `'${value}'`;

function originSource(rawValue: string | undefined): string[] {
  const value = rawValue?.trim();
  if (!value) return [];
  try {
    const url = new URL(value);
    const sources = [url.origin];
    if (url.protocol === "https:") sources.push(`wss://${url.host}`);
    if (url.protocol === "http:") sources.push(`ws://${url.host}`);
    return sources;
  } catch {
    return [];
  }
}

function configuredConnectSources(
  rawValue: string | undefined,
  production: boolean,
): string[] {
  const allowed = production
    ? new Set(["https:", "wss:"])
    : new Set(["https:", "wss:", "http:", "ws:"]);
  const result = new Set<string>();
  for (const value of rawValue?.split(",") ?? []) {
    try {
      const url = new URL(value.trim());
      if (allowed.has(url.protocol)) result.add(url.origin);
    } catch {
      // Ignore malformed or directive-like values instead of weakening CSP.
    }
  }
  return Array.from(result);
}

export function buildContentSecurityPolicy(
  nonce: string,
  production: boolean,
): string {
  const connectSources = new Set([
    quoted("self"),
    ...originSource(process.env.NEXT_PUBLIC_API_BASE_URL),
    "https://*.googleapis.com",
    "https://*.firebaseio.com",
    "wss://*.firebaseio.com",
    "https://api.binance.com",
    "wss://stream.binance.com",
    "https://api.twelvedata.com",
    "wss://ws.twelvedata.com",
    "https://api-fxpractice.oanda.com",
    "https://api-fxtrade.oanda.com",
    ...configuredConnectSources(process.env.CSP_CONNECT_SOURCES, production),
  ]);
  if (!production) {
    connectSources.add("http://localhost:*");
    connectSources.add("ws://localhost:*");
    connectSources.add("http://127.0.0.1:*");
    connectSources.add("ws://127.0.0.1:*");
  }

  const directives = [
    `default-src ${quoted("self")}`,
    `script-src ${quoted("self")} 'nonce-${nonce}' ${quoted("strict-dynamic")}${
      production ? "" : ` ${quoted("unsafe-eval")}`
    }`,
    `script-src-attr ${quoted("none")}`,
    `style-src ${quoted("self")} 'nonce-${nonce}'`,
    `style-src-attr ${quoted("unsafe-inline")}`,
    `img-src ${quoted("self")} data: blob: https:`,
    `font-src ${quoted("self")} data:`,
    `connect-src ${Array.from(connectSources).join(" ")}`,
    `frame-src https://accounts.google.com https://*.firebaseapp.com`,
    `worker-src ${quoted("self")} blob:`,
    `manifest-src ${quoted("self")}`,
    `media-src ${quoted("self")} blob:`,
    `object-src ${quoted("none")}`,
    `base-uri ${quoted("self")}`,
    `form-action ${quoted("self")}`,
    `frame-ancestors ${quoted("none")}`,
  ];
  if (production) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}

export const firebaseWorkerContentSecurityPolicy = [
  `default-src ${quoted("none")}`,
  `script-src ${quoted("self")} https://www.gstatic.com`,
  `connect-src https://*.googleapis.com https://*.firebaseio.com`,
  `img-src ${quoted("self")} data: https:`,
].join("; ");
