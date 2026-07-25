# Authentication — Google Sign-in / Sign-up

> Status: **Implemented and maintained**. Covers the only auth method the product needs
> right now: **login/register with a Google account**. Register and login are the *same* flow —
> first Google sign-in auto-creates the account, subsequent sign-ins reuse it. There is no password,
> email/password form, or separate registration screen.

Related: `DATABASE.md` (`users`, `auth_identities`, `sessions`), `API.md` (endpoint contracts).

---

## 1. Why Firebase Auth + a backend session

Firebase is **already a dependency** in the frontend (`firebase`, `firebase-admin`) and configured
for push (`src/services/firebase/client.ts`, `src/server/firebaseAdmin.ts`). Reusing it for Google
sign-in means:

- No OAuth redirect/callback plumbing to build — Firebase runs the Google consent popup and returns
  a signed **ID token (JWT)**.
- The Go backend only has to **verify** that ID token and mint its own session. It stays the source
  of truth for users and sessions (per `DATABASE.md`), while Firebase is just the identity provider.

```
Frontend (Firebase Auth, Google popup)  ──ID token──►  Go Fiber API  ──►  PostgreSQL
        identity provider                              session owner       source of truth
```

### Alternative considered (not chosen)

Direct Google OAuth 2.0 in Go (`golang.org/x/oauth2/google`) — fully backend-owned, no Firebase.
Rejected for now because it duplicates the OAuth flow Firebase already handles and adds redirect URI
management. The `auth_identities` table is provider-agnostic, so we can add this later without a
schema change.

---

## 2. End-to-end flow

```
┌──────────┐   1. click "Sign in with Google"     ┌─────────────────────┐
│ Browser  │─────────────────────────────────────►│ Firebase Auth (SDK) │
│ (Next.js)│   2. Google account popup / consent   │  GoogleAuthProvider │
│          │◄─────────────────────────────────────│  signInWithPopup    │
│          │   3. Firebase user + ID token (JWT)   └─────────────────────┘
│          │
│          │   4. POST /api/v1/auth/session { idToken }
│          │─────────────────────────────────────► ┌─────────────────────┐
│          │                                        │  Go Fiber API       │
│          │                                        │  5. verify ID token │
│          │                                        │     (Firebase Admin │
│          │                                        │      / JWKS)        │
│          │                                        │  6. upsert user +   │
│          │                                        │     auth_identity   │
│          │                                        │  7. create session, │
│          │                                        │     mint JWTs       │
│          │   8. optional Set-Cookie on create/rotate └─────────────────────┘
│          │◄─────────────────────────────────────  { user }
│          │
│          │   9. subsequent API calls send the httpOnly access cookie
└──────────┘
```

1–3. Frontend uses the Firebase Web SDK `GoogleAuthProvider` + `signInWithPopup` (fallback
   `signInWithRedirect` on mobile) and reads `await user.getIdToken()`.
4. Frontend POSTs the Firebase **ID token** to the backend. Nothing else — no profile is trusted
   from the client; the backend derives identity from the verified token only.
5. Backend verifies the ID token signature, `aud` (Firebase project id), `iss`, expiry, revocation,
   and Firebase disabled-user state with an eight-second upstream deadline.
6. Backend **upserts**: find `auth_identities` by `(provider='google', provider_uid=sub)`. If found →
   existing user (login). If not → create `users` row + `auth_identities` row (register). Email,
   name, picture come from the verified token claims.
7. Backend resolves the matching backend session in one operation: reuse a valid access cookie for
   the same user, atomically rotate a matching refresh cookie, or create a new session.
8. New/rotated tokens are returned as **HttpOnly, Secure, SameSite=Strict cookies**. When the
   access cookie is reused, the response does not rewrite cookies. The body always carries the
   public user object for the UI.
9. Every authenticated request carries the access cookie; middleware validates it.

---

## 3. Token model

| Token         | Type            | Lifetime | Storage                         | Purpose                          |
| ------------- | --------------- | -------- | ------------------------------- | -------------------------------- |
| Firebase ID   | Firebase JWT    | ~1 h     | never stored server-side        | one-time proof of Google identity|
| Access token  | Backend JWT     | 15 min   | httpOnly cookie `access_token`  | authorize API calls              |
| Refresh token | opaque random   | 30 days  | httpOnly cookie `refresh_token`; **SHA-256 hash** in `sessions` | rotate access token |

- **Access JWT** is stateless, signed with `AUTH_JWT_SECRET` (HS256) — required claims include
  `iss=tradingterminal-api`, `aud=tradingterminal-web`, `sub` (user id), `sid` (session id),
  `iat`, and `exp`. Tokens longer than 8 KiB are rejected before parsing. Access JWTs are never
  stored in DB.
