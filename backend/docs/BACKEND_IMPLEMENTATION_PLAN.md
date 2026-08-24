# Backend implementation status and remaining plan

This document replaces the original phase-by-phase build plan. The old plan described components
that were later removed and treated already-shipped resources as future work. Current behavior is
documented in [ARCHITECTURE.md](ARCHITECTURE.md), [API.md](API.md), and
[DATABASE.md](DATABASE.md).

## Current baseline

The backend is implemented through migration `0042`:

- Fiber Go API, PostgreSQL readiness, standard error envelope, request IDs, CORS/Origin controls,
  security headers, graceful shutdown, and structured logging.
- Firebase Google authentication, rotating backend sessions, HttpOnly cookies, logout/revoke-all,
  active-session checks for sensitive operations, and optional trade-password authorization.
- Settings/bootstrap, watchlists, drawings, templates/favorites, indicators, Pine scripts/runtime,
  alerts/push-worker contracts, layouts, journal/screenshots, simulated trading, chart navigation,
  MT5 market data, and replay.
- Broker-neutral execution with Go BFF, Rust gateway, common EA, PostgreSQL command/event/audit
  state, multi-target copy routing, account layout, prop-risk guards, and reconciliation.
- Managed MT5 control plane with private worker enrollment, leases, lifecycle commands,
  Windows-credential-backed one-time grants, read/history sync, and managed common-EA bootstrap.
- Production source runner and CI-artifact deploy flow with staged binaries, forward migration,
  health gates, checksum/commit verification, and binary rollback.

## Production activation gates

Implementation does not automatically mean a feature is safe to enable in production.

| Surface | Code state | Remaining operational gate |
| --- | --- | --- |
| Common MT5 EA | implemented | Publish verified EA `1.26`; upgrade each terminal and confirm poll liveness |
| Multi-account MT5 execution | implemented | PostgreSQL, loopback Rust listeners, public Go relay, production security checklist |
| Bare-metal managed MT5 | locally gated | Explicit worker install plus R15-9 disposable Demo evidence |
| Windows credential path | implemented | Stable dedicated API identity, local readiness probe, rotation/deletion drill |
| Object-storage screenshots | implemented | Configure S3-compatible credentials and validate cleanup queue handling |
| Replay engine | feature-gated | Enable only after retention/capacity settings and production monitoring are accepted |
| Native Binance transport | disabled | Complete signing, secret custody, filters, reconciliation, rate limits, and testnet/live certification |

## Remaining engineering work

### Managed MT5 production proof

Follow [the bare-metal managed EA runbook](../../docs/MT5_BAREMETAL_MANAGED_EA_RUNBOOK.md). The
remaining gate is operational evidence on a disposable Demo account and installed worker, not a
claim that a schema or trait alone constitutes production readiness.

### Native exchange adapters

The domain supports venue kinds for future adapters, but native Binance is deliberately fail-closed.
Before registration, implement and test:

1. encrypted trade-only API-key onboarding, IP restrictions, rotation, and revocation;
2. official Spot/USD-M signing, server-time synchronization, filters, and error normalization;
3. deterministic client order IDs plus timeout/unknown reconciliation before retry;
4. balances, positions, orders, fills, instrument/filter sync, and periodic reconciliation;
5. request-weight accounting, bounded backoff, circuit breaking, and egress policy;
6. testnet contract tests and a separately approved minimal-notional mainnet canary.

### Operations and observability

- Keep health/readiness, EA poll liveness, worker leases, copier backlog, reconciliation errors,
  Windows credential-store failures, database pool pressure, and migration state visible to operators.
- Rehearse artifact rollback while keeping migrations forward-only.
- Keep EA/worker binaries pinned, signed where required, and checksum verified.
- Retain command/event/audit records according to documented privacy and incident requirements.

## Change checklist

For every backend change:

1. Update migrations before code that requires the schema; never edit an applied migration.
2. Preserve owner scoping, active-session checks, loopback boundaries, idempotency, and fail-closed
   behavior.
3. Add the smallest source-level and boundary-level tests that prove the contract.
4. Update the route, configuration, database, security, and production docs affected by the change.
5. Run the repository's risk-calibrated gauntlet and keep evidence with exact commands/results.

## Canonical references

- [Trade execution architecture](../../docs/TRADE_EXECUTION_ARCHITECTURE.md)
- [Trade production security](../../docs/TRADE_PRODUCTION_SECURITY_RUNBOOK.md)
- [Backend operations](../../docs/OPERATIONS.md)
- [Managed MT5 runbook](../../docs/MT5_BAREMETAL_MANAGED_EA_RUNBOOK.md)
- [Replay phase 6 contract](../../docs/REPLAY_BACKEND_PHASE6.md)
