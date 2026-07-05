# Root Documentation

Root docs describe repository-level decisions that affect more than one package. Keep feature,
runtime, and implementation details inside the owning package docs.

## Index

| File | Purpose |
| --- | --- |
| `PROJECT_STRUCTURE.md` | Monorepo layout, ownership boundaries, and package rules |
| `OPERATIONS.md` | Running, testing, deploying, and troubleshooting the monorepo |

## Package Docs

| Package | Docs |
| --- | --- |
| Frontend | [`../frontend/docs/README.md`](../frontend/docs/README.md) |
| Backend | [`../backend/docs/README.md`](../backend/docs/README.md) |

## Documentation Rules

- Put frontend chart, Pine, drawing, replay, indicator, UI, and test docs under `frontend/docs/`.
- Put Go API, Fiber, routing, middleware, configuration, and backend deployment docs under
  `backend/docs/`.
- Use root docs only for monorepo structure, shared operations, and deployment boundaries.
- Do not list files here unless they exist in this root `docs/` directory.
