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

Full phased build order: **`backend/docs/BACKEND_IMPLEMENTATION_PLAN.md`** (Phases 0–13).

1. Backend Phase 0: **adopt Fiber** (see gotcha below), extend config, `.env.example`, helpers.
2. Backend Phase 1: Postgres (pgxpool + sqlc + golang-migrate), migrations `0001`–`0002`.
3. Backend Phases 2–4: `internal/auth` (verify Firebase token, JWT, rotating session, cookies,
   `RequireAuth`) + `internal/users`. Ship `POST /api/v1/auth/google`, `/refresh`, `/logout`,
   `GET /me`, `DELETE /sessions`. **← this closes the Google login/register request.**
4. Backend Phase 5+: settings + `sync/bootstrap`, then migrate each store feature-by-feature.
5. Frontend: `src/services/auth/*`, `src/store/authStore.ts`, `SignInButton` + `UserMenu`.

## ⚠ Gotcha — Fiber vs stdlib

The docs (`ARCHITECTURE.md`, `PROJECT_STRUCTURE.md`) say the backend uses **Fiber**, but the actual
code at commit `64a33b0` uses the **Go 1.22 stdlib** (`net/http` + `http.ServeMux`); `go.mod` has no
Fiber. The implementation plan resolves this by adopting Fiber in Phase 0 (documented decision, ~60
lines to migrate). If the team prefers stdlib, only Phase 0 differs — everything else is
framework-agnostic. Confirm this choice before starting Phase 0.

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