- **Refresh token** is a 256-bit random string. Only its SHA-256 hash is stored
  (`sessions.refresh_token_hash`), so a database leak cannot directly replay it. Rotation locks,
  revokes, and inserts the replacement in one PostgreSQL statement. Concurrent use therefore
  produces at most one descendant; reuse of a revoked token is treated as theft and revokes all
  active sessions for that user.
- Cookies: `HttpOnly; Secure; SameSite=Strict; Path=/`. `Secure` is relaxed to off only when
  `APP_ENV=development` over local HTTP. The refresh cookie has the narrower
  `Path=/api/v1/auth`. Production refuses to start if `AUTH_COOKIE_SECURE=false`.

---

## 4. API endpoints

Full request/response shapes in `API.md` §Auth. Summary:

| Method | Path                     | Auth      | Purpose                                            |
| ------ | ------------------------ | --------- | -------------------------------------------------- |
| POST   | `/api/v1/auth/session`   | Firebase  | Preferred browser bootstrap: reuse, rotate, or create the matching session |
| POST   | `/api/v1/auth/google`    | Firebase  | Compatibility login/register endpoint; always creates a session |
| POST   | `/api/v1/auth/refresh`   | refresh   | Rotate refresh token, issue new access token       |
| POST   | `/api/v1/auth/logout`    | access    | Revoke current session, clear cookies              |
| GET    | `/api/v1/auth/me`        | access    | Return the current user                            |
| DELETE | `/api/v1/auth/sessions`  | access    | Revoke all sessions (sign out everywhere)          |

---

## 5. Backend verification

Go package `firebase.google.com/go/v4/auth` verifies ID tokens against Google's rotating public keys
with the project's service-account credentials (`FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`,
`FIREBASE_PRIVATE_KEY`). The auth service then requires all of the following before resolving a
backend user:

- Firebase `sign_in_provider` is exactly `google.com`;
- `firebase.identities["google.com"]` contains a stable provider subject;
- `email` is present and `email_verified` is `true`;
- the trimmed ID token is no larger than 16 KiB.

The client-supplied profile, email, or UID is never trusted. Disabled/deleted backend users are
excluded from login, `/auth/me`, profile update, and refresh lookup.

```go
// internal/auth/verify.go (sketch)
client, _ := firebaseApp.Auth(ctx)
tok, err := client.VerifyIDTokenAndCheckRevoked(ctx, idToken)
// checks signature, audience, issuer, expiry, revocation, and disabled-user state
if err != nil { return unauthorized }
uid   := tok.UID                     // -> auth_identities.provider_uid / firebase_uid
email := tok.Claims["email"].(string)
name  := tok.Claims["name"]
pic   := tok.Claims["picture"]
```

If pulling the Firebase Admin SDK into Go is undesirable, the fallback is manual JWKS verification:
fetch `https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com`,
validate `RS256`, `aud == projectId`, `iss == https://securetoken.google.com/<projectId>`, `exp`.
The Admin SDK is preferred because it handles signing-key rotation and the session exchange checks
Firebase revocation/disabled state. That check requires an upstream RPC and is capped at eight
seconds: invalid/revoked identities return `401`; transient Firebase network, quota, or 5xx failures
return retryable `503`. Durable access is still owned and revoked by the PostgreSQL backend session.

---

## 6. Implemented backend package layout

```
internal/
  auth/
    handler.go     # POST /session, /google, /refresh, /logout, GET /me — Fiber handlers
    service.go     # upsert user, create/rotate session (no HTTP concerns)
    verify.go      # Firebase ID-token verification
    jwt.go         # mint/parse access JWTs
    cookies.go     # set/clear httpOnly cookies
    middleware.go  # RequireAuth — validates access cookie, injects user id into ctx
  users/
    repo.go        # sqlc-backed user + identity queries
```

`RequireAuth` middleware validates the access cookie and stores `user_id` in the Fiber context
`Locals`; every protected route group in `API.md` sits behind it.

---

## 7. Frontend surface

Implemented pieces:

```
src/services/auth/
  firebaseAuth.ts     # GoogleAuthProvider, signInWithPopup, getIdToken, signOut
  authClient.ts       # POST /auth/session, /google, /refresh, /logout, GET /me
src/store/authStore.ts  # Jotai atoms: userAtom, authStatusAtom ('anonymous'|'authenticating'|'authed')
src/components/auth/
  SignInButton.tsx    # "Sign in with Google" button (lucide Google-mark / brand asset)
  UserMenu.tsx        # avatar + name + "Sign out" dropdown in TopToolbar
  AuthGate.tsx        # optional: gates sync features until signed in
```

