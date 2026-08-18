# SPEC — MT5 VM connector Phase 4a: normalized read synchronization

- Absolute path:
  `C:\Users\duong\Downloads\tradingview\docs\agent-evidence\mt5-vm-phase4a-read-sync\SPEC.md`
- Tier: old-coder **Tier 3** — cross-cutting, four languages, new durable state, security-sensitive
  boundary.
- Revision 1. **Spec approval: obtained.** The user replied `Duyet SPEC` on 2026-08-19, approving
  this exact Revision 1 before implementation began.

## Mandatory-tooling disclosure

Unchanged from earlier this session and repeated because `AGENTS.md` requires it: no
`codebase-memory-mcp` server is connected and the `old-coder` skill is not installed
(`~/.claude/skills/` holds only `playwright-automation`). Discovery used the documented fallback —
`UNIVERSAL_MT5_WINDOWS_VM_CONNECTOR_PLAN.md`, the Phase 0-3 records, `docs/CODEBASE_MEMORY.md`, and
direct reads of `migrations/0038`, `migrations/0039`,
`execution/crates/execution-gateway/src/mt5_vm_{control,connections}.rs`,
`execution/crates/mt5-vm-agent/src/{protocol,process,main}.rs`,
`bridge/mt5_vm/phase1_adapter.py`, and `internal/execution/mt5_connector_*.go`.

## Phase gating position

Phase 1's live real-terminal gate is **BLOCKED** (`MT5_IPC_TIMEOUT`, `docs/KNOWN_ISSUES.md`), and
the Phase 2/3 operational gates remain open. This SPEC therefore follows the precedent Phases 2 and
3 already set in this repository: implement the **repository slice** behind a boundary that stays
inert until those gates pass, and claim nothing about live operation.

