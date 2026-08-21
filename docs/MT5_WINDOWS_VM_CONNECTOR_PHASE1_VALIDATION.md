# MT5 Windows VM connector Phase 1 validation

- Status: **conditional; installed-slot test-host lifecycle PASS, normal signed-agent exit pending**
- Review date: 21 August 2026
- Scope: local secure multi-runtime worker prototype and read-only lifecycle validation
- Execution: account reads only; no order mutation surface

This document separates the passing repository and FTMO lifecycle evidence from
the full Phase 1 exit gate. The installed-slot lifecycle passes through the
explicit Application Control test-host path. The normal signed-agent path is
still pending, so Phase 1 remains conditional until that path, the independent
FTMO web comparison, and live two-account isolation also pass.

Historical note: the earlier credentialed run returned `MT5_IPC_TIMEOUT`; the
later installed-slot test-host run is the newest local result, but it does not
erase that blocked normal-path evidence or substitute for a signed production
artifact.

The 21 August local refresh adds a second clean signed terminal and disposable demo alias. Official
broker-neutral catalog enrollment, safe Python/API bootstrap, and FTMO/Exness single plus
coexisting read-only probes pass. This closes the clean-slot credential/IPC discriminator; it does
not substitute for the signed-agent path, an independent broker/web comparison, or the required
crash/recover cross-fault and aggregate-load proof.

## 1. Implemented prototype

The repository now contains:

- an HMAC-SHA256 authenticated, versioned stdio control protocol with bounded
  frames, expiry, monotonic sequence/replay rejection, account/worker/lease
  binding, and redacted debug output;
- a bounded FIFO command lane per account, lease/expiry checks, an explicit
  runtime state machine, deterministic startup throttling, and a conservative
  four-terminal ceiling;
- a pool of separately installed, MetaQuotes-signed terminal slots. Each slot
  has pinned terminal, instance server-catalog, and license artifacts; duplicate
  or already-running slots fail closed;
- per-runtime Windows Job Object process/memory limits, restrictive ACL and
  reparse-point validation, pinned Python/adapter artifacts, and MCP disabled
  in both installation and instance configuration;
- a single-account Python adapter that receives credentials only through
  redirected stdin, initializes the installed terminal in non-portable mode,
  serializes MT5 access, publishes account/portfolio/history/symbol snapshots,
  supports heartbeat and graceful stop, and exposes no trade-mutation API;
- a local scheduler simulator, PowerShell entrypoint, and an ignored
  credentialed Rust live test for hosts where Windows Application Control
  correctly blocks an unsigned debug agent executable.

This is a local prototype boundary. It is not the durable Phase 2 scheduler,
outbound production control-plane transport, public account-connect API, vault,
or order-execution path.

## 2. Verification completed

| Check | Result |
| --- | --- |
| Rust `mt5-vm-agent` tests | `PASS` — 21 passed; one credentialed live test ignored by default |
| Python Phase 1 adapter/harness/entrypoint tests | `PASS` — 10 passed |
| Authenticated frame tamper/replay/expiry/cross-account rejection | `PASS` by unit tests |
| Bounded queues, startup throttle, stale lease and idle no-poll behavior | `PASS` by unit tests |
| Fake-driver two-restart/forced-crash and cross-account isolation | `PASS` by Rust unit tests |
| Credential/debug redaction and read-only adapter AST boundary | `PASS` by unit tests |
| Installed-slot hashes, duplicate/running-slot rejection, MCP disable | `PASS` |
| Failed-initialize no-orphan regression | `PASS` — adapter and unregistered terminal child are reaped |
| Credentialed FTMO provision and complete snapshot | `PASS` |
| Two clean restarts | `PASS` |
| Forced terminal crash recovery | `PASS` |
| Heartbeat after recovery and graceful stop | `PASS`; zero Phase 1 processes remain |
| One-pair settled idle observation | `PASS` — 15 s settle, 10 s sample, about 149 MB working set and 5.94% of one CPU core |
| Normal signed-agent control-path live run | `PENDING` — Smart App Control blocks the unsigned debug executable |
| Independent FTMO web snapshot comparison | `PENDING` |
| Two-account single/coexisting read-only matrix | `PASS` — FTMO and clean Exness pass alone and concurrently |
| Live two-account crash/recover isolation and aggregate load | `PENDING` — coexistence is proven, cross-fault lifecycle is not |

Repository checks:

