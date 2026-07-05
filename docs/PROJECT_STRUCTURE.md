# Project Structure

This repository is organized as a monorepo. The frontend and backend are independent packages with
separate runtimes, dependencies, docs, and deployment paths.

## Top-Level Layout

```text
.
├── frontend/          # Next.js trading terminal UI
├── backend/           # Go Fiber API + Python MT5 bridge sidecar
├── docs/              # Root monorepo docs
├── .env.example       # Shared example env file
└── README.md          # Project entrypoint
```

## Frontend Ownership

`frontend/` owns the browser trading application.

```text
frontend/
├── src/               # App code, components, stores, services, hooks, types
├── public/            # Static assets
├── tests/             # Frontend test suites
├── scripts/           # Frontend validation and utility scripts
├── docs/              # Frontend architecture and feature docs
└── package.json       # Frontend dependencies and scripts
```

Frontend docs should cover chart behavior, drawing tools, Pine runtime, indicator settings, replay,
trade simulator UI, responsive layout, and frontend test conventions.

## Backend Ownership

`backend/` owns the Go API service and the Python MT5 bridge sidecar.

```text
backend/
├── cmd/api/           # API entrypoint
├── internal/          # Private backend packages
│   ├── config/        # Environment configuration
│   ├── httpserver/    # Fiber app and server lifecycle
│   ├── health/        # Health endpoint
│   └── middleware/    # Shared HTTP middleware
├── bridge/            # Python MT5 WebSocket bridge (sidecar)
│   └── ftmo_mt5/      # FTMO broker integration
├── docs/              # Backend architecture, API, and configuration docs
├── go.mod
└── README.md
```

Backend framework decision: **Fiber**. New backend endpoints and middleware should be designed
around Fiber handlers, Fiber route groups, and Fiber-compatible middleware.

The Python MT5 bridge is a **sidecar service** — it runs as a separate process alongside the Go
API and communicates over WebSockets. It is not part of the Go Fiber request path.

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
