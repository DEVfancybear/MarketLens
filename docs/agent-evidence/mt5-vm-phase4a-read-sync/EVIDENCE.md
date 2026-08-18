# EVIDENCE — MT5 VM connector Phase 4a, increment 1

- Task: `SPEC.md` Revision 1, old-coder Tier 3, approved by the user on 2026-08-19.
- Date: 2026-08-19.
- Source state: branch `master`, on top of commit `64db349`.
- Status: **INCREMENT 1 OF 2 COMPLETE.** Phase 4a is *not* finished. See §6.
- Toolchain: Go 1.26.5, cargo 1.97.1, Python 3.13.15, PostgreSQL 17.6 (local, port 55432).

## Mandatory-tooling disclosure

Unchanged and repeated because `AGENTS.md` requires it: no `codebase-memory-mcp` server was
connected and the `old-coder` skill is not installed. The user was told before implementation and
approved proceeding. Discovery used the documented fallback. Playwright does not apply: this
increment adds no UI and no HTTP route; the substitute is the per-layer test evidence below.

## 1. What was delivered

| Layer | Artifact | Tests |
| --- | --- | --- |
| Schema | `backend/migrations/0040_mt5_vm_read_sync.{up,down}.sql` | up → down → up on a real PostgreSQL |
| Rust gateway | `backend/execution/crates/execution-gateway/src/mt5_vm_sync.rs` | 23 new, 90/90 total |
| Python adapter | `backend/bridge/mt5_vm/phase4_snapshots.py` | 17 new |

`main.rs` gains one line registering the module. No other file changed.

## 2. Migration (scenario 12) — VERIFIED

`0040` is additive: five new tables, no column added to and no constraint changed on any Phase 0-3
table. The existing `last_account_sync_at` / `last_portfolio_sync_at` / `last_instrument_sync_at`
columns from `0038` are reused as freshness anchors.

Executed against PostgreSQL 17.6 with the compiled `migrate.exe`:

```
up      -> migrate: version=40 dirty=false
down 1  -> migrate: version=39 dirty=false
up      -> migrate: version=40 dirty=false
```

`information_schema` then lists `execution_mt5_vm_account_state`, `execution_mt5_vm_positions`,
`execution_mt5_vm_pending_orders`, `execution_mt5_vm_instruments` and
`execution_mt5_vm_sync_state` alongside the five pre-existing Phase 2/3 tables.

## 3. Rust decision core — RED then GREEN

The five decision functions were written as `todo!()` stubs first. The RED run failed 19 of 21
tests by panic, for the expected reason. The functions were then implemented and the suite went to
23/23, with the pre-existing 67 gateway tests untouched (90/90 overall).

| Scenario | Test | Result |
| --- | --- | --- |
| 1 — complete snapshot replaces the set | `complete_snapshot_deletes_rows_it_does_not_mention` | PASS |
| 2 — partial never deletes | `partial_snapshot_never_deletes_and_never_advances_freshness` | PASS |
| 3 — failed never deletes | `failed_snapshot_never_deletes_and_never_advances_freshness` | PASS |
| 4 — genuinely empty stays representable | `complete_empty_snapshot_clears_the_portfolio` | PASS |
| 5 — stale lease fenced | `stale_lease_generation_is_refused`, `future_lease_generation_is_refused_as_stale_too` | PASS |
| 6 — replay fenced | `replayed_or_equal_sequence_is_refused` | PASS |
| 7 — identity mismatch | `different_server_or_login_suffix_is_rejected`, `a_missing_observed_login_suffix_cannot_satisfy_a_registered_one` | PASS |
| 10 — decimals stay strings | `decimal_strings_parse_without_binary_floating_point`, `non_decimal_transport_values_are_refused`, `a_decimal_field_rejects_a_json_number` | PASS |

Scenarios 4 and 2/3 are deliberately paired. Without scenario 4 the "never delete" rule would decay
into "never delete anything ever", and a closed position would linger forever. Both halves of
invariant 8 are pinned.

Beyond the SPEC's list, these were also pinned because they are cheap places to be wrong:

- a lease generation *ahead* of the control plane is refused, not just one behind;
- a replaced worker session is a distinct rejection from a stale lease;
- zero/negative generations and sequences are `MALFORMED_ENVELOPE`, checked before any comparison,
  so a zero sequence cannot be silently read as a replay;
- an observation timestamped in the future is `Stale`, so clock skew cannot manufacture freshness;
- a recent but non-authoritative observation is `Unknown`, never `Fresh`;
- a partial snapshot still upserts the rows it did observe.

