# CHANGELOG

## 2026-07-06 — Auth + database design (planning)

**Feature:** Designed Google-account login/register and the backend persistence layer for all
user-owned data. Design/planning only — no runtime code changed.

**Files:**
- `backend/docs/DATABASE.md` (new) — PostgreSQL schema: users/auth/sessions, settings, watchlists,
  drawings, indicators, pine scripts, alerts, journal, screenshots, sim-trading, layouts, push
  tokens; ERD, migration order, client-cache↔server sync strategy.
- `backend/docs/AUTH.md` (new) — Google sign-in via Firebase Auth → Go backend verifies ID token →
  JWT access + rotating refresh session; endpoints, token model, env, security checklist.
- `backend/docs/API.md` (expanded) — full `/api/v1` per-feature contract (auth, sync bootstrap,
  settings, watchlists, drawings, indicators, pine scripts, alerts, journal, screenshots, layouts,
  sim-trading).
- `backend/docs/README.md` — indexed the new docs.
- `docs/HANDOFF.md`, `docs/CURRENT_PROGRESS.md`, `docs/NEXT_TASKS.md`, `docs/CHANGELOG.md` (new) —
  project memory established per the repo's CLAUDE.md rules.
