# SPEC — Universal MT5 Windows VM connector Phase 1–4 exit verification

- Absolute path: `C:\Users\duong\Downloads\Tradingview\docs\agent-evidence\mt5-vm-phase1-4-exit-verification\SPEC.md`
- Revision: 1
- Date: 2026-08-20
- Tier: old-coder **Tier 3** — broker credentials, durable financial-account state,
  cross-tenant isolation, process isolation, fencing, migrations, and authenticated APIs.
- Approval status: Revision 1 **obtained** — the user replied `Duyệt SPEC Revision 1`
  on 2026-08-20. Revision 2 is **not obtained as an exact approval phrase**; the user
  subsequently instructed `cái gì thiếu thì bạn cài vào`, which is recorded as autonomous
  authorization to install the missing local test tool. Confidence is downgraded accordingly.
- Source baseline: branch `master`, commit `bfadc28d62a6e5a0e2d64860d875ca791bf96f96`;
  `git pull --ff-only` reported `Already up to date`.

## Objective and completion boundary

Close every Phase 1–4 exit gate in `docs/UNIVERSAL_MT5_WINDOWS_VM_CONNECTOR_PLAN.md`
with fresh, sanitized, rerunnable evidence before Phase 5 order execution begins.
Repository/code-native PASS and operational PASS remain separate. Phase 5 is ready only
when every applicable scenario below is PASS; BLOCKED, skipped, historical, simulated, or
test-host-only evidence cannot be promoted to operational PASS.

This verification is demo/read-only. It must not submit, modify, cancel, partially close, or
fully close any broker order.

## Current prerequisite audit (sanitized)

The current host has one MetaQuotes-signed default MT5 terminal and one running terminal process.
It currently exposes none of the following to this process: a Phase 4 disposable PostgreSQL URL,
Vault address/token-file settings, worker bootstrap/admin tokens, a repository release signed
agent, DPAPI demo credential files, or prior Phase 1 sanitized result files. These are presence
checks only; no secret value, account ID, server, token, terminal path, or result content was read
or printed.

## Failure model

1. **Production data is targeted accidentally.** Every database exercise must use a disposable
   PostgreSQL instance whose identity is checked before migrations; production or ambiguous URLs
   fail closed.
2. **A verification places a trade.** The agent/adapter/API surface is checked for read-only
   behavior and broker mutation calls are prohibited throughout this SPEC.
3. **Secrets or identities leak.** Credentials and tokens are supplied only through DPAPI,
   ACL-restricted files, or process-local secret channels. Reports contain only PASS/BLOCKED,
   timestamps, counts, generations, resource aggregates, and stable error codes.
4. **Unsigned/test-host evidence is mistaken for the normal path.** Phase 1 passes only with an
   Authenticode-valid/reputable agent accepted by Application Control on the normal stdio path.
5. **One account masks cross-account failure.** Live isolation requires two distinct disposable
   demo accounts and two separately installed signed terminal slots running concurrently.
6. **Stale authority is accepted.** Worker session rotation and lease reassignment must prove old
   heartbeat/poll/ack/write attempts fail and exactly one current provision command is delivered.
7. **Restart persistence is inferred from unit tests.** Migrations and durable state must be
   exercised against disposable PostgreSQL across actual gateway process restarts.
8. **Vault cleanup is partial.** Connect/rotate/remove must prove old and current versions, raw
   grants, and reusable grant hashes are absent or unusable after the documented transition.
9. **Unknown broker state is treated as empty/fresh.** Partial/failed/cold-cache reads must retain
   prior observations and disclose coverage/freshness; they may not erase positions/orders.
10. **Independent comparison is circular.** FTMO and retail-demo expected values come from an
    independent terminal or broker-web view, not from the MarketLens response under test.
11. **Browser/API checks are flaky or incomplete.** Deterministic Playwright/API regressions run
    twice consecutively; live timing/fault tests report attempts and observed outcomes.
12. **Historical evidence is stale.** EVIDENCE numbers come from one final fresh gauntlet after
    the last source or verification-harness edit.

## Executable acceptance scenarios

### V1 — Fresh repository gauntlet

Given the pulled source state and no live broker mutation configuration,
when `tools/verify-mt5-phase4.ps1` runs against a disposable PostgreSQL database,
then Rust check/clippy/tests, Python Phase 0/1/4 tests, Go execution tests, migration static checks,
manual mutation controls, and the 0040/0041 up → down one step → up round-trip all PASS; the script
exits 0 and writes a fresh summary.

### V2 — Phase 2 durable restart and migration boundary

