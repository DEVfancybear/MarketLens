# Security hardening

This document records the security boundaries enforced by the application and the minimum
deployment requirements for them. It is a living checklist, not a claim that a static audit can
prove the absence of every vulnerability.

## Authentication and browser requests

- Go API mutations reject a browser `Origin` that is not in `CORS_ALLOWED_ORIGINS`.
- Credentialed CORS never accepts `*`; origins must be complete `http://` or `https://` origins
  without a path, query, fragment, or user-info component.
- Access and refresh cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` outside development.
- `AUTH_JWT_SECRET` must contain at least 32 characters whenever database/Firebase authentication
  is assembled, and in every production environment.
- Next push-device endpoints require a Firebase ID token. Device records are associated with the
  Firebase UID, preventing one signed-in user from managing another user's token.

## Internal service credentials

- `PUSH_WORKER_SECRET`, `CRON_SECRET`, and `ALERT_WEBHOOK_SECRET` checks fail closed when the
  configured secret is missing or incorrect.
- Use at least 32 random bytes for worker and bridge secrets. Never place these values under a
  `NEXT_PUBLIC_` variable.
- The Python MT5 stream is loopback-only because its WebSocket protocol has no remote
  authentication. Do not bind it to a LAN/WAN interface without adding an authenticated protocol.
- FTMO bridge live mode and any non-loopback bind require `FTMO_BRIDGE_TOKEN` (32+ random bytes).

## Payload and response hardening

- Go request bodies are capped at 8 MiB and responses include browser hardening headers.
- Push tokens, alert counts, notification text, and push data are bounded before persistence or
  delivery.
- Discord webhook URLs are restricted to official HTTPS webhook hosts both when written and when
  read from legacy storage.

## Dependency/runtime requirements

- Frontend dependencies are locked and must pass `npm audit --audit-level=low` with zero findings.
- Backend builds must use Go 1.26.5 or newer. The `go 1.26.5` directive in `backend/go.mod`
  makes that minimum explicit because Go 1.26.4 contains a `crypto/tls` vulnerability detected
  by `govulncheck`.

## Secrets that are intentionally public today

Provider variables prefixed with `NEXT_PUBLIC_` are bundled into browser JavaScript. This currently
includes optional market-data provider keys. Treat those keys as exposed and restrict/rotate them
at the provider; if the provider key is confidential, move the provider call behind a server-side
proxy before production use.

## Release checklist

```bash
cd frontend
npm ci
npm audit --audit-level=low
npm run typecheck
npm run lint
npm run build

cd ../backend
go test ./...
go vet ./...
```

Set production secrets, verify `CORS_ALLOWED_ORIGINS` contains only the deployed frontend origin,
and confirm the runtime reports Go 1.26.5 or newer before exposing the service publicly.
