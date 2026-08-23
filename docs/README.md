# MarketLens documentation

Verified against the repository on 2026-08-24.

This directory contains cross-package documentation for MarketLens. Package-specific implementation
details belong under `frontend/docs/`, `backend/docs/`, or `backend/execution/`.

## Start here

| Document | Use it for |
| --- | --- |
| [Current state](CURRENT_STATE.md) | What is implemented, where it runs, and which external gates remain |
| [Current progress](CURRENT_PROGRESS.md) | Recently completed work and the active delivery focus |
| [Handoff](HANDOFF.md) | Safe session startup, verification, deployment, and continuation commands |
| [Next tasks](NEXT_TASKS.md) | Prioritized work that is still open |
| [Known issues](KNOWN_ISSUES.md) | Current limitations and operational caveats |
| [Operations](OPERATIONS.md) | Local checks, production build/deploy, health gates, and recovery |
| [Security](SECURITY.md) | Authentication, secret handling, transaction controls, and release checklist |
| [Codebase memory](CODEBASE_MEMORY.md) | Knowledge-graph setup, maintenance, CLI fallback, and recovery |
| [Project structure](PROJECT_STRUCTURE.md) | Monorepo ownership and runtime boundaries |
| [Changelog](CHANGELOG.md) | Append-only historical record of major repository changes |

## Execution and production

| Document | Status |
| --- | --- |
| [Trade execution architecture](TRADE_EXECUTION_ARCHITECTURE.md) | Current Go/Rust/common-EA safety and account model |
| [Bare-metal managed MT5 runbook](MT5_BAREMETAL_MANAGED_EA_RUNBOOK.md) | Current Windows worker/terminal/EA installation and activation gates |
| [Production trade security runbook](TRADE_PRODUCTION_SECURITY_RUNBOOK.md) | Current production release and incident controls |
| [Prop risk guard](PROP_RISK_GUARD.md) | Current automated drawdown protection contract |
| [MT5 local image automation](MT5_VM_LOCAL_IMAGE_AUTOMATION.md) | Current image, broker catalog, and slot automation |
| [MT5 operator checklist](MT5_WINDOWS_VM_CONNECTOR_PHASE0_4_OPERATOR_CHECKLIST.md) | External evidence required before production activation |

The numbered MT5 phase documents and universal connector plan remain design/validation records. Use
the architecture and runbooks above for current operations.

## Cross-package architecture

| Document | Scope |
| --- | --- |
| [Replay backend migration](REPLAY_BACKEND_MIGRATION_PLAN.md) | Historical design and completed frontend-to-Go replay cutover |
| [Replay backend Phase 6](REPLAY_BACKEND_PHASE6.md) | Final client-authority deletion and boundary gate |
| [Pine runtime Go migration](PINE_RUNTIME_GO_MIGRATION.md) | Pine ownership and migration boundary |
| [Trade password authorization](TRADE_PASSWORD_AUTHORIZATION.md) | High-value trade authorization contract |
| [Platform dialogs](PLATFORM_DIALOGS.md) | Cross-platform dialog ownership |

## Package documentation

- [Frontend documentation](../frontend/docs/README.md)
- [Frontend package README](../frontend/README.md)
- [Backend documentation](../backend/docs/README.md)
- [Backend package README](../backend/README.md)
- [Rust execution workspace](../backend/execution/README.md)

## Historical records

The following are evidence, not mutable current-state documentation:

- `agent-evidence/` contains approved SPEC/EVIDENCE pairs tied to exact source states.
- `fixtures/` contains sanitized validation fixtures and schemas.
- dated audits, release notes, phase plans, and phase validation documents preserve the decision or
  result recorded at that time.

Do not rewrite historical evidence to match current behavior. When guidance changes, update the
maintained documents in **Start here** and add a new dated evidence record.

## Documentation maintenance rules

- Keep current-state pages concise and link to the owning architecture/runbook instead of copying it.
- Mark superseded plans as historical; never leave deleted paths in a current index.
- Verify every relative link and every named file before committing.
- Update package versions from manifests/lockfiles, not memory.
- Update `CURRENT_STATE.md`, `CURRENT_PROGRESS.md`, `HANDOFF.md`, `NEXT_TASKS.md`, and
  `KNOWN_ISSUES.md` together when project direction or operational truth changes.
