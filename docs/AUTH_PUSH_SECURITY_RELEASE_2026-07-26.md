# Auth and Push security release - 2026-07-26

This runbook is the release-specific checklist for the auth bootstrap fix, auth security
hardening, and bounded PostgreSQL Push Alert sync. The maintained long-form contracts remain:

- `backend/docs/AUTH.md`
- `backend/docs/API.md`
- `backend/docs/CONFIGURATION.md`
- `backend/docs/PRODUCTION_BUILD.md`
- `docs/SECURITY.md`
- `docs/OPERATIONS.md`
- `frontend/docs/AUTH_UI.md`

## What changes

### Browser auth bootstrap

The frontend no longer probes `GET /auth/me`, then `POST /auth/refresh`, then
`POST /auth/google` during startup. Firebase restores the current Google user and the browser sends
one request:

```http
POST /api/v1/auth/session
Content-Type: application/json
Origin: https://tradingterminal.io.vn

{ "idToken": "<Firebase ID token>" }
```

The backend verifies the Firebase/Google identity first, then performs exactly one matching action:

| Existing browser state | Backend action | Response |
| --- | --- | --- |
| Valid access cookie for the same user | Reuse it; do not rewrite cookies | `200` |
| Expired/invalid access plus valid refresh for the same user | Atomically rotate refresh and issue access | `200` + cookies |
| No usable matching backend cookies | Create a new backend session | `200` + cookies |
| Cookies belong to another Firebase user | Never reuse them; revoke any mismatched rotated descendant and create the correct session | `200` + correct cookies |

`/auth/google` remains available for an older frontend rollback, but new bootstrap/recovery code must
use `/auth/session`.

### Auth security controls

- Firebase identities must be current Google sign-ins with a stable Google provider subject and
  verified email.
- Session establishment checks Firebase token revocation and disabled-user state with an
  eight-second upstream deadline. Invalid/revoked identities return `401`; transient Firebase
  timeout, network, quota, or 5xx failures return retryable `503`.
- ID tokens larger than 16 KiB and access tokens larger than 8 KiB are rejected before parsing.
- Backend access JWTs require HS256, issuer `tradingterminal-api`, audience
  `tradingterminal-web`, `iat`, `exp`, `sub`, and `sid`.
- Auth cookies are `HttpOnly; Secure; SameSite=Strict`. Production rejects
  `AUTH_COOKIE_SECURE=false`; the refresh cookie is limited to `/api/v1/auth`.
- Refresh rotation is one PostgreSQL lock/revoke/insert statement. Concurrent reuse can mint at
  most one descendant; replay of a revoked refresh token revokes all active sessions for the user.
- Disabled/deleted backend users cannot log in, refresh, resolve `/auth/me`, or update their
  profile.
- Unsafe cookie-bearing requests require an allowed `Origin`.
- `/auth/session`, `/auth/google`, and `/auth/refresh` share 120 attempts per five minutes per
  client IP. Cloudflare's client-IP header is trusted only from the loopback tunnel peer.

### Push Alert sync

`POST /api/push/alerts/sync` now owns an eight-second end-to-end deadline and propagates abort to
the Go PostgreSQL worker request.

| Status | Meaning | Client action |
| --- | --- | --- |
| `200` | Complete validated snapshot committed | Continue |
| `400` | Malformed alert/token or duplicate alert ID | Fix request; do not retry unchanged |
| `401` | Missing/invalid Firebase bearer token | Restore Firebase auth |
| `409` | FCM token belongs to another Firebase user | Do not loop; clear/re-register device state under the intended user |
| `413` | Snapshot exceeds the alert limit | Reduce snapshot |
| `503` + `Retry-After: 1` | Worker/PostgreSQL unavailable or deadline exceeded | Retry with normal bounded backoff |

Server logs expose only a safe error name/code. Never add Firebase bearer tokens, Firebase UIDs,
FCM tokens, or alert payloads to these logs.

## Production configuration gate

The effective backend configuration must satisfy:

```env
APP_ENV=production
AUTH_COOKIE_SECURE=true
CORS_ALLOWED_ORIGINS=https://tradingterminal.io.vn
AUTH_ACCESS_TTL=15m
AUTH_REFRESH_TTL=720h
ALERT_EVALUATOR_URL=https://tradingterminal.io.vn/api/push/evaluate
```

Also verify without printing values:

