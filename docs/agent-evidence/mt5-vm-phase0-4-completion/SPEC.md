# SPEC — Universal MT5 Windows VM connector Phase 0–4 completion audit

- Absolute path: `C:\Users\duong\Downloads\tradingview\docs\agent-evidence\mt5-vm-phase0-4-completion\SPEC.md`
- Revision: 1
- Tier: old-coder **Tier 3** — durable financial-account observations, cross-tenant isolation,
  worker concurrency/fencing, credentials, and authenticated APIs.
- Spec approval: **obtained**. The user approved this exact revision before implementation.

## Startup and source state

- Repository: `C:\Users\duong\Downloads\tradingview`
- Branch/source state at audit start: `master` at
  `c09bc8db3ee99a2dc9d61d24a4f3acc0c9933556`; worktree clean.
- `codebase-memory-mcp` is unavailable in this session. The mandatory fallback was used:
  `docs/CODEBASE_MEMORY.md`, the authoritative connector plan, Phase 0–4 records, relevant
  architecture/runbook documents, and exact current source files were read directly.
- The installed `old-coder` and `playwright-automation` skills were read before this SPEC.

## Audit conclusion and phase boundary

This task does not rewrite historical evidence or turn unperformed live checks into passes.

| Phase | Repository status | External/operational status | Action in this SPEC |
| --- | --- | --- | --- |
| 0 | Complete | Credentialed read-only FTMO probe recorded PASS | Re-run non-secret regression gates; no feature work |
| 1 | Prototype implemented | Conditional: signed normal-agent run, independent FTMO comparison, and live two-account isolation remain | Reconcile contradictory docs and produce an exact operator checklist; do not fake evidence |
| 2 | Control-plane slice implemented | Activation-gated: disposable PostgreSQL restart and signed-worker rotation/reassignment remain | Re-run repository gates; document operator procedure and required evidence |
| 3 | Vault/API/UI slice implemented | Disabled by default; Vault/deployment lifecycle exercise remains | Re-run repository gates; document operator procedure and required evidence |
| 4 | Incomplete | Exit gate requires licensed terminals and two independent demo views | Finish the inert repository implementation for 4a and 4b, then document the live validation still required |

Phase 4 repository work may be implemented only as an inert, disabled-by-prerequisite slice. It
does not override the plan rule that operational rollout remains blocked by the earlier gates.

## Failure model

1. **Stale or replaced worker writes observations.** Exact worker token, worker-session generation,
   account lease generation, worker/account binding, expiry, and monotonic sequence are checked in
   the same SQL transaction that writes rows.
2. **Unknown is mistaken for empty.** Partial/failed snapshots may upsert observed rows but may
   never delete absent rows or advance authoritative freshness. A complete empty snapshot must
   still delete the previously stored set.
3. **Half a portfolio is reported fresh.** `last_portfolio_sync_at` advances only when both
   `positions` and `pending_orders` have authoritative complete observations; its value is derived
   conservatively from the older of the two family anchors.
4. **Cross-user data leaks.** Every public read is owner-injected by Go, rechecked by Rust/Postgres,
   and tested with two owners using colliding-looking account/ticket data.
5. **Credentials or infrastructure identifiers leak.** Snapshot DTOs, stored normalized rows, API
   responses, logs, and fixtures contain no password, raw login, secret/vault reference, worker
   token, worker ID, terminal path, internal address, or MT5-native payload.
6. **Replay or pagination duplicates corrupt state.** Family sequences are monotonic; history rows
   use stable account-scoped broker keys; repeated pages are idempotent and cannot regress cursor
   coverage.
7. **History gaps are called complete.** Orders/deals history records explicit requested window,
   covered-through boundary, result, and opaque cursor. A failed/partial page cannot extend
   authoritative coverage, and reads disclose unknown/stale/incomplete windows.
8. **Unbounded broker payload exhausts the gateway.** Request body size, rows per snapshot/page,
   identifier sizes, history window, and read page limits are bounded and fail closed.
9. **Identity mismatch advances readiness.** Account server and masked suffix mismatch returns a
   typed non-secret error, records a failed sync outcome, and changes no normalized account row or
   freshness anchor.
10. **Clock skew manufactures freshness.** Future observations and observations outside the bound
    are never classified fresh.

## Repository implementation scope

### A. Phase 4a increment 2 — ready-state families

1. Add strict Rust DTOs and private routes for worker snapshot ingestion. Reuse the existing
   Phase 2 bearer-session authentication; do not add a public worker route.
2. Implement one PostgreSQL transaction per family submission:
   lock/authenticate the worker and current lease, lock the family high-water row, call the tested
   decision rules, parse all decimal strings before SQL binding, upsert observed rows, reconcile
   deletions only for `complete`, update sync state, and advance freshness only when authoritative.
3. For `positions`/`pending_orders`, compute the shared portfolio freshness only after both family
   states are complete; never let one family make the portfolio fresh alone.
