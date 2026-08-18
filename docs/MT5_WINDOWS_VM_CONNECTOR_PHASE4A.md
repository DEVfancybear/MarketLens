# MT5 Windows VM Connector Phase 4a

- Date: 2026-08-19
- Repository status: **INCREMENT 1 OF 2 IMPLEMENTED AND TESTED**
- Production status: **INERT; NOTHING WRITES TO THE NEW TABLES YET**
- Scope: normalized read synchronization for the four families `ready` depends on —
  account, positions, pending orders, symbols/specifications

Phase 4a covers exactly what plan §5.1 requires before an account may report
`ready`: fresh account, portfolio, pending-order and instrument evidence.
Orders history, deals and cold-cache cursor pagination are Phase 4b.

Full detail: `docs/agent-evidence/mt5-vm-phase4a-read-sync/{SPEC,EVIDENCE}.md`.

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

## Delivered in increment 1

| Boundary | Behaviour |
| --- | --- |
| PostgreSQL | Migration `0040` adds five tables holding only normalized, non-secret observations. Every row carries a sync envelope so a write can be fenced before it lands. |
| Rust gateway | `mt5_vm_sync.rs` owns fencing, reconciliation, identity matching, freshness classification and decimal transport validation. Pure functions, 23 tests. |
| Python adapter | `bridge/mt5_vm/phase4_snapshots.py` normalizes MT5 into stable names, string decimals and opaque string tickets. Read-only. 17 tests. |

`execution_mt5_vm_sync_state` is what makes an empty portfolio distinguishable
from a broken one: it records the per-family high-water mark, the last result and
the last error code.

The freshness anchors are the `last_account_sync_at` / `last_portfolio_sync_at` /
`last_instrument_sync_at` columns Phase 2 already added in `0038`. No column was
added to an existing table.

## Not delivered — increment 2

- the SQL ingestion transaction that calls the decision core;
- the owner-scoped Go read API, and with it SPEC scenarios 8 (cross-user
  isolation) and 9 (no secret or internal identifier in a response), which are
  therefore **unverified**;
- the `InstrumentSnapshot` agent message kind;
- `tools/verify-mt5-phase4a.ps1` and the required mutation controls.

The gateway module carries an explicit `#![allow(dead_code)]` with a comment
saying why, rather than hiding the gap.

## Gates that remain open

Phase 4a changes nothing about the earlier gates and must not be read as progress
toward them:

- **Phase 1 is still BLOCKED** at the real-terminal gate (`MT5_IPC_TIMEOUT`).
- Phase 2 still needs the disposable-PostgreSQL restart and signed-worker
  rotation/reassignment evidence.
- Phase 3 still needs its deployment exercise.
- **The Phase 4 exit gate is not approachable here.** It requires FTMO and one
  retail demo to match independent terminal/web views across disconnect,
  reconnect and cold-cache history, which needs a licensed MT5 terminal and
  broker credentials.

## Verification

```bash
cd backend/execution && cargo test --locked -p execution-gateway
cd backend && python -m unittest bridge.mt5_vm.test_phase4_snapshots
cd backend && go vet ./... && go test ./...
```

Migration verified up → down → up against a real PostgreSQL 17.6, ending at
`version=40 dirty=false`.

`cargo fmt --all -- --check` cannot run on the Windows host: `cargo-fmt` is
blocked by Application Control (`os error 4551`). The `rustfmt` binary is not
blocked, so verify formatting with it directly before pushing, or CI will reject
the change:

```bash
rustfmt --edition 2024 --check backend/execution/crates/execution-gateway/src/mt5_vm_sync.rs
```
