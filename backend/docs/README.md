# Backend documentation

This directory is the canonical reference for the MarketLens backend. It describes the current
Go, Rust, PostgreSQL, Vault, Python MT5 market-data, common-EA, and managed-worker implementation.

Current migration head: `0042`.

## Read first

| Document | Purpose |
| --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Runtime boundaries, trust model, package map, and request flows |
| [API.md](API.md) | Source-derived Go route catalog and Rust listener boundary |
| [AUTH.md](AUTH.md) | Firebase identity, backend sessions, cookies, Origin policy, and trade authorization |
| [CONFIGURATION.md](CONFIGURATION.md) | Backend environment variables, defaults, and secret handling |
| [DATABASE.md](DATABASE.md) | Schema ownership and migration ledger through `0042` |
| [PRODUCTION_BUILD.md](PRODUCTION_BUILD.md) | Build, deploy, health gates, rollback, and recovery rules |
| [BACKEND_IMPLEMENTATION_PLAN.md](BACKEND_IMPLEMENTATION_PLAN.md) | Current implementation status and remaining gated work |

Package-specific operating notes live beside their source:

- [backend root](../README.md)
- [Rust execution workspace](../execution/README.md)
- [common MT5 EA](../bridge/mt5_ea/README.md)
- [MT5 market-data sidecar](../bridge/mt5_stream/README.md)
- [MT5 trading-session helper](../bridge/mt5_session/README.md)
- [managed MT5 worker and validation harnesses](../bridge/mt5_vm/README.md)

Cross-package security and operations:

- [Trade execution architecture](../../docs/TRADE_EXECUTION_ARCHITECTURE.md)
- [Trade production security runbook](../../docs/TRADE_PRODUCTION_SECURITY_RUNBOOK.md)
- [Backend operations](../../docs/OPERATIONS.md)
- [Bare-metal managed EA runbook](../../docs/MT5_BAREMETAL_MANAGED_EA_RUNBOOK.md)

Historical phase plans and prior evidence remain useful audit records, but they are not runtime
instructions. When a historical document conflicts with this index or the current source, current
source and the active runbooks above win.