Phase 4 is read-only, which makes it the safest phase to build ahead of the live gate. Phase 4's own
exit gate ("FTMO and one retail demo match independent terminal/web views through disconnect,
reconnect and cold-cache history cases") **cannot be met in this environment** and is explicitly out
of scope; it needs a licensed MT5 terminal and broker credentials.

## Scope: 4a only

Confirmed with the user. Phase 4a covers exactly the evidence `ready` depends on, per plan §5.1
("`ready` requires fresh account, portfolio, pending-order, and instrument evidence"):

| In scope (4a) | Deferred to 4b |
| --- | --- |
| Account state | Orders history |
| Open positions | Deals |
| Pending orders | Cold-cache history backfill |
| Symbols / trading specifications | Cursor pagination over historical ranges |

Freshness semantics are in scope. Cursor semantics are in scope only as the monotonic per-family
sync sequence that fences writes; historical cursor pagination is 4b.

## Non-negotiable invariants this SPEC must honour

From plan §4, the ones this phase can violate if written carelessly:

- **#8 Empty is not unknown.** A stale, partial or failed snapshot must never erase positions or
  pending orders. This is the single most important behaviour in Phase 4a.
- **#6 Fenced ownership.** Every snapshot write carries account ID and lease generation; a stale
  worker's write is rejected.
- **#7 Identity match before ready.** Observed login/server must match the request after
  normalization before `ready` is reported.
- **#11 Workers are private.** No new public worker route.
- **#9/#10 No credential at rest or in arguments.** Snapshots carry no login, password or vault
  reference.

Plan §6 additionally requires: MT5-native enums and object shapes stop inside the Python adapter;
decimal trading values are serialized as **strings**; broker tickets remain **opaque strings**.

## Design

### 1. Migration `0040_mt5_vm_read_sync` (additive only)

Four tables, all owner-scoped and cascading from `execution_mt5_vm_accounts`:

- `execution_mt5_vm_account_state` — one row per account: currency, leverage, balance, equity,
  margin, free margin, margin level, margin mode, `trade_allowed`, demo/live mode, observed login
  suffix and normalized server, plus the sync envelope below. Decimals stored as `numeric`.
- `execution_mt5_vm_positions` — `(account_id, broker_ticket)` primary key.
- `execution_mt5_vm_pending_orders` — `(account_id, broker_ticket)` primary key.
- `execution_mt5_vm_instruments` — `(account_id, symbol)` primary key: digits, point, tick size/value,
  contract size, volume min/max/step, stops level, freeze level, filling modes, trade mode.

Every table carries the same **sync envelope**: `worker_id`, `lease_generation`,
`worker_session_generation`, `sync_sequence bigint`, `observed_at timestamptz`,
`recorded_at timestamptz`. A per-account-per-family high-water mark lives in a fifth table,
`execution_mt5_vm_sync_state`, which also records `last_complete_sync_at` and `last_result`
(`complete` | `partial` | `failed`) so a partial snapshot is distinguishable from an empty portfolio.

The existing `last_account_sync_at` / `last_portfolio_sync_at` / `last_instrument_sync_at` columns on
`execution_mt5_vm_accounts` (already present from `0038`) are the freshness anchors and are updated
by the same transaction. No new column is added to that table.

A down migration drops only what the up migration created.

### 2. Rust gateway — new module `mt5_vm_sync.rs`

Private worker ingestion plus owner-scoped reads. One transaction per snapshot submission:

1. **Fence.** Reject unless the submitting worker currently holds the account lease at the exact
   `lease_generation` and `worker_session_generation`. Reject `sync_sequence` less than or equal to
   the stored high-water mark (replay/stale).
2. **Upsert** the rows the snapshot contains.
3. **Reconcile deletions only when `result = complete`.** Rows absent from a complete snapshot are
   deleted. A `partial` or `failed` snapshot updates nothing but `execution_mt5_vm_sync_state` and
   never deletes — invariant #8.
4. **Identity check.** An account snapshot whose observed login suffix or normalized server does not
   match the registered account is rejected with a typed error and does not advance freshness.
5. Advance the matching `last_*_sync_at` anchor.

Reads are owner-scoped and return the normalized rows plus an explicit freshness verdict
(`observed_at`, age, and whether the family is within the configured freshness bound).

### 3. Python adapter — `bridge/mt5_vm/phase4_snapshots.py`

Pure normalization functions plus a read-only collector, kept separate from `phase1_adapter.py` so
the Phase 1 bootstrap/IPC surface is untouched:

- `normalize_account(info)`, `normalize_position(p)`, `normalize_pending_order(o)`,
  `normalize_instrument(info)`;
- decimals as strings, tickets as opaque strings, MT5 enums mapped to stable lowercase names;
- a collector that calls `account_info`, `positions_get`, `orders_get`, `symbols_get` on a single
  caller thread (invariant #3) and returns one envelope with `result` = `complete` only when every
  call succeeded; any failure downgrades to `partial` and reports the MT5 `last_error` code.

No credential is read, logged or returned.

### 4. Rust agent — `mt5-vm-agent`

Add the `InstrumentSnapshot` message kind alongside the existing `AccountSnapshot` (plan §6 lists
both), and carry the new envelope fields. Transport only; no new policy in the agent.

### 5. Go — read API

Extend `internal/execution/mt5_connector_handler.go` with owner-scoped `GET` routes under the
existing authenticated `/api/v1/execution/connectors/accounts/:accountId` prefix returning account
state, positions, pending orders and instruments. DTOs mirror the existing frontend order/position
shapes; no MT5-native field escapes. The response includes freshness and never a worker ID, terminal
path, vault reference, raw login or internal address (plan §10).

## Executable acceptance scenarios

1. **Complete snapshot replaces the set.** Given two stored positions and a complete snapshot
   containing one, then only that one remains.
2. **Partial snapshot never deletes.** Given two stored positions and a `partial` snapshot containing
   none, then both remain, `last_result` becomes `partial`, and the portfolio freshness anchor does
   **not** advance. (Invariant #8.)
3. **Failed snapshot never deletes and records the error code.** Same as 2 with `result = failed`.
4. **Genuinely empty portfolio is representable.** A `complete` snapshot with zero positions deletes
   all rows and advances freshness — proving 2 and 3 do not simply disable deletion.
5. **Stale lease is fenced.** A snapshot submitted with a lease generation below the current one is
   rejected and changes nothing.
6. **Replay is fenced.** A snapshot whose `sync_sequence` is less than or equal to the stored
   high-water mark is rejected and changes nothing.
7. **Identity mismatch is rejected.** An account snapshot whose observed server or login suffix
   differs from the registration is rejected, does not advance freshness, and records the typed
   error.
8. **Cross-user isolation.** A read for user A never returns any row belonging to user B, and a
   worker holding A's lease cannot write to B's account.
9. **No secret or internal identifier in a read response.** The API response contains no login,
   password, vault reference, worker ID, terminal path or MT5-native payload.
10. **Decimals and tickets keep their transport type.** Every monetary/volume/price field is a
    string; every broker ticket is a string.
11. **Adapter normalization is total.** Given an MT5 stub, each normalizer maps enums to the stable
    names and never emits a float for a decimal field.
12. **Migration is reversible.** `0040` up then down leaves the schema as `0039` left it, verified
    against a real PostgreSQL.

## Negative constraints

- Must **NOT** expose execution, order placement, or any mutation of broker state.
- Must **NOT** add a public worker route, or publish any Python/terminal/agent port.
- Must **NOT** store or return a login, password, vault reference or worker identifier.
- Must **NOT** modify `run-backend-production.ps1`, the deploy path, the frontend, or the legacy EA
  path.
- Must **NOT** enable anything by default: without a live worker the new tables stay empty and every
  read reports "no fresh evidence".
- Must **NOT** claim any Phase 1/2/3 operational gate is closed, or claim the Phase 4 exit gate.
- Must **NOT** use a non-additive migration or renumber existing migrations.
- Must **NOT** let a partial or failed snapshot delete rows or advance freshness.

## Dependencies, tools and generated files authorized

1. New `backend/migrations/0040_mt5_vm_read_sync.{up,down}.sql`.
2. New `backend/execution/crates/execution-gateway/src/mt5_vm_sync.rs` plus its registration in
   `main.rs` and tests in the same file's `mod tests`.
3. Edits to `backend/execution/crates/mt5-vm-agent/src/protocol.rs` (and the minimum in
   `process.rs`/`main.rs`) for the new message kind.
4. New `backend/bridge/mt5_vm/phase4_snapshots.py` and `backend/bridge/mt5_vm/test_phase4_snapshots.py`.
5. Edits to `backend/internal/execution/mt5_connector_handler.go` and its `_test.go`.
6. New `tools/verify-mt5-phase4a.ps1` gauntlet entry point.
7. New `docs/MT5_WINDOWS_VM_CONNECTOR_PHASE4A.md` and this directory's `EVIDENCE.md`; updates to
   `docs/{CURRENT_PROGRESS,NEXT_TASKS,HANDOFF,CHANGELOG,KNOWN_ISSUES}.md` and the plan's phase-4
   "Current state" paragraph.
8. Local use of the PostgreSQL 17.6 instance already running on port 55432 for migration and
   gateway tests. No new runtime dependency is introduced in any language.

## Verification gauntlet

Single entry point:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\verify-mt5-phase4a.ps1
```

Fail-closed layers:

1. **Migration** — `0040` up, then down, then up again against the real PostgreSQL; assert the
   intermediate schema equals the `0039` schema, and that `0040` adds no column to an existing table
   without a default.
2. **Rust** — `cargo test --locked -p execution-gateway`, covering scenarios 1-8 and 10.
3. **Python** — the existing pytest pattern with an MT5 stub, covering scenarios 11 and the
   complete/partial/failed envelope contract.
4. **Go** — `go test ./...`, covering scenarios 8, 9 and 10 at the DTO boundary.
5. **Architecture assertions** — no execution verb reachable from the new module; no new public
   worker route; response DTOs contain none of the forbidden fields; migration is additive.
6. **Whole-suite regression** — `go vet ./...`, `cargo fmt --check`, and the existing
   `tools/verify-backend-deploy.ps1` still passing.
7. **Diff hygiene** — `git diff --check`, intended-file allowlist, secret scan.

Mutation control: at least three deliberate regressions, each proven to fail the gauntlet and then
restored — allow a partial snapshot to delete rows, drop the lease fence, and drop the identity
check.

### Explicitly NOT verifiable here

- Any live MT5 terminal, broker connection, or real account data.
- The Phase 4 exit gate (independent terminal/web comparison, disconnect/reconnect, cold-cache).
- End-to-end worker→gateway flow over the real agent transport; the Rust tests drive the gateway's
  ingestion boundary directly, and the agent change is covered only by its own crate tests.

## RED → GREEN → REFACTOR plan

1. Baseline: current `cargo test`, `go test`, pytest, and schema state recorded.
2. RED: write scenarios 1-8 as gateway tests and 11 as adapter tests against absent code; observe
   each failing for the right reason.
3. GREEN: migration, then gateway module, then adapter, then agent, then Go read API.
4. REFACTOR: only after green, and never editing an assertion in the same step as implementation.
5. Mutation control as above.

## Git operations

Commit and push to `master` only after the gauntlet passes, or after the user explicitly accepts a
reported blocker.

## Completion rule

Run the gauntlet fresh, then write `EVIDENCE.md` mapping every scenario and negative constraint to a
layer or to an explicit unverified entry with its reason, and update
`docs/MT5_WINDOWS_VM_CONNECTOR_PHASE4A.md` with the repository/production status split used by the
Phase 2 and Phase 3 records.
