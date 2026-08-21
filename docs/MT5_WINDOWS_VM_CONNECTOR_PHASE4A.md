# MT5 Windows VM Connector Phase 4a

- Date: 2026-08-20
- Repository status: **4a increment 2 implemented and regression-tested**
- Production status: **INERT; activation remains gated by Phase 1–3 and live demo evidence**
- Scope: normalized read synchronization for the four families `ready` depends on —
  account, positions, pending orders, symbols/specifications

Phase 4a covers exactly what plan §5.1 requires before an account may report
`ready`: fresh account, portfolio, pending-order and instrument evidence.
Orders history, deals and cold-cache cursor pagination are documented in
`MT5_WINDOWS_VM_CONNECTOR_PHASE4B.md`.

Foundation evidence: `docs/agent-evidence/mt5-vm-phase4a-read-sync/{SPEC,EVIDENCE}.md`.
Increment 2/4b evidence:
`docs/agent-evidence/mt5-vm-phase0-4-completion/{SPEC,EVIDENCE}.md`.

## The rule this phase exists to protect

Plan invariant 8, **"empty is not unknown"**: a stale, partial or failed snapshot
must never erase positions or pending orders.

The mechanism is that a snapshot declares its own completeness. Only a
`complete` snapshot may delete rows it does not mention, and only a `complete`
snapshot may advance a freshness anchor. `partial` and `failed` still upsert the
rows they did observe, because refreshing what was seen is better than letting it
rot — they simply may not remove anything.

The other half matters just as much: a `complete` snapshot with zero rows **does**
clear the portfolio. Without that, "never delete on empty" would decay into
"never delete", and a closed position would linger forever. Both halves are
pinned by tests.

## Delivered

| Boundary | Behaviour |
| --- | --- |
| PostgreSQL | Migration `0040` adds five tables holding only normalized, non-secret observations. Every row carries a sync envelope so a write can be fenced before it lands. |
| Rust gateway | `mt5_vm_sync.rs` owns authenticated ingestion, atomic fencing, reconciliation, identity matching, freshness classification, bounded owner-scoped reads, history cursors and decimal validation. |
| Go BFF | Owner-injected `/api/v1/execution/connectors/accounts/:accountId/snapshot` and `/history` routes with bounds and `no-store`. |
| Agent protocol | Stable `instrument_snapshot`, `orders_history_snapshot` and `deals_snapshot` names with HMAC/replay tests. |
| Python adapter | `phase4_snapshots.py` normalizes account/portfolio/instruments and bounded history pages into stable names, string decimals and opaque tickets. |
| PostgreSQL | `0040` read-sync tables plus additive `0041` history/deals/coverage tables. Partial/failed pages cannot advance authoritative coverage. |

`execution_mt5_vm_sync_state` is what makes an empty portfolio distinguishable
from a broken one: it records the per-family high-water mark, the last result and
the last error code.

The freshness anchors are the `last_account_sync_at` / `last_portfolio_sync_at` /
`last_instrument_sync_at` columns Phase 2 already added in `0038`. No column was
added to an existing table.

## Verification boundary

Rust gateway 93/93 and agent managed-worker tests pass (one credentialed live
test remains ignored), along with Python Phase 0/1/4, Go execution, and mutation
controls. The rerunnable entry point is `tools/verify-mt5-phase4.ps1`; it fails
closed if no disposable database URL is provided. A fresh run through
`tools/run-mt5-phase4-disposable.ps1` passed the `0040/0041` up → down one step →
up round-trip on loopback-only EDB PostgreSQL 17.11. The live FTMO/retail exit
gate remains open.

## Gates that remain open

Phase 4a changes nothing about the earlier gates and must not be read as progress
toward them:

- **Phase 1 remains conditional**: the later installed-slot test-host lifecycle passes, but the
  normal signed-agent path, independent web match and live two-account isolation remain open.
- Phase 2 disposable restart, session rotation and reassignment evidence now
  passes; signed-agent and broker gates remain separate prerequisites.
- Phase 3 still needs its deployment exercise.
- **The Phase 4 exit gate is not approachable here.** It requires FTMO and one
  retail demo to match independent terminal/web views across disconnect,
  reconnect and cold-cache history, which needs a licensed MT5 terminal and
  broker credentials.

## Verification

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\verify-mt5-phase4.ps1
```

Set `MT5_PHASE4_DATABASE_URL` only to a disposable PostgreSQL database for the
round-trip layer; the verifier never prints the URL. Never point it at production.
