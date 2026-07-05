# CURRENT PROGRESS

**Last updated:** 2026-07-06
**Current milestone:** Backend persistence + authentication
**Current phase:** Design / planning (auth + database)

## Completed features

- Frontend trading terminal (charting, 25 drawing tools, SMC engine, replay, alerts, journal,
  analytics, Pine-like indicators) — data persisted client-side only.
- Backend Go Fiber skeleton with `GET /health` and structured logging.
- Python MT5 bridge sidecar (FTMO).
- Firebase already configured for push notifications (client + admin).

## In progress

- **Auth + database design** (this session) — design docs authored, implementation not started:
  - `backend/docs/DATABASE.md` — PostgreSQL schema for all user data.
  - `backend/docs/AUTH.md` — Google sign-in/sign-up via Firebase → backend session.
  - `backend/docs/API.md` — per-feature `/api/v1` contract.

## Recently modified files

- `backend/docs/DATABASE.md` (new)
- `backend/docs/AUTH.md` (new)
- `backend/docs/API.md` (expanded)
- `backend/docs/README.md` (index updated)
- `docs/HANDOFF.md`, `docs/CURRENT_PROGRESS.md`, `docs/NEXT_TASKS.md`, `docs/CHANGELOG.md` (project
  memory)

## Not started

- Backend Postgres wiring, migrations, `internal/auth` + `internal/users`.
- Frontend auth UI (Google sign-in button, user menu) and auth store.
- Store-by-store migration to the backend API.
