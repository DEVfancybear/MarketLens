# Project Structure

> Trade execution update (2026-07-26): current paths are
> `backend/execution`, `backend/internal/execution`, and
> `backend/bridge/mt5_ea`. Legacy verifier/Connector paths mentioned below have
> been deleted.

This repository is organized as a monorepo. The frontend and backend are independent packages with
separate runtimes, dependencies, docs, and deployment paths.

## Top-Level Layout

```text
.
|-- frontend/          # Next.js trading terminal UI
|-- backend/           # Go API + MT5 sidecars and credential verifier
|-- docs/              # Root monorepo docs
|-- .env.example       # Shared example env file
`-- README.md          # Project entrypoint
```

## Frontend Ownership

`frontend/` owns the browser trading application.

```text
frontend/
|-- src/               # App code, components, stores, services, hooks, types
|-- public/            # Static assets
|-- tests/             # Frontend test suites
|-- scripts/           # Frontend validation and utility scripts
|-- docs/              # Frontend architecture and feature docs
`-- package.json       # Frontend dependencies and scripts
```

Frontend docs should cover chart behavior, drawing tools, Pine runtime, indicator settings, replay,
trade simulator UI, responsive layout, and frontend test conventions.

## Backend Ownership

`backend/` owns the Go API service, both Python MT5 sidecars, and the short-lived credential
verifier.

```text
backend/
|-- cmd/api/           # API entrypoint
|-- internal/          # Private backend packages
|   |-- config/        # Environment configuration
|   |-- httpserver/    # HTTP app and server lifecycle
|   |-- health/        # Health endpoint
|   |-- settings/      # Per-user settings/integrations and Verify endpoint
|   |-- mt5verify/     # Bounded stdin-only verifier process adapter
|   `-- middleware/    # Shared HTTP middleware
|-- bridge/            # Python MT5 helpers and WebSocket sidecars
|   |-- ftmo_mt5/      # FTMO execution bridge (:8787) + verify_account.py
|   `-- mt5_stream/    # Market-data bridge (:8765)
|-- docs/              # Backend architecture, API, and configuration docs
|-- go.mod
`-- README.md
```

Backend framework decision: **Fiber**. The current backend is already on Fiber, with health,
readiness, CORS, Phase 4 auth routes, Phase 5 settings/bootstrap routes, and Phase 6 watchlist
routes mounted under
`/api/v1`. New backend endpoints and middleware should continue using Fiber handlers, route groups,
and middleware. The next backend persistence task is Phase 7: drawings and drawing templates.

The market-data (`:8765`) and execution (`:8787`) Python bridges are **sidecar services**: they run
as separate processes and communicate over WebSockets. The verifier is different: the authenticated
Go endpoint launches `verify_account.py` for one bounded request, sends credentials over stdin, and
stores the resulting verification timestamp only for that user.

## Root Docs Ownership

`docs/` is intentionally small. It should only contain cross-project documentation:

- repository structure
- package boundaries
- shared operations
- deployment boundaries
- handoff notes that involve both frontend and backend

If a document only affects one package, move it into that package's `docs/` folder.

## Deployment Boundaries

- Frontend deployment root: `frontend`
- Backend deployment root: `backend`
- Frontend and backend should be deployed independently.
- Vercel should not build from the repository root after the monorepo split.

## Contribution Rules

- Do not add frontend source code at the repository root.
- Do not add backend source code under `frontend/`.
- Keep package-specific dependencies inside the owning package.
- Update root docs when changing folder ownership, deployment roots, or shared commands.
- Update package docs when changing runtime behavior inside a package.
