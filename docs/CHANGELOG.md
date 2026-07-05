# CHANGELOG

## 2026-07-06 — Backend docs reconciled with the real frontend data model

**Feature:** Audited the frontend's actual persistence (localStorage keys, IndexedDB, `types/*`) and
rewrote the backend schema/plan/API to match exactly — so implementation needs no reverse-engineering.

**Key reconciliations:**
- **New table** `drawing_templates` (global `drawingTemplates` style presets — was missing).
- `user_settings` gains a `notifications` section (global `AlertSettings`) + `chart` (timeframe
  favorites); documented that `ui` only persists `{ theme, panels }`.
- `alerts` gains per-channel flags (sound/browser/push/telegram/discord) + `enabled`/`locked`/`note`/
  `trigger_price`; `alert_events` matches `AlertHistoryEntry`.
- `journal_entries` is now **trade-centric** (side/entry+exit price+time/pnl/rr/riskAmount), not
  title/rating; `screenshots` gains `phase`.
- Simulated trading collapsed to a single `sim_positions` table (embedded `fills jsonb`, `long/short`,
  `pending/open/closed/cancelled`) — dropped the separate `orders` table.
- `pine_scripts` → `source_code` + `favorite`; `indicator_presets` → `config` jsonb + `script_id` FK;
  added `client_id` sync-dedupe columns; documented two FK migration-ordering rules.

**Files:** `backend/docs/DATABASE.md` (rewritten, audited), `backend/docs/BACKEND_IMPLEMENTATION_PLAN.md`
(Phases 5/7/8/9/10/11/13 updated), `backend/docs/API.md` (bootstrap, drawing-templates, alerts,
journal, screenshots, sim bodies).

## 2026-07-06 — Detailed backend plan for Phases 6–13 (planning)

**Feature:** Expanded the per-feature persistence phases (6–13) from a summary table into full specs
matching the Phase 0–5 format (goal, tables, steps, endpoints, acceptance, complexity), plus a shared
six-step template and phase-order rationale.

**Files:**
- `backend/docs/BACKEND_IMPLEMENTATION_PLAN.md` — Phases 6 (watchlists), 7 (drawings), 8 (indicators),
  9 (pine scripts), 10 (alerts + push tokens), 11 (journal + screenshots / object storage),
  12 (layouts), 13 (simulated trading) written out in detail.

## 2026-07-06 — Frontend Google auth UI (implemented)

**Feature:** Login/register with a Google account on the frontend. Firebase Auth runs the Google
popup + account creation (works today, standalone); the Go backend session exchange is wired
best-effort (no-op until the backend ships). Verified: typecheck + lint + `next build` all pass.

**Files:**
- `frontend/src/services/firebase/client.ts` — export `getFirebaseApp()` + auth config status.
- `frontend/src/services/auth/firebaseAuth.ts` (new) — Google popup, sign-out, auth subscription.
- `frontend/src/services/auth/authClient.ts` (new) — best-effort backend `/auth/*` calls.
- `frontend/src/store/authStore.ts` (new) — Jotai auth atoms + compat hook.
- `frontend/src/hooks/useAuthSession.ts` (new) — Firebase → store bridge; mounted in `GlobalRuntime`.
- `frontend/src/components/auth/{AuthControl,SignInButton,UserMenu,GoogleIcon}.tsx` (new).
- `frontend/src/components/toolbar/TopToolbar.tsx`, `.../layout/GlobalRuntime.tsx` — wiring.
- `frontend/docs/AUTH_UI.md` (new) + `frontend/docs/README.md` index.

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