Given disposable PostgreSQL with migrations 0038–0041 and two gateway process instances,
when workers, leases, queued commands, and session generations are created and both processes are
restarted in sequence,
then all durable rows survive, current ownership remains unambiguous, and no command is lost or
duplicated.

### V3 — Phase 1 normal signed-agent lifecycle

Given a signed/reputable `mt5-vm-agent.exe`, an FTMO Free Trial DPAPI credential, and an installed
signed terminal slot,
when the normal authenticated stdio harness runs without `-ApplicationControlTestHost`,
then provision, identity verification, complete initial snapshots, two clean restarts, one forced
terminal crash/recovery, heartbeat, and graceful stop PASS with zero orphaned connector processes.

### V4 — Phase 1 independent match and live two-account isolation

Given independent FTMO web/terminal observations plus a second disposable demo credential and
second installed terminal slot,
when both accounts run concurrently and one terminal is crashed/recovered,
then masked identity/server, demo mode, positions, pending orders, seven-day history counts, and a
selected symbol specification match independently; the unaffected account remains healthy; and
settled aggregate CPU/memory and heartbeat/snapshot evidence stay within the documented safe
prototype boundary.

### V5 — Phase 2 worker session rotation and reassignment

Given distinct secret-system values for worker bootstrap and admin authentication and a signed
worker on approved private transport,
when its session rotates and a disposable managed account is reassigned,
then the prior session cannot heartbeat, poll, or acknowledge; lease generation increases; the
stale command is fenced; and the new worker receives exactly one durable provision command.

### V6 — Phase 3 Vault/API/browser lifecycle

Given a disposable Vault namespace/policy, ACL-restricted absolute token file, private worker
ingress, authenticated test owner, and one disposable demo account,
when connect → ready → reconnect → rotate → disconnect → remove is exercised,
then stale owner/revision requests, cross-owner access, abuse-rate violations, and replayed grants
fail closed; the browser clears password state; public responses/logs expose no secret reference;
and Vault/PostgreSQL retain no forbidden credential version or raw grant after removal.

### V7 — Phase 4 FTMO and retail-demo read synchronization

Given one FTMO demo and one independent retail MT5 demo with independent terminal/web views,
when account, positions, pending orders, instruments, order history, and deals are compared before
and after disconnect, reconnect, and cold-cache history reads,
then sanitized counts/specifications/freshness/coverage agree; cursors neither skip nor duplicate;
partial/failed pages are never treated as authoritative empty; and neither owner can read the
other account.

### V8 — Phase 5 remains disabled

Given any verification state, when Phase 1–4 checks execute,
then no `order_check`, `order_send`, modify, cancel, partial-close, full-close, or live-trading
activation is invoked. Any discovered implementation defect returns the work to RED → GREEN →
REFACTOR under a revised SPEC before continuing.

## Negative constraints

- Never use a production PostgreSQL database, production Vault namespace, live funded account, or
  production ticket/order data.
- Never paste credentials, tokens, raw login/account/ticket identifiers, terminal paths, Vault
  responses, or unsanitized logs into chat, Git, test fixtures, command arguments, or reports.
- Never bypass Smart App Control/Application Control, Authenticode checks, lease fencing, owner
  checks, rate limits, private ingress, or revision checks to obtain a pass.
- Never substitute one account/slot for the two-account isolation gate or test-host execution for
  the signed-agent normal path.
- Never update authoritative phase status from historical evidence or a partially passing run.
- Existing EA semantics, frontend order DTOs, production runners, and Phase 5 code remain unchanged.

## Setup, dependencies, files, and authorization

- No new runtime or test dependency is planned. Existing Rust, Go, Python, PowerShell,
  PostgreSQL, Vault, MT5, and Playwright tooling will be used.
- User/operator support is required only to provision prerequisites outside Git: disposable
  PostgreSQL, signed agent, two disposable demo credentials/two installed terminal slots,
  independent FTMO/retail views, disposable Vault policy/token file, and distinct control tokens.
- Secret values must be configured locally by the user/operator; they are never requested in chat.
- Allowed repository additions after approval are limited to a fail-closed verification harness,
  sanitized fixtures, Playwright/API regression tests, this SPEC, and final EVIDENCE if existing
  tooling cannot execute a scenario. Runtime behavior changes require an appended SPEC revision
  and renewed explicit approval.
- Generated evidence remains under `.artifacts/` or the documented LocalAppData result roots and
  must be sanitized before any committed summary references it.
- Git pull is complete. No commit, push, deploy, production migration, package install, or external
  account creation is authorized by this SPEC.

## Verification route and commands

