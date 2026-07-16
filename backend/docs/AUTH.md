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
│          │   4. POST /api/v1/auth/google { idToken }
│          │─────────────────────────────────────► ┌─────────────────────┐
│          │                                        │  Go Fiber API       │
│          │                                        │  5. verify ID token │
│          │                                        │     (Firebase Admin │
│          │                                        │      / JWKS)        │
│          │                                        │  6. upsert user +   │
│          │                                        │     auth_identity   │
│          │                                        │  7. create session, │
│          │                                        │     mint JWTs       │
│          │   8. Set-Cookie: access + refresh      └─────────────────────┘
│          │◄─────────────────────────────────────  { user }
│          │
│          │   9. subsequent API calls send the httpOnly access cookie
└──────────┘
```

1–3. Frontend uses the Firebase Web SDK `GoogleAuthProvider` + `signInWithPopup` (fallback
   `signInWithRedirect` on mobile) and reads `await user.getIdToken()`.
4. Frontend POSTs the Firebase **ID token** to the backend. Nothing else — no profile is trusted
   from the client; the backend derives identity from the verified token only.
5. Backend verifies the ID token signature, `aud` (Firebase project id), `iss`, and expiry.
6. Backend **upserts**: find `auth_identities` by `(provider='google', provider_uid=sub)`. If found →
   existing user (login). If not → create `users` row + `auth_identities` row (register). Email,
   name, picture come from the verified token claims.
7. Backend creates a `sessions` row and mints an **access JWT** + **refresh token**.
8. Tokens are returned as **httpOnly, Secure, SameSite=Lax cookies**. The response body carries the
   public user object for the UI.
9. Every authenticated request carries the access cookie; middleware validates it.

---

## 3. Token model

| Token         | Type            | Lifetime | Storage                         | Purpose                          |
| ------------- | --------------- | -------- | ------------------------------- | -------------------------------- |
| Firebase ID   | Firebase JWT    | ~1 h     | never stored server-side        | one-time proof of Google identity|
| Access token  | Backend JWT     | 15 min   | httpOnly cookie `access_token`  | authorize API calls              |
| Refresh token | opaque random   | 30 days  | httpOnly cookie `refresh_token`; **SHA-256 hash** in `sessions` | rotate access token |

- **Access JWT** is stateless, signed with `AUTH_JWT_SECRET` (HS256) — claims: `sub` (user id),
  `sid` (session id), `iat`, `exp`. Never stored in DB.
- **Refresh token** is a 256-bit random string. Only its SHA-256 hash is stored
  (`sessions.refresh_token_hash`), so a DB leak can't be replayed. Rotated on every refresh
  (old row `revoked_at` set, new row inserted) — reuse of a revoked token = session theft → revoke
  all of the user's sessions.
- Cookies: `HttpOnly; Secure; SameSite=Lax; Path=/`. `Secure` is relaxed to off only when
  `APP_ENV=development` over http://localhost.

---

## 4. API endpoints

Full request/response shapes in `API.md` §Auth. Summary:

| Method | Path                     | Auth      | Purpose                                            |
| ------ | ------------------------ | --------- | -------------------------------------------------- |
| POST   | `/api/v1/auth/google`    | none      | Verify Firebase ID token → login **or** register   |
| POST   | `/api/v1/auth/refresh`   | refresh   | Rotate refresh token, issue new access token       |
| POST   | `/api/v1/auth/logout`    | access    | Revoke current session, clear cookies              |
| GET    | `/api/v1/auth/me`        | access    | Return the current user                            |
| DELETE | `/api/v1/auth/sessions`  | access    | Revoke all sessions (sign out everywhere)          |

---

## 5. Backend verification

Go package `firebase.google.com/go/v4/auth` verifies ID tokens against Google's rotating public keys
with the project's service-account credentials (the same ones already used for push in
`firebaseAdmin.ts` — `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`).

```go
// internal/auth/verify.go (sketch)
client, _ := firebaseApp.Auth(ctx)
tok, err := client.VerifyIDToken(ctx, idToken)   // checks sig, aud, iss, exp, revocation
if err != nil { return unauthorized }
uid   := tok.UID                     // -> auth_identities.provider_uid / firebase_uid
email := tok.Claims["email"].(string)
name  := tok.Claims["name"]
pic   := tok.Claims["picture"]
```

If pulling the Firebase Admin SDK into Go is undesirable, the fallback is manual JWKS verification:
fetch `https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com`,
validate `RS256`, `aud == projectId`, `iss == https://securetoken.google.com/<projectId>`, `exp`.
The Admin SDK is preferred — it also handles key rotation and token revocation checks.

---

## 6. Implemented backend package layout

```
internal/
  auth/
    handler.go     # POST /google, /refresh, /logout, GET /me — Fiber handlers
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
  authClient.ts       # POST /auth/google, /refresh, /logout, GET /me (credentials: 'include')
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
- Access token lives only in the httpOnly cookie; the frontend never reads it in JS (XSS-safe).
  React Query calls use `credentials: 'include'`. A `401` triggers a silent `/auth/refresh`; if that
  also fails, drop to anonymous.

---

## 8. Environment variables

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

> In the Firebase console: **Authentication → Sign-in method → enable Google**, and add the app's
> domains (localhost + prod) to **Authorized domains**.

---

## 9. Security checklist

- [x] Verify ID token **server-side** every time — never trust client-sent email/uid.
- [x] httpOnly + Secure + SameSite=Lax cookies; no tokens in localStorage.
- [x] Refresh-token rotation with reuse detection → revoke session family on reuse.
- [ ] Store only the SHA-256 **hash** of refresh tokens.
- [ ] Rate-limit `/auth/google` and `/auth/refresh` (per-IP) to blunt token-stuffing.
- [ ] Strict CORS allow-list (`CORS_ALLOWED_ORIGINS`), `credentials: true`.
- [ ] CSRF: SameSite=Lax covers top-level nav; for defense-in-depth add a double-submit CSRF token on
      state-changing requests if cookies are ever loosened to `SameSite=None`.
- [ ] Short access-token TTL (15 min) bounds stolen-token lifetime.
- [ ] Log auth events (login, refresh, logout, reuse-detected) with zerolog.
