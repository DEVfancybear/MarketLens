# NEXT TASKS

> Backend build order is fully specified in `backend/docs/BACKEND_IMPLEMENTATION_PLAN.md`
> (Phases 0–13). The summary below tracks the auth slice; follow the plan doc for step detail.

## Immediate (auth slice — priority order, maps to plan phases)

0. **Foundation (Phase 0)** — adopt Fiber (current code is stdlib `net/http`), extend config with DB
   + auth + Firebase + CORS vars, add `.env.example`, error-response helper. — *Low–Medium*
1. **DB layer (Phase 1)** — `pgxpool` + `DATABASE_URL`; `golang-migrate`; migrations
   `0001_extensions`, `0002_auth`; `sqlc` for user/identity/session. — *Medium*
2. **Firebase verify (Phase 2)** — `internal/auth/verify.go` using `firebase.google.com/go/v4`
   (reuse `FIREBASE_*` service-account env). — *Medium*
3. **Sessions + JWT (Phase 3)** — `internal/auth/{jwt,session,cookies}.go`: access JWT, rotating
   refresh with reuse detection, httpOnly cookies (`AUTH.md` §3). — *Medium*
4. **Auth endpoints (Phase 4)** — `POST /api/v1/auth/google`, `/refresh`, `/logout`, `GET /me`,
   `DELETE /sessions` + `RequireAuth` + CORS; register `/api/v1` group. — *Medium*
5. **Frontend auth** — `src/services/auth/firebaseAuth.ts` (GoogleAuthProvider popup),
   `authClient.ts`, `authStore.ts`, `SignInButton` + `UserMenu` in `TopToolbar`. — *Medium*

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
