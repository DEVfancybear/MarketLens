# CHANGELOG

## 2026-07-06 — Backend implementation plan (planning)

**Feature:** Phased, step-by-step build order for the Go backend, from Google auth to per-feature
persistence. Planning only — no runtime code changed.

**Files:**
- `backend/docs/BACKEND_IMPLEMENTATION_PLAN.md` (new) — Phases 0–13 with goals, files, steps,
  acceptance criteria, testing strategy, package layout; flags the Fiber-vs-stdlib discrepancy
  (current code is stdlib `net/http`, not Fiber) and resolves it in Phase 0.
- `backend/docs/README.md` — indexed the plan.
- `docs/HANDOFF.md`, `docs/NEXT_TASKS.md` — mapped tasks to the plan phases; documented the
  Fiber gotcha.

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
