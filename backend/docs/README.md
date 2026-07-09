# Backend Documentation

Documentation for the SMC Trading Terminal Go API server.

Backend framework decision: Fiber. Current code is a Fiber API with health/readiness, auth,
settings/bootstrap, Phase 6 watchlists, and a local MT5 tick streaming sidecar/consumer. The next
HTTP persistence task is Phase 7 drawings.

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
