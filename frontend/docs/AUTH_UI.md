# Auth UI (Google sign-in / sign-up)

> Status: **implemented**. The frontend signs in with Firebase Google Auth, then exchanges the
> Firebase ID token with the Go backend auth API for httpOnly session cookies.

## How It Works

Firebase Auth is the client-side identity provider. The Go backend owns the durable session used by
authenticated API calls.

```text
SignInButton
  -> signInWithGoogle()
  -> Firebase Google popup
  -> onAuthStateChanged
  -> useAuthSession()
  -> POST /api/v1/auth/session   (reuse, rotate, or create the matching session)
  -> authStore.backendSession = true
```

The `/auth/session` call receives `{ idToken }`, verifies that the Firebase identity and backend
cookies belong to the same user, sets cookies only when creation/rotation is needed, and returns
`{ user, isNewUser }`. This avoids the expected-but-noisy `me -> refresh -> google` 401 probes and
prevents a Firebase account switch from inheriting another user's backend workspace.

Expected startup Network sequence:

1. Firebase restores or signs in the Google user.
2. The UI sends exactly one `POST /api/v1/auth/session`.
3. After `200`, protected workspace/bootstrap requests begin.

Do not reintroduce a startup `GET /auth/me` probe. A missing backend cookie is normal before the
first exchange and would turn that probe into a misleading `401`. `/auth/google` remains a backend
compatibility endpoint. During a rolling deploy only, a `404`/`405` from `/auth/session` falls back
once to `/auth/google` so the frontend can run against an older backend. No other status may use
that fallback: `400`, `401`, `403`, `429`, and `5xx` are real validation/security/availability
decisions.

During normal API use, `src/services/api/client.ts` owns session recovery for every backend resource
wrapper (`getJson`, `postJson`, `putJson`, `patchJson`, `deleteJson`). When an authenticated call
returns `401`, the client first attempts `POST /api/v1/auth/refresh`; if refresh is unavailable but
Firebase still has a current user, it exchanges a fresh Firebase ID token through
`POST /api/v1/auth/session`, then retries the original request once. The auth endpoints themselves do
not trigger this recovery path, which avoids recursive login loops.

In local development the backend API defaults to `http://localhost:8080` when
`NEXT_PUBLIC_API_BASE_URL` is not set. Production deployments must set `NEXT_PUBLIC_API_BASE_URL`
explicitly. Anonymous mode still works when the backend is unavailable, but authenticated remote
workspace sync must require `backendSession === true`.

## Files

| File | Role |
| --- | --- |
| `src/services/firebase/client.ts` | Firebase app/config bootstrap |
| `src/services/auth/firebaseAuth.ts` | Google popup, Firebase sign-out, Firebase auth subscription |
| `src/services/auth/browserAuthPolicy.ts` | Rejects embedded app browsers before Google returns `disallowed_useragent` |
| `src/services/api/client.ts` | Shared `ky` backend client with `credentials: "include"` |
| `src/services/api/errors.ts` | `ApiError` and backend error-envelope helpers |
| `src/services/api/resources/authApi.ts` | Auth calls: `/auth/session`, `/auth/me`, `/auth/refresh`, `/auth/google`, `/auth/logout` |
| `src/services/auth/authClient.ts` | Compatibility re-export for auth resource calls |
| `src/store/authStore.ts` | Jotai atoms: user/status/error/backendSession |
| `src/hooks/useAuthSession.ts` | Firebase-to-backend session bridge mounted in `GlobalRuntime` |
| `src/components/auth/AuthControl.tsx` | Switches SignInButton/UserMenu |
| `src/components/auth/SignInButton.tsx` | "Sign in with Google" action |
| `src/components/auth/UserMenu.tsx` | Avatar dropdown + sign out |

## State Machine

`loading -> anonymous | authed`. Clicking sign-in moves to `authenticating` until Firebase resolves.
Backend session exchange happens after Firebase emits a user:

- backend configured and exchange succeeds: `backendSession = true`
- backend configured and exchange fails: `backendSession = false`, `authError` is set, UI identity
  remains Firebase-authed
- backend not configured: `backendSession = false`; the UI stays usable, but logout/anonymous
  transitions still reset user-scoped workspace state to defaults so a previous signed-in user's
  watchlists, drawings, indicators, alerts, and preferences are not displayed.

## Configuration

Frontend:

```env
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=<project>.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...
NEXT_PUBLIC_API_BASE_URL=http://localhost:8080
```

Because the app is now in `frontend/`, Next normally reads env files from `frontend/.env*`. The
frontend config also loads missing values from the repository root `.env.local` / `.env` as a
monorepo fallback, so existing root Firebase keys still work locally. Vercel/project env vars and
`frontend/.env.local` keep priority.

Backend:

- `DATABASE_URL` must point to a migrated Postgres database.
- Firebase Admin service-account env vars must be configured.
- `AUTH_JWT_SECRET` must contain at least 32 characters.
- CORS must include the exact frontend origin and allow credentials; never use `*`.
- Production cookies are `HttpOnly; Secure; SameSite=Strict`. The current frontend/API subdomains
  are same-site, so cross-origin credentialed requests still carry them.