## 4. Python normalizer — VERIFIED (scenario 11)

17 tests, all passing; the 6 pre-existing Phase 1 adapter tests still pass.

- MT5 integer enums map to stable lowercase names, and an **unknown** enum raises rather than being
  guessed or passed through (`test_unknown_enum_values_are_refused_rather_than_guessed`).
- Every decimal field leaves as a string, never in scientific notation; NaN and infinity are
  refused before they can reach a `numeric` column.
- Broker tickets leave as validated opaque strings.
- Only a masked four-digit login suffix travels; the full login never appears in an envelope
  (`test_no_credential_material_appears_in_any_envelope`).
- The collector distinguishes the three cases that invariant 8 depends on: an empty tuple is
  `complete` and empty, `None` from MT5 is `failed`, and one unusable row downgrades the family to
  `partial` while keeping the rows it could read.
- A market order type is refused by the pending-order normalizer; Phase 4a carries working orders
  only.

## 5. Negative constraints

| Constraint | Result |
| --- | --- |
| No execution or broker mutation | **Held.** The module has no order verb; the adapter only reads. |
| No new public or worker route | **Held.** No route was added in this increment. |
| No login, password, vault reference or worker id returned | **Held.** Only a masked suffix is carried; asserted by test. |
| Nothing enabled by default | **Held.** The new tables stay empty without a live worker; no configuration was added. |
| Additive migration only, no renumbering | **Held.** Verified by the down/up cycle. |
| No claim that a Phase 1/2/3 gate is closed | **Held.** See §6. |
| Partial/failed may not delete or advance freshness | **Held.** Scenarios 2 and 3. |

## 6. What is NOT done — Phase 4a increment 2

This is the honest boundary. Phase 4a is **not** complete:

- **The SQL ingestion transaction is not written.** The decision core is tested but not yet called
  from a database transaction, so nothing writes to the five new tables. The module carries an
  explicit `#![allow(dead_code)]` with a comment saying so, rather than hiding it.
- **The owner-scoped Go read API is not written.** SPEC scenarios **8 (cross-user isolation)** and
  **9 (no secret or internal identifier in a read response)** are therefore **UNVERIFIED**; both
  live in that layer.
- **The `InstrumentSnapshot` agent message kind was not added.**
- **`tools/verify-mt5-phase4a.ps1` was not written**, so there is no single rerunnable entry point
  yet; the commands used are listed in §7.
- **Mutation control was not performed.** The SPEC requires three deliberate regressions; none were
  run.

Stopping here was a deliberate call: the remaining work is a few hundred lines of transactional SQL
plus an HTTP surface in a live-trading system, and rushing it at the end of a long session is how
data-destroying bugs land. The decision core it depends on is finished and pinned, which is the part
that carries invariant 8.

## 7. Commands used

```bash
# schema, against the local PostgreSQL 17.6 on port 55432
backend/bin/migrate.exe up ; backend/bin/migrate.exe down 1 ; backend/bin/migrate.exe up

# rust
cd backend/execution && cargo test --locked -p execution-gateway

# python
cd backend && python -m unittest bridge.mt5_vm.test_phase4_snapshots
cd backend && python -m unittest bridge.mt5_vm.test_phase1_adapter

# go regression
cd backend && go vet ./... && go test ./...
```

## 8. Explicitly not verified

- **Formatting is verified, but not through `cargo fmt`.** `cargo-fmt` is blocked by this host's
  Application Control policy (`os error 4551`); the `rustfmt` binary itself is not. Running
  `rustfmt --edition 2024 --check` over every tracked `.rs` file in `backend/execution` reports the
  whole workspace clean.

  This was corrected after the fact: the first push of this increment claimed formatting had been
  matched by hand, and CI's `cargo fmt --all -- --check` rejected it with six hunks in
  `mt5_vm_sync.rs`. The file was then formatted with `rustfmt` directly and the workspace
  re-checked. The gate worked exactly as intended; the lesson is recorded in
  `docs/KNOWN_ISSUES.md` so the next agent uses `rustfmt` instead of hand-matching.
- **Any live MT5 terminal, broker connection or real account data.** None available.
- **The Phase 4 exit gate** (independent terminal/web comparison across disconnect, reconnect and
  cold-cache history). Out of scope by SPEC and impossible here.
- **Phase 1/2/3 operational gates remain open and untouched.** Phase 1 is still BLOCKED at the
  real-terminal gate (`MT5_IPC_TIMEOUT`). Nothing in this increment changes that, and nothing here
  should be read as progress toward it.
- **End-to-end worker → gateway → API flow.** Not reachable until increment 2.