- `AUTH_JWT_SECRET` is at least 32 characters.
- `PUSH_WORKER_SECRET` is at least 32 characters and exactly matches Vercel Production.
- Backend and Vercel use the same Firebase project/service account.
- `NEXT_PUBLIC_API_BASE_URL=https://api.tradingterminal.io.vn` in Vercel Production.
- Firebase Authentication authorizes `tradingterminal.io.vn`.
- Migration `0025` is applied before the new Push routes are exercised.

Do not commit any `.env*` file.

## Pre-release gates

```powershell
cd frontend
npm ci
npm audit --omit=dev --audit-level=low
npm run lint
npm run typecheck
npm run test:alerts
npm run test:ui
npm run build

cd ..\backend
go test ./...
go vet ./...
govulncheck ./...
```

The production npm audit and reachable Go symbol/package scans must report zero vulnerabilities.
The full npm audit currently retains only the ESLint development-chain finding documented in
`docs/SECURITY.md`. `govulncheck` may report the unreachable
`golang.org/x/crypto/openpgp` module warning only while
`go mod why golang.org/x/crypto/openpgp` says the main module does not need that package.

## Deployment order

Backend-first is preferred. Because the frontend deploys automatically from `master`, use this
order when the backend is part of the release:

1. Update these docs and all code/tests.
2. Commit locally, but do not push yet.
3. Confirm `git status --short` is clean.
4. From the repository root, run the canonical backend runner with no switches:

   ```powershell
   .\run-backend-production.ps1
   ```

   A local commit may be ahead of `origin/master`; `git pull --ff-only` remains safe and the runner
   builds that clean local commit.
5. Wait for the runner's local and public health gates to pass.
6. Push `master`. This starts the Vercel production build only after the compatible backend is live.
7. Wait for Vercel Production, then perform the signed-in browser checks below.

When backend deployment is explicitly deferred, pushing the frontend is still compatible:

1. The frontend tries `/auth/session`.
2. Only a `404`/`405` (endpoint absent on the old backend) falls back once to `/auth/google`.
3. `400`, `401`, `403`, `429`, and `5xx` never fall back.

This compatibility path preserves login but does **not** activate the backend security hardening.
Deploy the backend later to remove the fallback request and enable verified session matching,
revocation checks, atomic rotation, Strict cookies, Origin enforcement, and auth rate limiting.

## Production verification

1. Open a fresh tab at `https://tradingterminal.io.vn` and sign in with Google.
2. In DevTools Network, confirm one of the documented rollout states:
   - new backend: one startup `/auth/session` returns `200`;
   - deferred old backend: `/auth/session` returns `404`/`405`, followed by one
     `/auth/google` `200`.
3. In both states, confirm there is no initial `GET /auth/me` or
   `POST /auth/refresh` 401 probe and protected resource requests succeed after
   session establishment.
4. With the new backend, inspect `Set-Cookie` only when the session is created/rotated. Confirm
   `HttpOnly`, `Secure`, `SameSite=Strict`, access path `/`, and refresh path `/api/v1/auth`.
5. Enable Push or update an alert. Confirm `POST /api/push/alerts/sync` returns `200` before the
   browser's 15-second client timeout.
6. Confirm public readiness:

   ```powershell
   Invoke-WebRequest https://api.tradingterminal.io.vn/health/ready
   ```

A direct unauthenticated `GET /api/v1/auth/me` must still return `401`; the fix is that normal
startup no longer sends that request before establishing a session.

If `/auth/session` returns `503`, keep the local Firebase state and retry with bounded backoff; this
is an upstream availability result, not rejected credentials. A revoked or disabled Firebase
identity returns `401`.

## Rollback

- Frontend rollback is safe because the backend retains `/auth/google`, `/auth/refresh`, and
  `/auth/me`.
- Do not roll the backend back to a version without `/auth/session` while the new frontend is live.
  Roll the frontend back first, verify old auth bootstrap, then consider backend rollback.
- This auth hardening adds no schema migration. The Push state still depends on migration `0025`
  from the PostgreSQL cutover and must not be rolled back to Firestore implicitly.
- If auth fails after deployment, preserve the hardened cookie/origin settings and fix the exact
  Firebase/CORS/hostname configuration. Do not set `SameSite=None`, disable Secure cookies, add
  `CORS_ALLOWED_ORIGINS=*`, or bypass token verification as an emergency workaround.