- `/auth/session`, `/auth/google`, and `/auth/refresh` allow 120 requests per five minutes per
  client IP. A `429` is a real rate-limit response, not an instruction to loop faster.
- Keep `firebase-admin` pinned to `13.5.0` in the frontend. Firebase Admin 14.x
  upgrades `jwks-rsa` to an ESM-only `jose` path that can fail when Next
  externalizes `firebase-admin/auth` under the current Vercel/Node runtime;
  this presents as a generic 500 on authenticated push routes.

Firebase console:

- Enable Authentication -> Sign-in method -> Google.
- Add localhost and production domains under Authorized domains.

Browser popup headers:

- Google popup sign-in requires the app window to remain allowed to observe the popup lifecycle.
  `frontend/next.config.mjs` sets `Cross-Origin-Opener-Policy: same-origin-allow-popups` for all
  routes. Do not change this to `same-origin`; Chrome will warn that COOP blocks Firebase's
  `window.closed` check and popup sign-in can become unreliable.

### Mobile and in-app browsers

Google OAuth does not permit sign-in from embedded user agents such as the
built-in browsers in Zalo, Facebook, Messenger, Instagram, TikTok, or the
Google app. Google returns `403: disallowed_useragent` before Firebase can
complete sign-in; this is a provider policy and must not be bypassed with a
different OAuth URL.

`browserAuthPolicy.ts` detects common Android WebView and iOS embedded-browser
user agents before opening the Firebase popup. The UI tells the user to open
`https://tradingterminal.io.vn` from the app browser's top-right menu in Safari
or Chrome, then retry sign-in. Safari and Chrome on iOS remain allowed. Keep
this guard and its UI regression coverage synchronized when adding another
authentication entry point.

Production support checklist:

- Reproduce mobile sign-in in Safari or Chrome, not an in-app browser.
- Confirm `tradingterminal.io.vn` is listed under Firebase Authentication ->
  Settings -> Authorized domains.
- Treat `disallowed_useragent` as an embedded-browser problem; treat
  `auth/unauthorized-domain` as Firebase configuration instead.

### Notification permission blocked state

Chrome can permanently suppress the notification prompt for a site after the
user dismisses it repeatedly. In that state `Notification.requestPermission()`
returns `denied` and calling it again cannot reopen the prompt. The Alert Center
therefore labels Browser/Push as **blocked**, avoids repeated permission calls,
and directs the user to the tune/lock icon next to the address -> Site settings
-> Notifications -> Allow, followed by a page reload. This is a browser-level
setting and cannot be reset by frontend JavaScript.

### Authenticated push route 500s

Routes that verify Firebase ID tokens import `firebase-admin/auth` at runtime.
If `/api/push/alerts/status` (or another authenticated push route) starts
returning 500 after a dependency update, check the deployed Node runtime and
the resolved `firebase-admin` tree first. The supported frontend lockfile uses
`firebase-admin@13.5.0` with CommonJS-compatible `jwks-rsa@3`; run a clean
`npm ci` before reproducing a Vercel build. A failed Firebase token check is a
401, while an ESM module-load failure occurs before the handler can return its
normal response.

### Auth bootstrap troubleshooting

| Response | Meaning | Action |
| --- | --- | --- |
| `/auth/session` `200` | Backend session reused, rotated, or created | Continue; cookies may be unchanged on reuse |
| `/auth/session` `400` | Missing/malformed body or ID token larger than 16 KiB | Fix the client request; do not retry unchanged |
| `/auth/session` `401` | Invalid/expired token, non-Google provider, or unverified Google email | Refresh Firebase auth/sign in again; confirm both tiers use the same Firebase project |
| `/auth/session` `403` | Missing/disallowed `Origin` on a cookie-bearing mutation | Fix `CORS_ALLOWED_ORIGINS` and the deployed frontend hostname |
| `/auth/session` `404`/`405` | Older backend does not implement the endpoint | Frontend falls back once to `/auth/google`; deploy backend later to activate the hardened flow |
| `/auth/session` `429` | More than 120 auth attempts in five minutes for that client IP | Stop automatic retries and wait for the window |
| `/auth/session` `503` | Firebase revocation/disabled-user check timed out or its upstream API is unavailable | Retry with bounded backoff; do not clear valid local state as if credentials were rejected |
| Protected API still `401` after session `200` | Browser did not retain/send the access cookie | Check HTTPS, `credentials:"include"`, cookie domain/path, and same-site topology |

## Logout

`UserMenu` attempts `POST /api/v1/auth/logout` first, then always signs out Firebase. Backend logout
is best-effort so an expired backend cookie cannot trap the user in the signed-in UI.

When Firebase reports `anonymous` after an authenticated session, `useWorkspaceBootstrap()` resets
the screen to the default workspace and clears the previous user's local cache. A first
anonymous/offline load instead hydrates the local cache, so drawing preferences can survive a
reload without leaking an authenticated workspace. The sign-out reset covers watchlists, UI panel
preferences, SMC toggles, alert settings/history, push registration state, Trade panel runtime,
indicators/Pine scripts, drawings/templates, and drawing-tool favorites. Login performs the opposite path: once `backendSession` is true,
`GET /api/v1/sync/bootstrap` rehydrates the authenticated user's settings and watchlists, then loads
drawing templates and current-symbol drawings from the backend.
