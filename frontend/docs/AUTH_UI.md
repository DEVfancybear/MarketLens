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
  -> GET  /api/v1/auth/me        (reuse existing backend cookie when valid)
  -> POST /api/v1/auth/refresh   (rotate cookies if access expired)
  -> POST /api/v1/auth/google    (login/register with Firebase ID token)
  -> authStore.backendSession = true
```

The `/auth/google` call receives `{ idToken }`, sets backend `access_token` and `refresh_token`
httpOnly cookies, and returns `{ user, isNewUser }`.

During normal API use, `src/services/api/client.ts` owns session recovery for every backend resource
wrapper (`getJson`, `postJson`, `putJson`, `patchJson`, `deleteJson`). When an authenticated call
returns `401`, the client first attempts `POST /api/v1/auth/refresh`; if refresh is unavailable but
Firebase still has a current user, it exchanges a fresh Firebase ID token through
`POST /api/v1/auth/google`, then retries the original request once. The auth endpoints themselves do
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
| `src/services/api/client.ts` | Shared `ky` backend client with `credentials: "include"` |
| `src/services/api/errors.ts` | `ApiError` and backend error-envelope helpers |
| `src/services/api/resources/authApi.ts` | Auth resource calls: `/auth/me`, `/auth/refresh`, `/auth/google`, `/auth/logout` |
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
- CORS must include the frontend origin and allow credentials.

Firebase console:

- Enable Authentication -> Sign-in method -> Google.
- Add localhost and production domains under Authorized domains.

Browser popup headers:

- Google popup sign-in requires the app window to remain allowed to observe the popup lifecycle.
  `frontend/next.config.mjs` sets `Cross-Origin-Opener-Policy: same-origin-allow-popups` for all
  routes. Do not change this to `same-origin`; Chrome will warn that COOP blocks Firebase's
  `window.closed` check and popup sign-in can become unreliable.

## Logout

`UserMenu` attempts `POST /api/v1/auth/logout` first, then always signs out Firebase. Backend logout
is best-effort so an expired backend cookie cannot trap the user in the signed-in UI.

When Firebase reports `anonymous`, `useWorkspaceBootstrap()` resets the screen to the default
workspace. The reset covers watchlists, UI panel preferences, SMC toggles, alert settings/history,
push registration state, Trade panel runtime, indicators/Pine scripts, drawings/templates, and
drawing-tool favorites. Login performs the opposite path: once `backendSession` is true,
`GET /api/v1/sync/bootstrap` rehydrates the authenticated user's settings and watchlists, then loads
drawing templates and current-symbol drawings from the backend.
