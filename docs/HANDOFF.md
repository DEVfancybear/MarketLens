# HANDOFF

> The most important file. Assume another agent continues from here.

## Current project state

Monorepo: `frontend/` (Next.js 16 / React 19 / Jotai trading terminal) + `backend/` (Go Fiber API +
Python MT5 bridge sidecar). The frontend is feature-rich (charting, drawings, SMC, replay, alerts,
journal, analytics) and stores **all** user data client-side (localStorage + IndexedDB). The backend
is currently minimal: a Go Fiber server exposing only `GET /health`. **There is no auth and no
database yet.**

## Active work: Auth + persistence design

The user requested **login/register via Google account only**, plus a **database + per-feature API
design**. This session delivered the **design/planning docs** (no code yet):

- `backend/docs/DATABASE.md` — full PostgreSQL schema mapping every client-side store to durable
  tables (users/auth/sessions, settings, watchlists, drawings, indicators, pine scripts, alerts,
  journal, screenshots, sim-trading, layouts, push tokens) + a client-cache↔server sync strategy.
- `backend/docs/AUTH.md` — Google sign-in via **Firebase Auth** (already a dependency) → Go backend
  verifies the Firebase ID token → mints its own JWT access + rotating refresh session. Register and
  login are the same flow.
- `backend/docs/API.md` — expanded from health-only into the full `/api/v1` per-feature contract.

## Completed work (this session)

- Read frontend + backend architecture docs.
- Confirmed Firebase is already wired for messaging/push (`src/services/firebase/client.ts`,
  `src/server/firebaseAdmin.ts`) — auth reuses the same project + service account.
- Authored the three design docs above; indexed them in `backend/docs/README.md`.

## Pending work (implementation, not started)

1. Backend: add Postgres (pgx + sqlc + golang-migrate), write migrations `0001`–`0008`
   (see `DATABASE.md` §12).
2. Backend: `internal/auth` (verify Firebase token, JWT, cookies, `RequireAuth` middleware) +
   `internal/users`. Wire `POST /api/v1/auth/google`, `/refresh`, `/logout`, `GET /me`.
3. Frontend: `src/services/auth/*`, `src/store/authStore.ts`, `SignInButton` + `UserMenu` in
   `TopToolbar`.
4. Then migrate stores feature-by-feature behind `/api/v1/sync/bootstrap`.

## Known decisions

- **Firebase Auth as identity provider, Go backend as session owner** (not direct Google OAuth in
  Go, not Firebase-only). Rationale in `AUTH.md` §1.
- **PostgreSQL** as the durable source of truth; browser stores demoted to write-through cache.
- **Google only** for now; `auth_identities` is provider-agnostic for future providers.

## Important files

- Design docs: `backend/docs/{DATABASE,AUTH,API}.md`
- Existing Firebase: `frontend/src/services/firebase/client.ts`, `frontend/src/server/firebaseAdmin.ts`
- Backend entry: `backend/cmd/api/main.go`, `backend/internal/httpserver/server.go`

## Current branch / last commit

- Branch: `master`
- Last commit before this session: `a33206a fix: clean up backend bridge relocation`

## Recommended next action

Implement the backend auth slice first: Postgres wiring + migrations `0001`–`0002` + `internal/auth`
`POST /api/v1/auth/google`. Everything else can follow feature-by-feature.
