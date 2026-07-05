# CURRENT PROGRESS

**Last updated:** 2026-07-06
**Current milestone:** Backend persistence + authentication
**Current phase:** Frontend auth UI **implemented**; backend auth not started

## Completed features

- Frontend trading terminal (charting, 25 drawing tools, SMC engine, replay, alerts, journal,
  analytics, Pine-like indicators) — data persisted client-side only.
- Backend Go Fiber skeleton with `GET /health` and structured logging.
- Python MT5 bridge sidecar (FTMO).
- Firebase already configured for push notifications (client + admin).

## Completed this session

- **Auth + database design docs** — `backend/docs/{DATABASE,AUTH,API,BACKEND_IMPLEMENTATION_PLAN}.md`.
- **Frontend Google auth UI (implemented + verified)** — Firebase Google sign-in/sign-up, auth store,
  session hook, sign-in button + user menu in `TopToolbar`. Typecheck + lint + `next build` all pass.
  Framework decision confirmed: backend will use **Fiber**.

## Recently modified files

- Frontend: `src/services/firebase/client.ts`, `src/services/auth/{firebaseAuth,authClient}.ts`,
  `src/store/authStore.ts`, `src/hooks/useAuthSession.ts`,
  `src/components/auth/{AuthControl,SignInButton,UserMenu,GoogleIcon}.tsx`,
  `src/components/toolbar/TopToolbar.tsx`, `src/components/layout/GlobalRuntime.tsx`,
  `frontend/docs/AUTH_UI.md`.
- Docs: `backend/docs/*`, `docs/*` (project memory).

## Not started

- Backend: Fiber migration + Postgres wiring + migrations + `internal/auth` + `internal/users`
  (see `backend/docs/BACKEND_IMPLEMENTATION_PLAN.md` Phases 0–4). Blocked only on a Postgres instance
  + Firebase Google provider enabled.
- Store-by-store migration to the backend API.