4. Add an admin-only, owner-scoped Rust read route returning account, positions, pending orders,
   instruments, per-family outcomes, timestamps, error codes, and freshness verdicts. Rows are
   deterministically ordered.
5. Add a Go client method and authenticated public read route below
   `/api/v1/execution/connectors/accounts/:accountId`, with owner identity injected from the active
   session. Public DTOs contain no internal identifiers.
6. Add `InstrumentSnapshot` to the authenticated `mt5-vm-agent` protocol and pin its wire name and
   HMAC round trip in tests.
7. Remove `#![allow(dead_code)]` from `mt5_vm_sync.rs` once production wiring calls the module.

### B. Phase 4b — orders, deals, history and cursor semantics

1. Add additive migration `0041_mt5_vm_history_sync` for normalized order history, deals, and
   per-family history coverage/cursor state. The down migration drops only 0041 objects.
2. Extend the Python read-only normalizer with `history_orders_get` and `history_deals_get` page
   normalization. Decimal values remain plain strings, tickets remain opaque strings, enums stop
   in Python, and `None`/exceptions are failed rather than empty.
3. Add bounded, strict Rust worker ingestion for `orders_history` and `deals`; upserts are
   idempotent. A complete page advances only its explicitly covered window. Partial/failed pages
   retain observed rows but cannot extend authoritative coverage. Historical ingestion never
   deletes records outside the exact declared authoritative window.
4. Add owner-scoped, bounded history reads with `fromMs`, `toMs`, `limit`, and an opaque cursor.
   Invalid/replayed/tampered cursors fail closed. The response states coverage/freshness explicitly.
5. Add agent message kinds for the two history families and tests for stable wire names,
   authentication, frame limits, and redacted debug output.

### C. Documents and operator handoff

1. Reconcile the contradictory Phase 1 wording (`credentialed lifecycle PASS/conditional` versus
   `MT5_IPC_TIMEOUT/BLOCKED`) using current evidence. Preserve history; state exactly which path
   passed, which normal path is blocked, and which result is newest.
2. Update the authoritative plan and related progress/handoff/phase documents only from fresh test
   evidence. Repository-complete and operationally-complete remain separate statuses.
3. Create a secret-safe operator checklist for every remaining Phase 1–4 external gate, including
   commands, expected sanitized evidence, and stop conditions. It must never ask the user to paste
   credentials, tokens, raw logs, account numbers, or ticket IDs into chat or Git.

## Executable acceptance scenarios

1. `complete_snapshot_replaces_exact_family_set`: two stored rows plus a complete one-row snapshot
   leaves exactly that row.
2. `partial_and_failed_never_delete_or_advance`: partial/failed empty submissions keep all rows and
   do not advance authoritative freshness; the stable error code is retained.
3. `complete_empty_snapshot_clears_set`: a complete empty snapshot clears positions/pending orders.
4. `portfolio_requires_both_families`: complete positions with stale/failed pending orders leaves
   portfolio non-fresh; after a complete pending-order snapshot it becomes fresh at the older
   family timestamp.
5. `worker_fences_are_atomic`: stale lease, replaced session, expired heartbeat, wrong worker,
   zero generation, and replayed sequence each return a typed error and leave every target table
   byte-for-byte logically unchanged.
6. `identity_mismatch_is_non_authoritative`: wrong server or masked suffix records the typed failed
   result but does not modify account state or account freshness.
7. `cross_owner_read_and_write_isolation`: owner A cannot read B; a worker leased to A cannot write
   B; same ticket text in both accounts remains isolated.
8. `public_response_is_redacted`: recursively inspecting JSON finds none of the forbidden secret or
   infrastructure fields/values.
9. `decimal_and_ticket_transport_types`: every decimal and broker ticket is a JSON string at the
   Python→Rust and Rust→Go boundaries; JSON numbers/scientific notation/NaN/infinity fail.
10. `instrument_snapshot_protocol_is_stable`: authenticated frame round-trip accepts the exact
    `instrument_snapshot` wire kind and tamper/replay tests reject changes.
11. `history_empty_vs_failed`: complete empty history advances declared coverage with zero rows;
    `None`, exception, or unusable row yields failed/partial and does not advance coverage.
12. `history_page_is_idempotent`: ingesting the same page twice either returns replay/idempotent
    acknowledgement without duplicating rows; a later valid page advances coverage monotonically.
13. `history_cursor_is_bounded_and_tamper_evident`: limits and windows outside the contract are
    rejected; a modified cursor is rejected; pages neither skip nor duplicate the deterministic
    `(event_time, broker_ticket)` order.
14. `migration_0040_and_0041_round_trip`: on disposable PostgreSQL, 0040/0041 up, down to 0039,
    and up again leave the expected version/schema with no mutation to Phase 0–3 tables.
15. `phase0_to_phase3_regression`: existing Phase 0/1 Python, agent Rust, gateway Rust, Go, frontend
    type/i18n, and applicable connector tests retain zero new failures.

## Negative constraints

