# Root Documentation

Root docs are the cross-project memory for the monorepo. Feature-level details belong in the
owning package docs.

## Index

| File | Purpose |
| --- | --- |
| `PROJECT_STRUCTURE.md` | Monorepo layout, ownership boundaries, and package rules |
| `OPERATIONS.md` | Running, testing, deploying, and troubleshooting the monorepo |
| `CURRENT_STATE.md` | Current repo/runtime state after the monorepo split |
| `CURRENT_PROGRESS.md` | Completed work, active milestone, and recent changes |
| `HANDOFF.md` | Cross-session handoff; read this before continuing work |
| `NEXT_TASKS.md` | Prioritized implementation backlog |
| `KNOWN_ISSUES.md` | Known mismatches, limitations, and operational gotchas |
| `CHANGELOG.md` | Dated log of major changes |

## Package Docs

| Package | Docs |
| --- | --- |
| Frontend | [`../frontend/docs/README.md`](../frontend/docs/README.md) |
| Backend | [`../backend/docs/README.md`](../backend/docs/README.md) |

## Cross-Package Plans

| File | Purpose |
| --- | --- |
| [`../frontend/docs/BACKEND_API_SYNC_ARCHITECTURE.md`](../frontend/docs/BACKEND_API_SYNC_ARCHITECTURE.md) | Frontend plan for applying backend JSON/API as the authenticated workspace source of truth |
| `REPLAY_BACKEND_MIGRATION_PLAN.md` | Cross-stack design for moving replay sessions, clock, aggregation, and replay trading from frontend to Go/PostgreSQL |
| `PINE_RUNTIME_GO_MIGRATION.md` | Cross-package plan for moving Pine parsing/compilation from frontend TypeScript to the Go backend |

## Documentation Rules

- Put frontend chart, Pine, drawing, replay, indicator, UI, and test docs under `frontend/docs/`.
- Put Go API, Fiber, routing, middleware, configuration, and backend deployment docs under
  `backend/docs/`.
- Keep root docs short and cross-project only.
- Update `HANDOFF.md`, `CURRENT_PROGRESS.md`, `NEXT_TASKS.md`, and `CHANGELOG.md` when a task changes
  project direction or leaves important state for the next engineer.