- **UI placement:** a "Sign in with Google" button on the right of `TopToolbar` when anonymous;
  once signed in it becomes the avatar/`UserMenu`.
- **App stays usable anonymous** — auth unlocks cross-device sync (`DATABASE.md` §11), it does not
  gate the chart. On sign-in the local workspace uploads once.
- Access token lives only in the HttpOnly cookie; the frontend never reads it in JavaScript.
  API calls use `credentials: 'include'`. Initial Firebase bootstrap calls `/auth/session` exactly
  once, so a signed-in user does not produce expected `me -> refresh -> google` 401 probes.
  During a rolling deploy only, `/auth/session` `404`/`405` falls back once to the retained
  `/auth/google` endpoint; no validation, authorization, rate-limit, or 5xx response falls back.
  A later protected API `401` triggers `/auth/refresh`; if refresh fails while Firebase still has a
  user, the client retries `/auth/session` once and then retries the original request once.

---

## 8. Request security controls

- `/auth/session`, `/auth/google`, and `/auth/refresh` share a fixed-window limit of 120 requests
  per five minutes per client IP. Behind the loopback Cloudflare Tunnel, the limiter trusts
  `CF-Connecting-IP`; it never trusts that header from a non-loopback peer.
- Unsafe cookie-bearing requests (`POST`, `PUT`, `PATCH`, `DELETE`, and WebSocket upgrades) require
  an `Origin` in `CORS_ALLOWED_ORIGINS`. A missing `Origin` with cookies is rejected with `403`.
  Server-to-server requests without browser cookies may omit `Origin`.
- `SameSite=Strict` is safe for the current frontend/API split because
  `tradingterminal.io.vn` and `api.tradingterminal.io.vn` are the same site. If either hostname
  moves to a different registrable domain, redesign the session/CSRF boundary before loosening the
  cookie policy.
- The application limiter is defense-in-depth for one API process. Keep a distributed Cloudflare
  WAF/rate-limit rule in front of production auth endpoints.
- Firebase revocation is checked only when establishing/re-establishing a backend session, not on
  every protected resource call. Backend access JWTs remain bounded by the short access TTL.

---

## 9. Environment variables

Frontend (client, already partly present — add Auth-specific keys):

```
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=<project>.firebaseapp.com   # required for Auth (popup)
NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...
NEXT_PUBLIC_API_BASE_URL=http://localhost:8080
```

Backend (Go — reuse the existing service-account values):

```
FIREBASE_PROJECT_ID=...
FIREBASE_CLIENT_EMAIL=...
FIREBASE_PRIVATE_KEY=...           # \n-escaped, same as push
AUTH_JWT_SECRET=<32+ byte secret>  # signs backend access JWTs
AUTH_ACCESS_TTL=15m
AUTH_REFRESH_TTL=720h              # 30 days
DATABASE_URL=postgres://...
CORS_ALLOWED_ORIGINS=http://localhost:3000
APP_ENV=development                # toggles Secure cookie flag
```

Auth startup validation requires:

- `AUTH_JWT_SECRET` at least 32 characters whenever database + Firebase auth are configured;
- `AUTH_ACCESS_TTL` between `1m` and `1h`;
- `AUTH_REFRESH_TTL` longer than the access TTL and no more than `2160h` (90 days);
- exact absolute CORS origins, never `*`;
- secure cookies in production.

> In the Firebase console: **Authentication → Sign-in method → enable Google**, and add the app's
> domains (localhost + prod) to **Authorized domains**.

---

## 10. Security checklist

- [x] Verify ID token **server-side** every time — never trust client-sent email/uid.
- [x] Check Firebase token revocation/disabled state during backend session establishment.
- [x] Accept only verified Google identities with a stable Google provider subject.
- [x] HttpOnly + Secure + SameSite=Strict cookies; no backend token in localStorage.
- [x] Store only the SHA-256 **hash** of refresh tokens.
- [x] Atomic refresh-token rotation with reuse detection → revoke the user's sessions on reuse.
- [x] Rate-limit `/auth/session`, `/auth/google`, and `/auth/refresh` per client IP.
- [x] Strict CORS allow-list plus Origin enforcement for cookie-authenticated mutations.
- [x] Bound JWT algorithms, issuer, audience, token sizes, and access/refresh TTLs.
- [x] Refuse disabled/deleted backend users during login, lookup, update, and refresh.
- [ ] Log auth events (login, refresh, logout, reuse-detected) with zerolog.
