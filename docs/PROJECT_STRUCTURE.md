# Project structure

Verified on 2026-08-24.

MarketLens is a monorepo with independently testable/deployable frontend, Go backend, Rust execution,
and MT5 integration boundaries.

## Top level

```text
.
|-- .github/workflows/       GitHub Actions CI and artifact build
|-- frontend/                Next.js browser application
|-- backend/                 Go API, Rust execution, migrations, and MT5 helpers
|-- docs/                    Cross-package state, architecture, security, and operations
|-- tools/                   Repository verification and deployment tooling
|-- run-backend-production.ps1
|-- README.md
`-- LICENSE
```

## Frontend ownership

```text
frontend/
|-- src/app/                 Next App Router shell and server route handlers
|-- src/components/          Product workspaces and shared UI
|-- src/services/            API, auth, market data, notifications, and domain services
|-- src/store/               Jotai state modules
|-- src/workers/             Browser workers
|-- tests/                   Architecture, unit/integration, and browser suites
|-- tools/                   Benchmarks, workers, and migrations
|-- docs/                    Frontend architecture and feature contracts
|-- design-system/           MarketLens design-system source
`-- package.json             Frontend scripts and dependency source of truth
```

The frontend owns presentation, browser interaction, local/anonymous persistence explicitly allowed
by a feature contract, and adapters to authenticated backend resources. It does not own durable
broker secrets or execution authority.

## Backend ownership

```text
backend/
|-- cmd/
|   |-- api/                 Go HTTP API
|   |-- migrate/             Forward database migrations
|   |-- mt5-stream/          MT5 market-data consumer
|   `-- mt5-phase3-harness/  Bounded validation harness
|-- internal/                Private Go domain/repository/http packages
|-- migrations/              PostgreSQL schema history and validation fixtures
|-- execution/
|   |-- crates/execution-domain/
|   |-- crates/execution-engine/
|   |-- crates/execution-adapters/
|   |-- crates/execution-gateway/
|   `-- crates/mt5-vm-agent/
|-- bridge/
|   |-- mt5_ea/              Common managed MT5 Expert Advisor
|   |-- mt5_session/         Session helper
|   |-- mt5_stream/          Local market-data sidecar
|   `-- mt5_vm/              Generic MT5 Python/bootstrap helpers
|-- docs/                    Backend API/auth/configuration/production docs
|-- go.mod
`-- README.md
```

Go/PostgreSQL owns durable API state, authorization, commands, events, and audit. Rust owns execution
domain/risk/routing and managed worker control. Python/MQL components are bounded adapters to the
installed MT5 runtime. The deleted `ftmo_mt5` browser bridge and credential verifier are not part of
the current tree.

## Documentation ownership

- Root `docs/`: cross-package state, security, operations, execution architecture, runbooks, and
  historical evidence.
- `frontend/docs/`: frontend architecture, interaction, rendering, and feature contracts.
- `backend/docs/`: Go API, auth, database, configuration, and production build/deploy guidance.
- `backend/execution/README.md`: Rust workspace and execution development guidance.

See [root documentation index](README.md) and
[frontend documentation index](../frontend/docs/README.md).

## Deployment boundaries

- Vercel builds from `frontend/`.
- The Go API and Rust binaries are packaged together by the Windows artifact job.
- `tools/deploy-backend.ps1` deploys the verified CI artifact without compiling on the host.
- `run-backend-production.ps1` is the canonical source-build production runner.
- MT5 terminals/EAs/workers are host-managed runtimes; they are not browser processes.

## Contribution rules

- Keep dependencies and package-specific docs inside their owner.
- Do not add execution authority or reusable broker secrets to the frontend.
- Do not bypass Go/Rust durable/audited command boundaries with direct browser-to-MT5 paths.
- Update structure docs only after verifying actual paths and manifests.
- Keep generated/runtime trees out of Git and codebase-memory indexes.
