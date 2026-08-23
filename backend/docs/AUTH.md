# Authentication and trade authorization

MarketLens uses Firebase only to prove the current Google identity. The Go backend then owns its
own short-lived access token, rotating refresh session, cookie policy, revocation, and sensitive
trade authorization.

## Identity requirements

The backend calls Firebase Admin `VerifyIDTokenAndCheckRevoked`. A session is created only when the
token is current and all of these are true:

- Firebase sign-in provider is `google.com`;
- the Google provider subject exists in the Firebase identities claim;
- email exists and `email_verified` is true;
- the token is no larger than 16 KiB.

Malformed, expired, revoked, disabled, non-Google, or incomplete identities return `401`.
Transient identity-provider network/quota/5xx failures return retryable `503` and do not mint
cookies.

## Browser bootstrap

The preferred flow is:

1. Browser signs in with Firebase Google and obtains a Firebase ID token.
2. Browser sends `POST /api/v1/auth/session` with `{"idToken":"..."}`.
3. Backend verifies the identity and resolves/upserts the user by provider identity.
4. Backend performs exactly one safe action:
   - reuse a valid access cookie that belongs to the same user;
   - rotate a valid matching refresh session; or
   - create a new backend session.
5. Browser uses the access cookie for protected routes. It never stores a backend bearer token in
   JavaScript-accessible storage.

If Firebase user B signs in while cookies belong to user A, A's access session is not reused. A
rotated mismatched descendant is revoked before B receives a new session.

`POST /api/v1/auth/google` remains a compatibility endpoint. It verifies the same identity but
always creates a new backend session; new browser bootstrap code should use `/auth/session`.

## Token and cookie model

### Access token

- Backend-signed HMAC JWT containing user/session identity and expiry.
- Default TTL: 15 minutes; configured range is 1 minute to 1 hour.
- Cookie: `access_token`, `HttpOnly`, `SameSite=Strict`, path `/`.
- `Secure` is mandatory in production and may be disabled only for development HTTP.

### Refresh token

- Opaque random token; only its hash is stored in PostgreSQL.
- Default TTL: 720 hours; it must exceed the access TTL and cannot exceed 2160 hours.
- Cookie: `refresh_token`, `HttpOnly`, `SameSite=Strict`, path `/api/v1/auth`.
- `POST /api/v1/auth/refresh` atomically revokes the old row and creates one descendant.
- Reuse of an already-rotated token is treated as theft/concurrent replay and revokes the active
  session family. The losing request returns `401` and cookies are cleared.

### Logout and revoke all

- `POST /api/v1/auth/logout` revokes the current session.
- `DELETE /api/v1/auth/sessions` revokes all active sessions for the user.
- Both clear access, refresh, and browser trade-unlock cookies.

Ordinary protected reads validate the access JWT. Sensitive execution routes also query the
server-side session row so logout/revoke-all takes effect immediately instead of waiting for JWT
expiry.

## Origin, CORS, and proxy policy

`CORS_ALLOWED_ORIGINS` is an exact list of normalized HTTP/HTTPS origins. Wildcards, credentials,
paths, queries, and fragments are invalid.

The Origin middleware is CSRF protection, not merely response CORS:

- safe non-WebSocket methods may omit `Origin`;
- unsafe requests and WebSocket upgrades with an Origin require an exact allowed origin;
- an unsafe request with browser cookies but no Origin returns `403 origin required`;
- a non-browser worker request with no cookies and no Origin may continue to its own service-auth
  boundary.

All responses receive `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`,
`X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, and a restrictive Permissions Policy.

Authentication endpoints are limited to 120 attempts per five minutes per client IP. The direct
peer address is authoritative except when it is loopback; only then may the limiter use
Cloudflare's overwritten `CF-Connecting-IP` header. Do not place the API behind an untrusted proxy
that can reach it while spoofing that boundary.

## Optional trade-password protection

The trade password is independent of Firebase and broker credentials. It protects sensitive live
execution operations after login.

- Configuration: `GET|PUT /api/v1/execution/trade-security`.
- Authorization: `POST /api/v1/execution/authorizations`.
- Explicit lock: `DELETE /api/v1/execution/trade-security/unlock`.
- Recovery request/confirm: `/api/v1/execution/trade-security/recovery` and
  `/api/v1/execution/trade-security/recovery/confirm`.

Passwords are 8-128 characters, rejected when commonly used, and stored as Argon2id hashes.
Enabling/disabling or changing protection requires a fresh Firebase identity token plus the
current password when one exists. Recovery requires the verified account email and configured
SMTP.

Successful verification can set an HttpOnly, SameSite=Strict trade-unlock cookie scoped to the
execution API (`__Host-trade_unlock` with path `/` under HTTPS). The server still issues a
single-use authorization capability for each operation. That capability is:

- short-lived (`TRADE_AUTHORIZATION_TTL`, default 45 seconds, allowed 10 seconds to 2 minutes);
- bound to user, backend session, operation, and canonical payload digest;
- consumed atomically by the corresponding Go execution handler;
- never accepted by Rust as a browser identity or by an unrelated operation.

Repeated password failures are rate-limited and temporarily locked. Recovery codes are hashed,
expiring, attempt-limited, and single-use.

## Service and internal authentication

Browser sessions do not authorize internal services:

- Push/evaluator routes use an independent `PUSH_WORKER_SECRET` and signed user/device contracts.
- Go-to-Rust admin calls use `EXECUTION_ADMIN_TOKEN`; both admin URL and listener are loopback-only.
- Common EA sessions use pairing/session tokens bound to the exact MT5 account identity.
- Managed worker enrollment uses `EXECUTION_MT5_VM_BOOTSTRAP_TOKEN`; established worker sessions are
  hashed, generation-fenced, replay-protected, and lease-bound.
- One-time credential grants are bound to worker, session generation, account, lease generation,
  and lifecycle command.

Never reuse one secret for another boundary.

## Required configuration

Authentication is assembled only when PostgreSQL and all Firebase values are present. When auth is
configured, `AUTH_JWT_SECRET` must contain at least 32 characters.

```dotenv
DATABASE_URL=postgres://...
AUTH_JWT_SECRET=<independent random secret, 32+ characters>
AUTH_ACCESS_TTL=15m
AUTH_REFRESH_TTL=720h
AUTH_COOKIE_SECURE=true
FIREBASE_PROJECT_ID=<project id>
FIREBASE_CLIENT_EMAIL=<service account email>
FIREBASE_PRIVATE_KEY=<escaped PEM value>
CORS_ALLOWED_ORIGINS=https://app.example.com
```

Production additionally requires the service secrets and SMTP values validated by
[CONFIGURATION.md](CONFIGURATION.md). Keep local secrets in ignored environment files or
ACL-protected secret files; never commit them.

## Security invariants

- No backend token in `localStorage` or JavaScript-readable cookies.
- No refresh token plaintext in PostgreSQL.
- No cross-user cookie reuse during Firebase account switching.
- No second descendant from refresh-token replay.
- No unsafe cookie mutation without an allowed Origin.
- No live execution from an inactive session.
- No trade password, broker password, admin token, worker token, or authorization capability in
  logs or browser responses.
- No public exposure of Rust admin or managed-worker routes.

See [TRADE_PASSWORD_AUTHORIZATION.md](../../docs/TRADE_PASSWORD_AUTHORIZATION.md) and
[TRADE_PRODUCTION_SECURITY_RUNBOOK.md](../../docs/TRADE_PRODUCTION_SECURITY_RUNBOOK.md) for the
detailed live-trading threat model and production gates.