- No broker mutation call (`order_check`, `order_send`, modify, cancel, or close) is added.
- No Phase 5 durable execution path or live-trading enablement is added.
- No broker-name branch is introduced in normalization, routing, risk, or frontend code.
- No plaintext credential, raw login, secret/vault reference, worker token, internal path/address,
  or unsanitized broker/account/ticket evidence is stored or returned.
- No partial/failed snapshot deletes rows or advances authoritative freshness/coverage.
- No one-sided positions/pending-orders update can make the portfolio fresh.
- No worker/adapter/terminal port becomes public; the existing loopback/private boundaries remain.
- No existing migration is renumbered or edited incompatibly; 0041 is additive.
- No frontend behavior, production runner, deploy script, legacy EA semantics, or default feature
  activation is changed unless a failing acceptance test proves it is necessary and the SPEC is
  explicitly revised and re-approved.
- No Phase 1–4 live/operational gate is reported PASS without fresh external evidence.

## Planned files and tools

Expected edits/additions are limited to:

- `backend/execution/crates/execution-gateway/src/mt5_vm_sync.rs` and route registration as needed;
- `backend/execution/crates/mt5-vm-agent/src/protocol.rs` and minimal transport wiring/tests;
- `backend/bridge/mt5_vm/phase4_snapshots.py` and its test file;
- `backend/internal/execution/mt5_connector_{client,handler}.go` and tests;
- `backend/migrations/0041_mt5_vm_history_sync.{up,down}.sql`;
- a persisted PostgreSQL integration-test/fixture boundary if the existing harness has none;
- `tools/verify-mt5-phase4.ps1` plus auditable mutation-control support;
- connector plan, Phase 1–4 records, progress/handoff/changelog/known-issues, and final `EVIDENCE.md`.

No new runtime dependency is planned. Existing Rust (`sqlx`, `serde`, `rust_decimal`), Go/Fiber,
Python standard library/MetaTrader5, PostgreSQL, and Playwright installations are sufficient.
No package install, credential creation, production deploy, commit, push, or external mutation is
authorized by this SPEC.

## RED → GREEN → REFACTOR sequence

1. Record focused baselines without changing assertions.
2. Add tests for scenarios 4–13 and observe each fail for the intended missing behavior. Existing
   Phase 4a pure tests that already pass remain regression armor; use a throwaway mutant to prove
   their sensitivity rather than claiming a new RED.
3. Implement 4a ingestion/read/protocol in small GREEN checkpoints; never edit tests and
   implementation in the same step.
4. Add 0041 and Phase 4b tests RED, then implement history normalization/ingestion/read GREEN.
5. Refactor with assertions frozen and rerun focused suites after each refactor.
6. Run mutation controls, the final gauntlet, and then write EVIDENCE from one fresh run.

## Verification gauntlet

Single rerunnable entry point:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\verify-mt5-phase4.ps1
```

The fail-closed script will remove stale reports and run:

1. migration 0040/0041 up → down-to-0039 → up on disposable PostgreSQL, with schema assertions;
2. Rust format/check/clippy/tests for `execution-gateway` and `mt5-vm-agent`;
3. Python Phase 0/1/4 tests;
4. Go format/vet/tests, including Fiber HTTP integration tests;
5. changed-line coverage where repository tooling can enforce a nonzero threshold;
6. property/adversarial tests for decimal strings, sequences, bounds, cursor tampering, ownership,
   and partial/failed snapshots;
7. mutation testing via `cargo-mutants` if already installed; otherwise a persisted manual runner
   applying at least five verified-executed mutants: partial-delete, dropped lease fence, dropped
   identity check, one-sided portfolio freshness, and partial-history coverage advance;
8. secret/capability/diff hygiene and intended-file allowlist;
9. a realistic loopback execution of Rust admin/worker routes plus Go Fiber handler tests.

Playwright route selection: this change adds no browser UI and its public API requires the Go
session/Vault plus private Rust worker boundary. The deterministic verification is the existing Go
Fiber `httptest` integration route and Rust HTTP/real-PostgreSQL route tests, which exercise the
actual API handlers without browser selector or UI state. Playwright UI E2E is therefore recorded
as not applicable unless implementation unexpectedly changes a browser-visible flow; if that
happens, this SPEC must be revised and the relevant Playwright API/UI regression added and run
twice consecutively.

## Completion and blocking rule

- A failing applicable gauntlet layer blocks completion.
- `EVIDENCE.md` maps every scenario and negative constraint to a fresh result, identifies toolchain
  and source state, and lists every skipped/unverified layer honestly.
- Repository completion may be reported separately from external operational completion.
- The final handoff must tell the user exactly which secret-safe host/VM/MT5/Vault actions remain
  and wait for their resulting sanitized PASS/BLOCKED status before proceeding to Phase 5.

## Approval record

- Revision 1 was explicitly approved by the user with `Duyệt SPEC Revision 1` on 2026-08-20,
  before any implementation file was edited.
