<div align="center">

[🇻🇳 Tiếng Việt](README.md) · 🇬🇧 **English**

# ✦ MarketLens ✦

### See the market clearly. Rehearse every idea. Execute with confidence.

**MarketLens is a private-source, TradingView-inspired research and execution platform that brings advanced charting,**<br>
**market replay, risk management, and multi-account MT5 execution into one bilingual web terminal.**

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

MarketLens is built for traders who want the fluidity of a modern
charting platform without separating research, practice, execution, and review
across disconnected tools. From the first market observation to the final trade
record, every stage lives in one coherent, responsive workspace.

### Why does this project exist?

The market does not lack charts. What is missing is an unbroken journey. A
trader often reads structure in one place, validates an idea somewhere else,
executes in a separate terminal, and opens yet another tool to monitor and
review the outcome. Every switch loses context, repeats work, and creates
another opportunity for intent and execution to drift apart.

MarketLens began with one ambitious question:

> **What if a drawing on the chart did not end at the chart?**

### From a drawing to a real decision

<div align="center">

**Observe** → **Sketch the scenario** → **Replay** → **Control risk** → **MT5** → **Alert & review**

</div>

Spot a market structure, shape the idea with a Long/Short Position drawing,
travel back through history to test it, then open a ticket with entry, stop loss,
and take profit prepared from that same visual plan. Only after confirmation
does the order pass through risk controls and route to the selected MT5
accounts. While you are away, price and geometry alerts keep watch; when you
return, the journal and analytics help turn outcomes into experience.

### The difference lives in the connections underneath

| Idea | What the project actually does |
| --- | --- |
| **Drawings are more than decoration** | A drawing can create an alert, prepare a trade plan, and retain links to order and position state. |
| **Replay is more than playback** | Historical data becomes a practice environment for validating process and decisions before risking real capital. |
| **Execution is more than a button** | Go, Rust, the MT5 EA, and Windows VM workers authenticate users, control risk, persist commands, and keep credentials inside private backend boundaries. |
| **Multi-account does not mean blind copying** | Every copy target has independent symbol mapping, risk limits, and an auditable state trail. |

### Built beyond the chart

- **Professional charting** — responsive multi-pane layouts, deep zoom,
  precision drawing tools, indicators, templates, and synchronized workspaces.
- **Replay and research** — deterministic market replay, simulated trading,
  journaling, screenshots, analytics, and backtesting workflows.
- **Production execution** — broker-neutral MT5 routing, multi-account copy
  targets, centralized risk checks, durable commands, and auditable state.
- **Security by design** — browsers and PostgreSQL never store MT5 passwords;
  Vault-backed credentials use one-time grants bound to the exact worker,
  session, lease, and command.
- **Two MT5 connection modes** — self-manage a terminal with the common EA, or
  use the backend-managed Windows VM connector once its operational gates are enabled.
- **One consistent experience** — desktop and mobile surfaces, English and
  Vietnamese localization, live alerts, and backend-synchronized settings.

> **MarketLens turns a chart into an operating system for the full
> trading workflow—beautiful at the surface, disciplined underneath.**

## Runtime architecture

| Path | Purpose |
| --- | --- |
| `frontend/` | Next.js 16 / React 19 trade and chart workspace |
| `backend/` | Go authenticated BFF, persistence, alerts, replay, and market data |
| `backend/execution/` | Rust risk, copy routing, durable command ledger, and venue adapters |
| `backend/bridge/mt5_ea/` | One common MT5 EA for FTMO, Exness, and other MT5 brokers |
| `backend/execution/crates/mt5-vm-agent/` | Lease-fenced Windows worker supervising multiple isolated MT5 terminals |
| `backend/bridge/mt5_stream/` | Private Python MT5 market-data sidecar; it never executes orders |
| `docs/` | Monorepo operations, security, and design documentation |
| `.codebase-memory/` | Shared compressed code knowledge graph for coding agents |

Trade is a top-level workspace and is not hosted in the resizable bottom panel.
Each MT5 account runs in its own terminal through either the self-managed EA or
the backend-provisioned Windows VM connector. Demo and Live accounts share the
same risk-control domain. Broker symbol aliases are mapped per
account, and every copy target is risk-checked and recorded independently.

The former FTMO Python Connector, downloadable Connector, credential verifier,
browser-to-loopback execution protocol, and stored MT5 passwords have been
removed. When the managed connector is enabled, a password travels once through
the authenticated backend into Vault and is never persisted by the browser or
application database.

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