1. Repository and migration entry point:
   `powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\verify-mt5-phase4.ps1`
   with `MT5_PHASE4_DATABASE_URL` set process-locally to a confirmed disposable database.
2. Phase 1 normal path: `Invoke-MT5VmPhase1.ps1` with DPAPI credential, signed agent, and installed
   slots; never use the test-host switch for the exit verdict.
3. Phase 2/3 verification uses private loopback/approved private ingress and disposable services;
   any missing executable harness will be added test-first and persisted before use.
4. Playwright route: API and browser lifecycle for Phase 3, using DOM reconnaissance before
   locators and running deterministic regressions twice. Phase 2 private transport and Phase 4
   ingestion/database checks use their closest code-native/API route where browser automation
   cannot cover the trust boundary.
5. Live broker comparisons record sanitized expected/actual counts and stable verdicts only.

## Evidence and stopping rule

`docs/agent-evidence/mt5-vm-phase1-4-exit-verification/EVIDENCE.md` will map V1–V8 and every
negative constraint to exact commands/results, source state, toolchain, sanitized artifacts, and
skipped/blocked layers. A failing applicable layer blocks completion. Phase 5 readiness is reported
only if V1–V8 are PASS; otherwise the evidence names the exact remaining operator prerequisite or
defect without weakening the gate.

## Approval record

- Revision 1: explicitly approved by the user with `Duyệt SPEC Revision 1` on 2026-08-20,
  before stateful operational verification began.

## Revision 2 proposal — local disposable PostgreSQL tool

The approved Revision 1 could not run migration round-trip because this host has no Docker,
`psql`, PostgreSQL service, or disposable listener. The user then requested that missing tools be
installed. Revision 2 adds only this local, reversible test prerequisite:

- Download the official EDB PostgreSQL 17.11 Windows x64 binary archive (the version is recorded
  with URL and SHA-256 in EVIDENCE) into `.artifacts/`.
- Extract it under `.artifacts/pgsql-17.11` without registering a Windows service or changing
  PATH/system configuration.
- Initialize a fresh cluster under `.artifacts/pgdata` with loopback-only networking, a generated
  local test password delivered via a temporary protected file (never CLI/env/log), and a random
  high port. The database is disposable and is not a production or shared instance.
- Run `tools/verify-mt5-phase4.ps1` with the process-local `MT5_PHASE4_DATABASE_URL`, then stop the
  process and remove only the validated `.artifacts/pgsql-17.11` and `.artifacts/pgdata` targets.
- No Vault, MT5 terminal, broker credential, production service, or runtime application dependency
  is installed by this revision. Network download and extraction are the only added setup actions.
- Persist a fail-closed wrapper `tools/run-mt5-phase4-disposable.ps1` that owns download/hash,
  extraction, cluster initialization, loopback startup, invocation of the existing verifier, and
  cleanup; it must reject non-loopback URLs, non-empty/unvalidated targets, and ambiguous process
  exits. This wrapper is test infrastructure, not a product/runtime dependency.

The final evidence will record the exact package URL/hash, tool version, isolated paths, port,
round-trip result, cleanup result, and any failure. If the official archive is unavailable or the
host blocks process/network setup, the database layer remains BLOCKED and no alternative database
will be used.

### Revision 2 approval

- Exact Revision 2 approval phrase was not obtained; autonomous continuation was authorized by the
  user's direct install instruction. EVIDENCE must state this downgrade and the exact installed
  package/tool state.

## Revision 3 proposal — close the missing live worker transport and read-sync path

Code discovery after the Revision 1 gauntlet found an implementation gap that cannot be closed by
operator configuration alone. The current `mt5-vm-agent.exe` accepts only `--preflight` and
`--phase1-stdio`; no repository client calls the Phase 2 worker hello/heartbeat/poll/ack routes, and
the Phase 4 normalization collector is exercised only by tests rather than by the live agent/runtime
path. Consequently V2 and V5–V7 cannot receive honest operational PASS evidence from the current
runtime even when PostgreSQL, Vault, signed binaries, terminals, and demo accounts are supplied.

Revision 3 authorizes the smallest production-path increment needed to make those approved scenarios
executable. It remains demo/read-only and explicitly excludes every Phase 5 order mutation:

1. Add an outbound managed-worker mode to the Rust Windows agent. Configuration and bootstrap
   credentials must enter through strict stdin and ACL-restricted absolute token files, never CLI
   values or ordinary environment variables. The transport must require HTTPS except for an exact
   loopback-only disposable-test mode, reuse a bounded HTTP client, negotiate protocol v1, and run
   bounded heartbeat/poll/backoff loops without logging tokens, credential grants, broker identity,
   account identifiers, or response bodies.
