# MT5 Windows VM connector Phase 1 validation

- Status: **prototype implemented; live FTMO gate blocked**
- Review date: 12 August 2026
- Scope: local secure multi-runtime worker prototype and read-only lifecycle validation
- Execution: account reads only; no order mutation surface

This document separates repository-complete work from the Phase 1 exit gate. The
Rust/Python prototype and its isolated tests pass, but Phase 1 is not complete
until the credentialed lifecycle harness passes on the real FTMO Free Trial and
the snapshots are independently compared with FTMO web.

## 1. Implemented prototype

The repository now contains:

- an HMAC-SHA256 authenticated, versioned stdio control protocol with bounded
  frames, expiry, monotonic sequence/replay rejection, account/worker/lease
  binding, and redacted debug output;
- a bounded FIFO command lane per account, lease/expiry checks, an explicit
  runtime state machine, deterministic startup throttling, and a conservative
  four-terminal default;
- per-runtime Windows Job Object process/memory limits, restrictive ACL and
  reparse-point validation, pinned terminal/Python/adapter artifacts, and an
  isolated terminal data directory;
- a single-account Python adapter that accepts credentials only through stdin,
  serializes MT5 access, publishes identity/account/portfolio/history/symbol
  snapshots, supports heartbeat and graceful stop, and contains no network or
  trade-mutation API;
- a local scheduler simulator and PowerShell entrypoint that exercise provision,
  two clean restarts, forced terminal crash recovery, heartbeat, and graceful
  stop without writing unsanitized results into Git.

This is a local prototype boundary. It is not the durable Phase 2 scheduler,
outbound production control-plane transport, public account-connect API, vault,
or order-execution path.

## 2. Verification completed

| Check | Result |
| --- | --- |
| Rust `mt5-vm-agent` tests | `PASS` — 21 passed |
| Python Phase 1 adapter/harness tests | `PASS` — 9 passed |
| Authenticated frame tamper/replay/expiry/cross-account rejection | `PASS` by unit tests |
| Bounded queues, startup throttle, stale lease and idle no-poll behavior | `PASS` by unit tests |
| Fake-driver two-restart/forced-crash lifecycle | `PASS` by Rust unit test |
| Credential/debug redaction and read-only adapter AST boundary | `PASS` by unit tests |
| Effective per-instance MCP disable/unique endpoint | `PASS` — runtime and MT5 instance configs agree |
| Failed-initialize no-orphan regression | `PASS` — adapter and unregistered terminal child are reaped |
| Credentialed real-terminal lifecycle | `BLOCKED` — `MT5_IPC_TIMEOUT` |
| Independent FTMO web snapshot comparison | `PENDING` |
| Live cross-account isolation and idle-load observation | `PENDING` |

Commands used for the repository checks:

```powershell
& "$env:USERPROFILE\.cargo\bin\cargo.exe" test `
  --manifest-path backend/execution/Cargo.toml `
  -p mt5-vm-agent --all-targets

backend\.venv-mt5\Scripts\python.exe -m unittest `
  backend.bridge.mt5_vm.test_phase1_adapter `
  backend.bridge.mt5_vm.test_phase1_control_harness -v
```

## 3. Live gate attempt and blocker

On 2026-08-12 the credential-safe FTMO Free Trial harness was run with:

```powershell
.\backend\bridge\mt5_vm\Invoke-MT5VmPhase1.ps1 `
  -AccountAlias ftmo-free-trial
```

The result was written outside the repository under
`%LOCALAPPDATA%\MarketLens\phase1-results` and returned:

```text
BLOCKED: MT5_INITIALIZE_FAILED
```

The isolated terminal log showed repeated loopback MCP bind conflicts followed
by an MT5 IPC initialization failure. The failed start also left the isolated
runtime terminal alive until it was explicitly stopped.

The follow-up implementation now writes the disabled, unique MCP endpoint to
both the portable runtime and the MetaTrader instance directory actually used
by the terminal. It also places the adapter in a strict kill-on-close Job Object
before releasing its stdin bootstrap, so a terminal spawned by
`MetaTrader5.initialize()` is job-owned before its PID is discoverable. The new
Windows regression injects an initialize failure and proves that both the
adapter and its unregistered terminal child exit.

Credentialed reruns no longer report the MCP bind conflict and leave zero Phase
1 child processes after failure, but the Python package now returns the more
specific safe class:

```text
BLOCKED: MT5_IPC_TIMEOUT
```

A control Phase 0 account probe against the approved installed terminal passes,
while the same probe against the isolated terminal times out even outside the
Rust Job Object. This isolates the remaining blocker to MetaTrader/Python IPC
selection or isolated-terminal provisioning, not Job cleanup. The installed
terminal was already running during these comparisons; a controlled test that
gracefully closes it, or a supported replacement for the multi-terminal Python
IPC boundary, is still required. No order API ran, and no credential or account
identifier is committed with this evidence.

## 4. Required follow-up

Do not mark Phase 1 complete or start Phase 2 until all items below are closed:

1. **Done:** make every isolated terminal use a unique, effective disabled MCP
   configuration in both portable and MetaTrader instance state.
2. **Done:** make every failed `start_pair` path terminate the adapter and any
   spawned terminal before returning, including before terminal PID discovery.
3. **Done:** add a Windows regression that reproduces initialize failure and
   proves no adapter or terminal child survives it.
4. Resolve `MT5_IPC_TIMEOUT`: first run a controlled test with the already-open
   installed terminal gracefully closed. If isolated attach still fails, replace
   the Python multi-terminal boundary with a MetaQuotes-supported isolation
   mechanism before claiming one-worker/many-terminal support.
5. Re-run the credentialed harness until provision, two clean restarts, forced
   crash recovery, heartbeat, and graceful stop all return complete snapshots.
6. Compare login/server, account mode, positions, pending orders, seven-day
   history counts, and the selected symbol specification with an independent
   FTMO web view; then rerun with `-IndependentWebMatchConfirmed`.
7. Run two disposable demo accounts concurrently to prove cross-account fault
   isolation and observe idle CPU/memory before considering greater density.

Only after these gates pass may this document and the authoritative plan change
Phase 1 from `BLOCKED` to `PASS`.

## 5. Secret-safe rerun

Use the existing DPAPI credential created for Phase 0. Do not add login,
password, server, account name, tickets, user paths, raw terminal logs, or the
unsanitized Phase 1 result to Git. Before committing any future evidence, create
a schema, remove identifying values, validate it, and manually inspect the
staged diff.