```powershell
& "$env:USERPROFILE\.cargo\bin\cargo.exe" test `
  --manifest-path backend/execution/Cargo.toml `
  -p mt5-vm-agent --all-targets

backend\.venv-mt5\Scripts\python.exe -m unittest `
  backend.bridge.mt5_vm.test_phase1_adapter `
  backend.bridge.mt5_vm.test_phase1_control_harness -v
```

## 3. Live FTMO result and resolved IPC cause

The initial copied-portable prototype returned `-10005`/`MT5_IPC_TIMEOUT`.
Closing terminals, using Python 3.13, passing credentials directly to
`initialize`, disabling conflicting MCP endpoints, and extending first-start
settling did not resolve it.

The passing boundary uses a separately installed MetaQuotes-signed terminal
slot (build 6111), Python 3.13, and MetaTrader5 package 5.0.6090. The new slot
initially had algorithmic trading disabled and only the default server catalog.
After enabling algorithmic trading while leaving the external-Python disable
option unchecked, and provisioning the known-good broker catalog into the
slot's actual MetaTrader instance directory, a closed-terminal credentialed
`initialize(..., portable=False)` passed in about five seconds.

The implementation now models installed terminals as a slot pool instead of
copying `terminal64.exe` into a portable runtime. It pins the broker catalog
from the instance directory that MT5 actually reads. Four credentialed snapshots
(provision, two clean restarts, and forced-crash recovery) all reported demo
mode, connected state, matching requested identity, complete zero/nonzero-safe
portfolio/history counts, and a complete selected-symbol specification.

Windows Smart App Control policy `VerifiedAndReputableDesktop` blocks the newly
built unsigned `mt5-vm-agent.exe`. The live result therefore used the explicit
`-ApplicationControlTestHost` path: an ignored Rust test calls the same
`ProcessRuntimeDriver`, adapter, Job Object, pin/ACL/reparse checks, restart, and
stop implementation. Authenticated control-frame behavior remains covered by
unit tests. This is valid local prototype evidence, but it does not replace a
signed/reputable production agent artifact and one normal end-to-end rerun.

The sanitized result remains outside Git under
`%LOCALAPPDATA%\MarketLens\phase1-results` and is `CONDITIONAL_PASS`. No order API
ran, and no login, password, exact server, account identifier, ticket, raw log,
or unsanitized result is committed.

## 4. Remaining Phase 1 exit gates

Do not mark Phase 1 complete or start Phase 2 until all items below are closed:

1. Produce a signed/reputable `mt5-vm-agent` artifact accepted by the host's
   Application Control policy and rerun the normal authenticated stdio harness.
2. Compare login/server identity, demo mode, positions, pending orders,
   seven-day history counts, and the selected symbol specification with an
   independent FTMO web view; only then rerun with
   `-IndependentWebMatchConfirmed`.
3. Use the two existing disposable demo credentials and separately installed signed terminal
   slots to run the Phase 1 crash/recover lifecycle: prove the unaffected account heartbeat and
   snapshot remain healthy, and record aggregate settled CPU/memory.

The installed-slot pool, live read-only coexistence result, and fake-driver cross-account
regression are ready for item 3, but coexistence alone cannot constitute cross-fault proof.
Only after all three gates pass may this document and the authoritative plan
change Phase 1 from `CONDITIONAL_PASS` to `PASS`.

## 5. Secret-safe rerun

Use the existing DPAPI credential created for Phase 0 and a stopped, separately
installed terminal slot. On a Smart App Control development host:

```powershell
.\backend\bridge\mt5_vm\Invoke-MT5VmPhase1.ps1 `
  -AccountAlias ftmo-free-trial `
  -TerminalPath 'C:\path\to\installed-slot\terminal64.exe' `
  -ApplicationControlTestHost
```

The live-test switch is mutually exclusive with `-AgentPath` and builds/runs the
ignored driver test through Cargo. For the normal authenticated stdio path,
omit `-ApplicationControlTestHost` and explicitly provide the signed agent:

```powershell
.\backend\bridge\mt5_vm\Invoke-MT5VmPhase1.ps1 `
  -AccountAlias ftmo-free-trial `
  -TerminalPath 'C:\path\to\installed-slot\terminal64.exe' `
  -AgentPath 'C:\path\to\signed\mt5-vm-agent.exe'
```

There is no default `-TerminalPath`; multiple values may be supplied to the slot
pool. The normal path rejects an agent without a valid Authenticode signature.
Do not use
`-IndependentWebMatchConfirmed` until the web comparison has actually passed.
Never add credentials, identifying values, raw terminal logs, screenshots, or
the unsanitized result to Git.
