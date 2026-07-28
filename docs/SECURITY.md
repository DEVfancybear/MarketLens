# Security hardening

This document records the security boundaries enforced by the application and the minimum
deployment requirements for them. It is a living checklist, not a claim that a static audit can
prove the absence of every vulnerability.

## Authentication and browser requests

- Go API mutations reject a browser `Origin` that is not in `CORS_ALLOWED_ORIGINS`; unsafe
  cookie-bearing requests with no `Origin` are rejected as well.
- Credentialed CORS never accepts `*`; origins must be complete `http://` or `https://` origins
  without a path, query, fragment, or user-info component.
- Access and refresh cookies are `HttpOnly`, `SameSite=Strict`, and `Secure`; production refuses
  to start if `AUTH_COOKIE_SECURE=false`.
- `AUTH_JWT_SECRET` must contain at least 32 characters whenever database/Firebase authentication
  is assembled. Access JWTs require the expected issuer, audience, HS256 algorithm, and bounded TTL.
- Firebase login accepts only Google sign-in identities with verified email and a stable Google
  provider subject. The one-call `/auth/session` endpoint refuses to reuse cookies from a different
  Firebase user.
- Backend session establishment checks Firebase revocation/disabled-user state with an eight-second
  upstream deadline. Invalid/revoked identities return `401`; transient upstream failures return
  retryable `503`.
- Refresh-token replacement is an atomic PostgreSQL lock/revoke/insert operation. Concurrent replay
  cannot mint two descendants, and disabled/deleted users cannot refresh.
- Every execution request re-checks that the JWT `sid` and `sub` still identify the same active,
  unexpired PostgreSQL session. Logout, refresh rotation, and server-side revocation therefore stop
  account/position reads as well as new orders, commands, pairing, mappings, layout changes,
  disconnects, and removals immediately; a session-store outage fails execution closed.
- Execution requests are throttled per authenticated user before the active-session database read.
  All mutations share a lower ceiling, orders/commands have a stricter ceiling, and pairing-token
  issuance has the strictest ceiling. Keep Cloudflare/WAF limits enabled as the distributed outer
  layer.
- Frontend logout is fail-closed: Firebase sign-out is not presented as successful when the backend
  could not revoke the HttpOnly execution session.
- Auth establishment endpoints have a per-client in-process rate limit. Keep a Cloudflare/WAF rate
  limit enabled as the distributed outer layer.
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

- Frontend runtime dependencies are locked and must pass
  `npm audit --omit=dev --audit-level=low` with zero findings. Run the full `npm audit` as an
  informational second gate. As of 2026-07-26, its remaining findings are confined to the ESLint
  development dependency chain: forcing ESLint 10 breaks the React plugin bundled by
  `eslint-config-next@16.2.12`, and forcing one `brace-expansion` major breaks Minimatch. These
  packages are not included in the production bundle; remove this temporary exception as soon as
  the Next ESLint stack supports the fixed major.
- Next, Firebase, PostCSS, Sharp, `fast-xml-parser`, and `protobufjs` are pinned/resolved to patched
  versions in `frontend/package-lock.json`. Do not remove the PostCSS/Sharp overrides without a
  clean production audit and build.
- Backend builds must use Go 1.26.5 or newer. The `go 1.26.5` directive in `backend/go.mod`
  makes that minimum explicit because Go 1.26.4 contains a `crypto/tls` vulnerability detected
  by `govulncheck`.
- Run `govulncheck ./...` for every backend dependency change. The release gate is zero reachable
  symbol/package vulnerabilities. A module-only warning is acceptable only when
  `go mod why <vulnerable-package>` proves the main module does not need that package; record it in
  the release notes rather than silently suppressing it.

## Secrets that are intentionally public today

Provider variables prefixed with `NEXT_PUBLIC_` are bundled into browser JavaScript. This currently
includes optional market-data provider keys. Treat those keys as exposed and restrict/rotate them
at the provider; if the provider key is confidential, move the provider call behind a server-side
proxy before production use.

## Release checklist

```bash
cd frontend
npm ci
npm audit --omit=dev --audit-level=low
npm audit
npm run typecheck
npm run lint
npm run build

cd ../backend
go test ./...
go vet ./...
govulncheck ./...
```

Set production secrets, verify `CORS_ALLOWED_ORIGINS` contains only the deployed frontend origin,
confirm the runtime reports Go 1.26.5 or newer, and retain the scan output with the release evidence
before exposing the service publicly.

## High-value transaction control

The confirmation dialog remains a safety affordance. Users may enable an optional second trade
password, requested once per browser trade session and shared across its tabs through a
non-persistent, `HttpOnly`, server-backed unlock cookie. Go always issues a short-lived one-time
token bound to the exact JSON payload, user, and active session; Rust atomically consumes it before
enqueueing and fails closed on reuse, mutation, expiry, revocation, or unavailable database state.
See [TRADE_PASSWORD_AUTHORIZATION.md](TRADE_PASSWORD_AUTHORIZATION.md).

The frontend also enforces a per-request nonce CSP with production `strict-dynamic`, no script
attributes, no `unsafe-eval`, no framing, and no object embedding. This substantially reduces XSS
reach but does not make arbitrary same-origin compromise impossible.
