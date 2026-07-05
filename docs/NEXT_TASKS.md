# NEXT TASKS

## Immediate (auth slice — priority order)

1. **DB wiring** — add `pgx` pool + `DATABASE_URL` config; add `golang-migrate`; write migrations
   `0001_extensions.sql`, `0002_auth.sql` (`DATABASE.md` §5, §12). — *Medium*
2. **Firebase token verification** — `internal/auth/verify.go` using `firebase.google.com/go/v4`
   (reuse `FIREBASE_*` service-account env). — *Medium*
3. **Session + JWT** — `internal/auth/{jwt,cookies,service}.go`: mint access JWT, create/rotate
   refresh session, httpOnly cookies (`AUTH.md` §3). — *Medium*
4. **Auth endpoints** — `POST /api/v1/auth/google`, `/refresh`, `/logout`, `GET /me` + `RequireAuth`
   middleware; register in `httpserver/server.go`. — *Medium*
5. **Frontend auth** — `src/services/auth/firebaseAuth.ts` (GoogleAuthProvider popup),
   `authClient.ts`, `authStore.ts`, `SignInButton` + `UserMenu` in `TopToolbar`. — *Medium*
6. **CORS + cookies** — allow-list origin, `credentials: true`, Secure toggle by `APP_ENV`. — *Low*

## Upcoming (persistence migration — after auth works)

- `GET /api/v1/sync/bootstrap` + client hydration/merge (`DATABASE.md` §11).
- Migrate stores one at a time: settings → watchlists → drawings → indicators → pine scripts →
  alerts → journal/screenshots → layouts → sim-trading (migrations `0003`–`0007`).
- Move FCM push-token registration into `push_tokens` (`DATABASE.md` §5.4).

## Blocked

- Nothing blocked. Requires a provisioned Postgres instance and Firebase console: enable Google
  provider + add authorized domains (`AUTH.md` §8).

## Priority order

Auth backend (1–4) → Auth frontend (5) → sync bootstrap → per-feature migration.
