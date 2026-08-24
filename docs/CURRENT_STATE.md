# Current state

Verified on 2026-08-24. This page is a concise snapshot; owning architecture and runbooks remain
authoritative for details.

## Product and repository

- MarketLens is an MIT-licensed bilingual trading workspace for charting, replay, planning, alerts,
  journaling, analytics, risk controls, and managed multi-account MT5 execution.
- Canonical repository: `https://github.com/DEVfancybear/MarketLens` on branch `master`.
- The monorepo owns independent frontend, Go backend, Rust execution, Python/MT5 integration, and
  shared operational documentation boundaries.

## Frontend

- `frontend/` runs Next.js 16.3.1, React 19.0.0, TypeScript 6.0.2 strict mode, Jotai, and
  Lightweight Charts 5.2.0.
- Authenticated API/session, replay, watchlist, drawing, indicator, alert, journal, layout, and trade
  resources use the Go backend according to their feature contracts; anonymous/local settings may
  still use browser storage where explicitly documented.
- Desktop and mobile are separate presentation boundaries over shared domain/services rather than
  two independent applications.

See [frontend documentation](../frontend/docs/README.md) and
[frontend package README](../frontend/README.md).

## Backend and data

- `backend/cmd/api` is the Go API; `backend/cmd/migrate` owns forward PostgreSQL migrations.
- The current migration head is recorded in [backend documentation](../backend/docs/README.md).
- `backend/cmd/mt5-stream` and `backend/bridge/mt5_stream` provide local market-data integration.
- Authentication, session rotation, origin/CSRF protection, settings, sync, alerts, replay, journal,
  drawings, layouts, simulated trading, and execution resources are backend-owned where their
  migrations/routes exist.

## Managed execution

- `backend/execution` contains the Rust workspace: domain, engine, adapters, gateway, and
  `mt5-vm-agent`.
- `backend/bridge/mt5_ea` contains the common EA; `mt5_session` and `mt5_vm` contain bounded Python
  bootstrap/session helpers. The deleted browser-facing FTMO bridge and port 8787 are not current
  execution paths.
- Multi-account MT5, FTMO/Exness broker-neutral routing, copy targets, durable commands/events, and
  risk gates are implemented. Production bare-metal activation remains gated by explicit worker
  install plus R15-9 disposable Demo evidence.
- Managed broker credentials use Windows Credential Manager under the stable Go API identity;
  PostgreSQL and Rust retain only opaque references and one-time grant state.
- Native Binance domain values exist but the transport remains deliberately disabled until the
  security/reconciliation plan is completed.

See [trade execution architecture](TRADE_EXECUTION_ARCHITECTURE.md) and
[bare-metal managed MT5 runbook](MT5_BAREMETAL_MANAGED_EA_RUNBOOK.md).

## CI and delivery

GitHub Actions runs three primary verification jobs:

- `replay-client-boundary`: frontend boundary tests, replay/trade tests, typecheck, and production build;
- `backend`: Go tests and vet;
- `execution-rust`: Rust formatting and locked full-workspace tests.

On push, `backend-artifact` runs after backend/Rust success, builds Windows binaries, verifies the
managed-agent library tests on Windows, and uploads a checksummed deployment artifact.

Use `tools/deploy-backend.ps1` to deploy a matching CI artifact. Use
`run-backend-production.ps1` when the production host must pull and build from source. Do not replace
one entrypoint with the other.

## External gates that remain

- A production host, PostgreSQL, Cloudflare/public health, a stable Windows API identity and
  credential set, MT5 terminals, broker accounts,
  and EA allow-listing cannot be proven by repository-only tests.
- R15-9 must use disposable Demo accounts before Live/funded onboarding.
- Production deployment and smoke evidence must be recorded for the exact released commit.

See [known issues](KNOWN_ISSUES.md), [operations](OPERATIONS.md), and
[production trade security](TRADE_PRODUCTION_SECURITY_RUNBOOK.md).
