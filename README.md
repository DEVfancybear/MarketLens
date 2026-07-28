# SMC Trading Terminal

TradingView-style multi-chart terminal with drawings, indicators, replay,
simulation, journaling, analytics, and broker-neutral multi-account execution.

## Runtime architecture

| Path | Purpose |
| --- | --- |
| `frontend/` | Next.js 16 / React 19 trade and chart workspace |
| `backend/` | Go authenticated BFF, persistence, alerts, replay, and market data |
| `backend/execution/` | Rust risk, copy routing, durable command ledger, and venue adapters |
| `backend/bridge/mt5_ea/` | One common MT5 EA for FTMO, Exness, and other MT5 brokers |
| `backend/bridge/mt5_stream/` | Private Python MT5 market-data sidecar; it never executes orders |
| `docs/` | Monorepo operations, security, and design documentation |
| `.codebase-memory/` | Shared compressed code knowledge graph for coding agents |

Trade is a top-level workspace and is not hosted in the resizable bottom panel.
Each MT5 account runs in its own terminal and attaches the same EA. Demo and
Live accounts use the same execution path. Broker symbol aliases are mapped per
account, and every copy target is risk-checked and recorded independently.

The former FTMO Python Connector, downloadable Connector, credential verifier,
browser-to-loopback execution protocol, and stored MT5 passwords have been
removed. The application never needs a user's MT5 password.

Current execution design and release gates:

- [`docs/TRADE_EXECUTION_ARCHITECTURE.md`](docs/TRADE_EXECUTION_ARCHITECTURE.md)
- [`docs/TRADE_PRODUCTION_SECURITY_RUNBOOK.md`](docs/TRADE_PRODUCTION_SECURITY_RUNBOOK.md)

## Development

```powershell
cd frontend
npm install
npm run dev
```

```powershell
cd backend
go run ./cmd/api
```

The Rust workspace lives at `backend/execution/Cargo.toml`. PostgreSQL and a
32+ character `EXECUTION_ADMIN_TOKEN` are required for the durable gateway.

## Agent codebase memory

Coding agents must use the shared codebase-memory graph before changing code.
The required startup gate is defined in [`AGENTS.md`](AGENTS.md), and installation,
indexing, artifact export, UI, and recovery procedures are documented in
[`docs/CODEBASE_MEMORY.md`](docs/CODEBASE_MEMORY.md).

## Production

On the Windows production host, use the canonical runner from the repository
root:

```powershell
.\run-backend-production.ps1
```

It pulls a clean worktree, builds staged Go and Rust artifacts, provisions the
private market-data runtime, applies forward migrations, safely restarts owned
listeners, and runs local/public health gates. Both Rust listeners remain
loopback-only. The existing public Go API exposes only `/execution-ea/*` as a
strict relay to the EA listener; the Rust admin listener has no public route.

The production frontend is `https://tradingterminal.io.vn`; the Go API is
`https://api.tradingterminal.io.vn`.

## Core checks

```powershell
cd frontend
npm run typecheck
npm run test:trade
npm run test:ui
```

```powershell
cd backend
go test ./...
```

```powershell
cargo test --manifest-path backend/execution/Cargo.toml --workspace --all-targets
```
