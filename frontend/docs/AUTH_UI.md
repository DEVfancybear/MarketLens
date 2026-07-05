# Auth UI (Google sign-in / sign-up)

> Status: **implemented** (frontend). Login/register with a Google account. Register and login are the
> same action — the first Google sign-in auto-creates the account. Backend contract:
> `../../backend/AUTH.md` / `API.md`.

## How it works

Firebase Auth is the client-side source of truth for the signed-in identity (it runs the Google
consent popup and creates the account). The Go backend session exchange is **best-effort**: the app
is fully usable whether or not the backend is running.

```
SignInButton ─click─► signInWithGoogle() ─► Firebase Google popup
                                               │ onAuthStateChanged
                                               ▼
                          useAuthSession() ─► authStore (user, status)
                                               │  best-effort
                                               ▼
                          exchangeGoogleToken(idToken) ─► POST /api/v1/auth/google
                                               │  (no-op until backend + NEXT_PUBLIC_API_BASE_URL exist)
                                               ▼
                                        backendSession = true
```

## Files

| File                                        | Role                                                        |
| ------------------------------------------- | ----------------------------------------------------------- |
| `src/services/firebase/client.ts`           | exports `getFirebaseApp()` + `getFirebaseAuthConfigStatus()`|
| `src/services/auth/firebaseAuth.ts`          | Google popup, sign-out, `subscribeAuth`, `currentIdToken`   |
| `src/services/auth/authClient.ts`            | best-effort backend calls (`/auth/google`, `/logout`, `/me`)|
| `src/store/authStore.ts`                     | Jotai atoms: `authUserAtom`, `authStatusAtom`, `authErrorAtom`, `backendSessionAtom` |
| `src/hooks/useAuthSession.ts`                | binds Firebase → store; mounted in `GlobalRuntime`          |
| `src/components/auth/AuthControl.tsx`        | switches SignInButton ↔ UserMenu                            |
| `src/components/auth/SignInButton.tsx`       | "Sign in with Google" button                                |
| `src/components/auth/UserMenu.tsx`           | avatar dropdown + Sign out                                  |
| `src/components/auth/GoogleIcon.tsx`         | Google "G" mark                                             |

Wiring: `AuthControl` sits in the right cluster of `TopToolbar`; `useAuthSession()` runs in
`GlobalRuntime`.

## Auth status state machine

`loading` → (Firebase reports) → `anonymous` | `authed`. Clicking sign-in → `authenticating` →
`authed` (popup success) or back to `anonymous` (popup closed/failed). `AuthControl` renders nothing
during `loading` (avoids a sign-in-button flash for already-signed-in users).

## Configuration

Requires the Firebase web config (client.ts reads these). Google sign-in additionally needs
`authDomain`:

```
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=<project>.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...
NEXT_PUBLIC_API_BASE_URL=http://localhost:8080   # optional — enables backend session exchange
```

In the Firebase console: **Authentication → Sign-in method → enable Google**, and add the app's
domains (localhost + prod) under **Authorized domains**. If the config is missing, the button stays
visible but clicking it logs a clear error instead of throwing.

## Not yet done

- Backend `/api/v1/auth/google` (see `BACKEND_IMPLEMENTATION_PLAN.md` Phases 0–4) — until it exists,
  `backendSession` stays `false` and the app runs on Firebase-only client auth.
- Gating cross-device sync on `backendSession` (future, `DATABASE.md` §11).
