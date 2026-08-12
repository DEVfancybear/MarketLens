# MT5 Windows VM connector Phase 0 validation

- Status: **implemented; credentialed FTMO probe pending**
- Review date: 12 August 2026
- Scope: Windows host feasibility, terminal/runtime discovery, secret-safe probe
- Execution: strictly read-only

This document records observed Phase 0 evidence. It does not certify trading or
authorize a production rollout.

## 1. Outcome

The Windows VM architecture is feasible on the current Windows host and the
repository now contains a repeatable, fail-closed Phase 0 harness.

The VM worker foundation is Rust. The new `mt5-vm-agent` workspace crate owns a
bounded multi-terminal runtime registry, safe account runtime paths, and lease
generation fencing. Python remains a read-only Phase 0 adapter for the official
MetaTrader5 package.

Observed host evidence:

| Check | Result |
| --- | --- |
| Windows host | `PASS` — Windows NT 10.0.26200.0 |
| PowerShell | `PASS` — 5.1.26100.8875 |
| MT5 terminal | `PASS` — signed MetaQuotes binary found at the standard path |
| MT5 terminal version | `PASS` — 5.0.0.6090 |
| Running terminal process | informational — none during preflight |
| Managed Python | `PASS` — Python 3.14.6 x64 in ignored `backend/.venv-mt5` |
| Python MT5 dependencies | `PASS` — MetaTrader5 5.0.6090, websockets 17.0.1 |
| Rust Windows build chain | `PASS` — MSVC Build Tools 17.14 and Windows SDK |
| Rust agent tests | `PASS` — 6 passed |
| Python adapter tests | `PASS` — 8 passed |
| FTMO account login | `PASS` — credentialed read-only demo probe passed on 2026-08-12 |

The managed-Python prerequisite was reprovisioned from the host's 64-bit Python
runtime. Its virtual environment is ignored by Git. The disposable FTMO demo
credential gate is now complete.

## 2. Delivered Phase 0 artifacts

```text
backend/bridge/mt5_vm/
  README.md
  Invoke-MT5VmPhase0.ps1
  Save-MT5VmPhase0Credential.ps1
  phase0_probe.py
  runtime_probe.py
  test_phase0_probe.py

backend/execution/crates/mt5-vm-agent/
  Cargo.toml
  src/lib.rs
  src/main.rs

docs/fixtures/mt5-windows-vm-phase0/
  README.md
  result-schema.json
  results.host.json
```

The PowerShell harness defaults to `Host` mode. `Account` mode requires a
current-user-owned, restrictive-ACL file below `%LOCALAPPDATA%\MarketLens`,
decrypts its login/server/password DPAPI payload only in memory, and sends the
credential to Python over redirected stdin. It never places credential material
in a command argument, environment variable, repository file, or output fixture.

The Python probe implements read calls only:

- `initialize`, `login`, `terminal_info`, and `account_info`;
- `symbols_total`, `symbols_get`, `symbol_info`, and `symbol_info_tick`;
- `positions_get` and `orders_get`;
- seven-day `history_orders_get` and `history_deals_get`;
- `shutdown` in a `finally` path.

There is no `order_send`, `order_check`, position modification, or account
mutation surface in Phase 0.

## 3. Test matrix

| ID | Requirement | Current status |
| --- | --- | --- |
| `HST-01` | Windows and supported PowerShell | `PASS` |
| `HST-02` | Resolved MetaQuotes terminal file | `PASS` |
| `HST-03` | Managed 64-bit Python exists | `PASS` |
| `HST-04` | Python imports pinned MT5 dependencies | `PASS` |
| `SEC-01` | Login/server/password are one DPAPI payload outside Git with restricted ACL | `PASS` by implementation boundary |
| `SEC-02` | Password absent from CLI/env/output | `PASS` by implementation/test boundary |
| `SEC-03` | Partial credentials fail closed | `PASS` by unit test |
| `SEC-04` | No plaintext in DPAPI container; ACL limited to user/SYSTEM | `PASS` by disposable fixture test |
| `SEC-05` | Probe source contains no MT5 trade mutation call | `PASS` by AST unit test |
| `AGT-01` | Rust agent defaults to bounded multi-terminal capacity | `PASS` by Rust test |
| `AGT-02` | Each account gets an isolated runtime path | `PASS` by Rust test |
| `AGT-03` | Capacity exhaustion fails closed | `PASS` by Rust test |
| `AGT-04` | Stale lease cannot transition/remove runtime | `PASS` by Rust test |
| `AGT-05` | Zero lease generation fails closed | `PASS` by Rust test |
| `AGT-06` | Config rejects parent-directory paths | `PASS` by Rust test |
| `PERF-01` | Bounded preallocated O(1) runtime registry | `PASS` by implementation/test |
| `ACC-01` | Initialize exact terminal instance | `PASS` |
| `ACC-02` | Exact requested/observed login match | `PASS` |
| `ACC-03` | Exact requested/observed server match | `PASS` |
| `ACC-04` | Account classified demo | `PASS` |
| `READ-01` | Account/terminal status | `PASS` |
| `READ-02` | Positions and pending-order counts | `PASS` |
| `READ-03` | Symbol specification and tick | `PASS` |
| `READ-04` | Seven-day orders/deals history | `PASS` |

## 4. Exit decision

Phase 0 status is `PASS`. On 2026-08-12 the operator saved the disposable FTMO
Free Trial credential through the DPAPI helper and the credentialed read-only
probe confirmed demo mode, exact login/server matches, terminal connectivity,
and all account/read snapshots. The manually reviewed sanitized account result
is schema-valid at
`fixtures/mt5-windows-vm-phase0/results.account.sanitized.json`.

No later phase may infer that an account is safe for trading from this
read-only gate.

## 5. Secret-safe operator runbook

From repository root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File `
  .\backend\bridge\mt5_vm\Invoke-MT5VmPhase0.ps1 -Mode Host
```

The checked host uses the ignored `backend/.venv-mt5` managed runtime. Do not
install packages into an unknown global Python runtime.

Create the credential:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File `
  .\backend\bridge\mt5_vm\Save-MT5VmPhase0Credential.ps1 `
  -AccountAlias ftmo-free-trial `
  -Login 12345678 `
  -Server FTMO-Demo
```

The script prompts for the MT5 master password. Do not paste the password into
chat, source, `.env`, command history, screenshots, or a JSON fixture.

Run the probe:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File `
  .\backend\bridge\mt5_vm\Invoke-MT5VmPhase0.ps1 `
  -Mode Account `
  -AccountAlias ftmo-free-trial
```

The default account output is written outside the repository under:

```text
%LOCALAPPDATA%\MarketLens\phase0-results\
```

Before committing any future result:

- confirm it contains no login, password, encrypted password, user identity,
  account name, IP, path under the user profile, or raw ticket/deal ID;
- replace the exact server with an approved alias if disclosure is unnecessary;
- retain only counts, booleans, mode, runtime versions and non-identifying
  symbol specification evidence;
- validate against `result-schema.json` and manually inspect the staged diff.
