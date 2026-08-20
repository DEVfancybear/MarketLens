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
| `TRADE_EXECUTION_ARCHITECTURE.md` | Durable multi-account web execution architecture and safety boundaries |
| `UNIVERSAL_MT5_WINDOWS_VM_CONNECTOR_PLAN.md` | Authoritative Plans 0-9 for a secure broker-neutral Windows VM connector with multiple isolated MT5 terminals per Rust-managed worker |
| `MT5_WINDOWS_VM_CONNECTOR_PHASE0_VALIDATION.md` | Completed host/runtime and credential-safe FTMO Free Trial read-only evidence for Phase 0 |
| `MT5_WINDOWS_VM_CONNECTOR_PHASE1_VALIDATION.md` | Implemented worker prototype, passing unit gates, blocked real-terminal lifecycle, and explicit follow-up checklist |
| `MT5_WINDOWS_VM_CONNECTOR_PHASE2.md` | Durable control-plane repository implementation and remaining operational activation gates |
| `MT5_WINDOWS_VM_CONNECTOR_PHASE3.md` | Vault/authenticated connection API implementation, security boundaries, verification record, and activation runbook |
| `MT5_WINDOWS_VM_CONNECTOR_PHASE4A.md` | Phase 4a normalized account/portfolio/instrument synchronization and readiness boundary |
| `MT5_WINDOWS_VM_CONNECTOR_PHASE4B.md` | Phase 4b historical orders/deals, coverage and cursor contract |
| `MT5_WINDOWS_VM_CONNECTOR_PHASE0_4_OPERATOR_CHECKLIST.md` | Secret-safe external gates required before Phase 5 |
| `PROP_RISK_GUARD.md` | Automated, versioned prop-firm drawdown protection on the web execution path |

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
| `REPLAY_BACKEND_PHASE6.md` | Final Replay cutover, mandatory deletion proof, boundary guard, and verification runbook |
| `PINE_RUNTIME_GO_MIGRATION.md` | Cross-package plan for moving Pine parsing/compilation from frontend TypeScript to the Go backend |
| `PIVOT_FORMATION_ALERT_PLAN.md` | Deferred cross-stack plan for backend-owned, durable Swing pivot-formation alerts |
| `UNIVERSAL_MT5_WINDOWS_VM_CONNECTOR_PLAN.md` | Plans 0-9 for Rust worker control, credential security, multi-terminal isolation, durable execution, measured VM density, multi-broker certification, and rollout |
| `MT5_WINDOWS_VM_CONNECTOR_PHASE0_VALIDATION.md` | Phase 0 execution record; host/runtime/tests and credentialed FTMO Free Trial read-only gate pass |
| `MT5_WINDOWS_VM_CONNECTOR_PHASE1_VALIDATION.md` | Phase 1 execution record; prototype tests pass while the credentialed lifecycle remains blocked at MT5 initialization |
| `MT5_WINDOWS_VM_CONNECTOR_PHASE2.md` | Phase 2 durable worker-control implementation and restart/reassignment gates |
| `MT5_WINDOWS_VM_CONNECTOR_PHASE3.md` | Phase 3 vault, account lifecycle, one-time grant, UI, and deployment record |
| `MT5_WINDOWS_VM_CONNECTOR_PHASE4A.md` | Phase 4a normalized read synchronization |
| `MT5_WINDOWS_VM_CONNECTOR_PHASE4B.md` | Phase 4b history and cursor semantics |

## Documentation Rules

- Put frontend chart, Pine, drawing, replay, indicator, UI, and test docs under `frontend/docs/`.
- Put Go API, Fiber, routing, middleware, configuration, and backend deployment docs under
  `backend/docs/`.
- Keep root docs short and cross-project only.
- Update `HANDOFF.md`, `CURRENT_PROGRESS.md`, `NEXT_TASKS.md`, and `CHANGELOG.md` when a task changes
  project direction or leaves important state for the next engineer.