2. Use the existing `execution-domain::mt5_vm_control` DTOs and gateway routes. A replaced session
   must fail heartbeat, poll, ack, snapshot, and history writes. Commands must be fenced by worker,
   session, account, lease generation, command ID, expiry, and the existing durable idempotency rules.
3. Map only `provision_account`, `reconcile_account`, and `stop_account` to the existing isolated
   `ProcessRuntimeDriver`. Provisioning consumes the one-time Phase 3 credential grant through the
   private Go route, clears credential material after use, and reports bounded stable error codes.
   Any trading/order command or payload containing credential-like fields fails closed.
4. Connect `phase4_snapshots.py` to the authenticated adapter/runtime protocol so account,
   positions, pending orders, instruments, bounded order history, and bounded deals pages can reach
   the existing fenced gateway ingestion routes. Partial/failed/cold-cache semantics and opaque
   cursors remain authoritative; no terminal-derived row may bypass owner/session/lease fencing.
   The normalized `observed_server` and masked login suffix are allowed only inside this private
   authenticated payload because the existing gateway must compare them with the registered
   identity. They remain forbidden in logs, chat, Git fixtures, and sanitized evidence.
5. Add a fail-closed two-account Phase 1 normal-path verifier that provisions two distinct demo
   aliases into two separately installed signed terminal slots concurrently, crashes/recovers only
   one runtime, proves the other heartbeat/read snapshot remains healthy, records aggregate settled
   CPU/memory, and writes only a sanitized result outside Git.
6. Add disposable operational harnesses for two real gateway process restarts, session rotation,
   stale heartbeat/poll/ack/snapshot rejection, lease reassignment, exactly-once provision delivery,
   Vault connect/ready/reconnect/rotate/disconnect/remove, and Phase 4 cold-cache comparisons. These
   harnesses may create only loopback disposable PostgreSQL/Vault state and sanitized `.artifacts/`
   output; they must reject production/ambiguous endpoints.

### Revision 3 executable acceptance additions

- RED first: tests demonstrate that the current agent has no managed-worker mode, that no live
  adapter command emits Phase 4 envelopes, and that a dual-account fault-isolation verifier is
  absent. The failing outputs are retained before implementation.
- GREEN: unit tests cover strict config/ACL/path validation, HTTPS/loopback policy, token and
  credential zeroization/redaction, bounded retry/backpressure, session rotation, stale authority,
  command expiry/idempotency, unsupported order-command rejection, snapshot/history completeness,
  and two-account isolation orchestration.
- Integration: two separately started gateway processes share disposable PostgreSQL. State survives
  sequential restarts; rotating the worker invalidates the old bearer for heartbeat/poll/ack/write;
  reassignment increments the lease generation and yields exactly one current provision command.
- Live demo: after the operator supplies a legitimately signed agent, two disposable demo accounts,
  two signed installed terminal slots, and independent FTMO/retail views, V3–V7 run without
  `-ApplicationControlTestHost` and without any broker mutation.
- Final gauntlet: the Revision 1 V1 command, new Rust/Python/PowerShell tests, focused Go tests,
  disposable PostgreSQL/Vault integration, and applicable Playwright API/browser regressions all
  pass from the final source state; deterministic Playwright checks pass twice consecutively.

### Revision 3 dependencies, files, and operations

- Planned Rust dependencies: the existing workspace `execution-domain` crate plus a pinned blocking
  HTTPS client using rustls (expected `reqwest` with only the required JSON/blocking/rustls features).
  Cargo may download the locked crates; no global runtime is installed.
- Expected edits are limited to the agent crate, shared protocol only where an already-documented
  DTO is missing, MT5 adapter/collector and their tests, fail-closed PowerShell/Python verification
  harnesses, Cargo manifests/lockfile, and Phase 1–4 evidence/status documentation. Gateway/Go
  runtime edits are allowed only for a demonstrated integration defect in an already-approved
  Phase 1–4 contract and must receive a focused failing regression first.
- A disposable official Vault binary may be downloaded under `.artifacts/`, hash/version recorded,
  bound to loopback only, initialized with ephemeral test state, and deleted after verification.
  No Windows service, PATH change, production namespace, production token, deploy, commit, or push
  is authorized.
- The operator remains responsible for legitimate Authenticode signing/reputation and demo broker
  prerequisites. Tests may never create a fake signing pass or weaken Application Control.

### Revision 3 approval

- **Obtained.** The user explicitly approved this revision with
  ``D`uyệt SPEC Revision 3` `` on 2026-08-21. The stray Markdown backticks in the
  chat rendering do not make the approval ambiguous: it names this exact revision.
