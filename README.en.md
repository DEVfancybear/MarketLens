<div align="center">

[🇻🇳 Tiếng Việt](README.md) · 🇬🇧 **English**

# ✦ SMC Trading Terminal ✦

### See the market clearly. Rehearse every idea. Execute with confidence.

**A production-grade, TradingView-inspired workspace that brings advanced charting,**<br>
**market replay, risk-aware execution, alerts, and trading intelligence into one terminal.**

[![Production](https://img.shields.io/badge/Production-Live-00C853?style=for-the-badge&logo=vercel&logoColor=white)](https://tradingterminal.io.vn)
![Next.js](https://img.shields.io/badge/Next.js_16-000000?style=for-the-badge&logo=nextdotjs&logoColor=white)
![React](https://img.shields.io/badge/React_19-149ECA?style=for-the-badge&logo=react&logoColor=white)
![Go](https://img.shields.io/badge/Go-00ADD8?style=for-the-badge&logo=go&logoColor=white)
![Rust](https://img.shields.io/badge/Rust-CE412B?style=for-the-badge&logo=rust&logoColor=white)

[**Open the live terminal →**](https://tradingterminal.io.vn) ·
[Explore the architecture](docs/PROJECT_STRUCTURE.md) ·
[Read the production runbook](docs/TRADE_PRODUCTION_SECURITY_RUNBOOK.md)

</div>

---

## One workspace. The complete trading loop.

SMC Trading Terminal is built for traders who want the fluidity of a modern
charting platform without separating research, practice, execution, and review
across disconnected tools. From the first market observation to the final trade
record, every stage lives in one coherent, responsive workspace.

| **Analyze** | **Rehearse** | **Execute** | **Stay informed** |
| --- | --- | --- | --- |
| Multi-chart layouts, a high-performance drawing engine, indicators, Pine runtime, and Smart Money Concepts overlays. | Replay historical markets, validate ideas, simulate orders, and study decisions without risking capital. | Route risk-checked orders across broker-neutral MT5 accounts through a durable Go and Rust execution stack. | Track price and drawing alerts through in-app, browser, push, Telegram, and Discord channels. |

### Built beyond the chart

- **Professional charting** — responsive multi-pane layouts, deep zoom,
  precision drawing tools, indicators, templates, and synchronized workspaces.
- **Replay and research** — deterministic market replay, simulated trading,
  journaling, screenshots, analytics, and backtesting workflows.
- **Production execution** — broker-neutral MT5 routing, multi-account copy
  targets, centralized risk checks, durable commands, and auditable state.
- **Security by design** — private execution boundaries and no stored MT5
  passwords; every account remains attached through the common EA runtime.
- **One consistent experience** — desktop and mobile surfaces, English and
  Vietnamese localization, live alerts, and backend-synchronized settings.

> **SMC Trading Terminal turns a chart into an operating system for the full
> trading workflow—beautiful at the surface, disciplined underneath.**

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
