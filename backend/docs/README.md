# Backend Documentation

Documentation for the SMC Trading Terminal Go API server.

Backend framework decision: Fiber. Current code includes health/readiness,
auth, settings/bootstrap, watchlists, drawings, indicators, Pine scripts/runtime,
alerts/push tokens with dynamic technical-target verification, layouts, and the
local MT5 streaming sidecar/consumer. The migration head is `0022`.

## Index

| File               | Purpose                                            |
| ------------------ | -------------------------------------------------- |
| `ARCHITECTURE.md`  | Backend architecture overview                      |
| `API.md`           | API endpoint reference (per-feature contract)      |
| `DATABASE.md`      | PostgreSQL schema design and migration plan        |
| `AUTH.md`          | Google sign-in / sign-up flow and implemented routes |
| `BACKEND_IMPLEMENTATION_PLAN.md` | Phased build order for the Go backend|
| `CONFIGURATION.md` | Environment and configuration                      |

## Cross-Package Runtime Plans

| File | Purpose |
| --- | --- |
| [`../../docs/PINE_RUNTIME_GO_MIGRATION.md`](../../docs/PINE_RUNTIME_GO_MIGRATION.md) | Plan for moving Pine parsing/compilation from frontend TypeScript into the Go backend runtime |
| [`../../docs/PIVOT_FORMATION_ALERT_PLAN.md`](../../docs/PIVOT_FORMATION_ALERT_PLAN.md) | Deferred design for backend-owned indicator-event evaluation and Swing pivot alerts |
| [`../../docs/REPLAY_BACKEND_MIGRATION_PLAN.md`](../../docs/REPLAY_BACKEND_MIGRATION_PLAN.md) | Design for backend-owned replay sessions, database, API, deterministic engine, and frontend cutover |
