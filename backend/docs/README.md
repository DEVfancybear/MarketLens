# Backend Documentation

Documentation for the SMC Trading Terminal Go API server.

Backend framework decision: Fiber. Current code is a Fiber API scaffold with health/readiness and
Phase 4 auth routes implemented. The current backend task is Phase 5 of
`BACKEND_IMPLEMENTATION_PLAN.md`: settings persistence plus `GET /api/v1/sync/bootstrap`.

## Index

| File               | Purpose                                            |
| ------------------ | -------------------------------------------------- |
| `ARCHITECTURE.md`  | Backend architecture overview                      |
| `API.md`           | API endpoint reference (per-feature contract)      |
| `DATABASE.md`      | PostgreSQL schema design and migration plan        |
| `AUTH.md`          | Google sign-in / sign-up flow and implemented routes |
| `BACKEND_IMPLEMENTATION_PLAN.md` | Phased build order for the Go backend|
| `CONFIGURATION.md` | Environment and configuration                      |
