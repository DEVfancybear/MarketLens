# Evidence Report — Local MT5 prerequisites and generic Python/API bootstrap (Tier 3)

## 2026-08-21 superseding Revision 14 addendum

The historical Exness `-10005` blocker recorded below applies to the earlier isolated terminal
path before official catalog enrollment. Revision 14 enrolled the clean signed terminal through
the official broker-neutral UI flow, refreshed its exact data profile/catalog, and passed the safe
bootstrap plus the final FTMO/Exness single/coexisting read-only matrix. Current evidence is in
`docs/agent-evidence/mt5-vm-local-image-automation/EVIDENCE.md`; the older failure chronology below
is retained as RED evidence and must not be read as current status.

- SPEC: `SPEC.md`, initial approval plus Revisions 1–9 explicitly approved by the user.
- Final approved revision: `Duyệt SPEC Revision 9 controlled generic MT5 restart` on 2026-08-21.
- Repository state at evidence capture: Git commit
  `11fce09a78fabe5d3447703ae5ae6ec2ad418c45` plus the task files listed by the final scope audit.
  The user subsequently authorized one normal commit and push of this exact task scope; the
  resulting immutable commit SHA is reported in the handoff because the commit is created only
  after this evidence file and its final gauntlet are complete. No pull, reset, checkout, deploy,
  production migration, force-push, tag, or release operation was performed.
- Task-source manifest: SHA-256
  `e6349bc7f502c13adfb4da6c57b7216ee22529dce94e00cb01232607a3090d79` over 11 sorted
  `relative-path<TAB>file-sha256` lines. The exact per-file hashes are recorded below.
- Toolchain: Windows PowerShell `5.1.26100.9168`, Python `3.14.6`, Cargo `1.97.1`, and Rustc
  `1.97.1`.
- Rerunnable entry point:
  `powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\run-mt5-vm-powershell-regression-gauntlet.ps1 -IncludeRealExnessProbe`.
- Safety boundary: demo/read-only only. No `order_check`, `order_send`, modify, cancel, close,
  funded/live account, credential echo, raw configuration edit, force termination, or Phase 5
  action was invoked.
- Independent verification: **not performed** against the final source state. Confidence is based
  on approved SPEC, executable tests, mutation, negative controls, and real execution, not an
  independent reviewer.

## Outcome

The PowerShell/ACL bugs and the reusable terminal-settings automation are fixed and verified. The
implementation is broker-neutral: the reusable helper and entrypoint accept `TerminalPath` and
`AccountAlias` at runtime and contain no broker path, alias, observed PID, or terminal profile hash.

The real Exness demo exit gate remains **BLOCKED**. The final run applied and re-read the approved
four-checkbox state, performed one opt-in graceful restart, resolved a new exact-path process, and
ran the existing read-only Phase 0 probe. MT5 still returned `MT5_INITIALIZE_FAILED`, code `-10005`.
The bootstrap then restored the exact prior checkbox state on the restarted process, verified the
restoration, and waited until exactly one responsive exact-path terminal remained.

This is not a false global Python/runtime failure: a same-host control using the same Python
`3.14.6` and MetaTrader5 package `5.0.6090` initialized the default terminal successfully and then
stopped at the independent stale FTMO login blocker (`MT5_LOGIN_FAILED`, code `-6`).

## SPEC → evidence mapping

| Scenario / invariant | Executable evidence | Status |
| --- | --- | --- |
| L1 reproducible release agent | Release artifact exists at `backend\execution\target\release\mt5-vm-agent.exe`; SHA-256 `b2c4b792a9055c63cc3bacd179056abe1d2502a1b252c26a790b75f0c05b3e5a`. The earlier task build and focused Rust run passed; Rust source was not changed by Revisions 3–9. | pass, not part of final PowerShell gauntlet |
| L2 legitimate Authenticode signing | Final local audit returns `NotSigned`; no CA-issued private-key identity is available locally. No test/self-signed certificate or policy bypass was substituted. | **blocked** |
| L3 two isolated signed terminal slots | Two distinct canonical install paths exist. Both binaries return Authenticode `Valid`, company `MetaQuotes Ltd.`, version `5.0.0.6122`, and SHA-256 `7896c49fdef94b76d8e84281d352643a08f088ca08f2c9713745ba5b515a1506`. The retail slot has one matching data profile. | pass for installation/signature; retail Python IPC blocked |
| L4 two secret-safe DPAPI aliases | `ftmo-free-trial` and `exness-mt5-demo` are schema 2, have encrypted payloads, current-user ownership, protected inheritance, and exactly current-user plus SYSTEM ACL rules. | pass |
| L5 independent views | No user-confirmed FTMO web and retail terminal/web comparison was supplied in this task. | **unverified / blocked** |
| L6 normal signed single/two-account gates | Depends on L2 and L5; retail Phase 0 also fails initialization and FTMO control has stale login. | **blocked** |
| R3-1/R4/R5 no-BOM PowerShell 5.1 stdin and restoration | `test_powershell_process_contracts`: generated Unicode strict-UTF-8 round trip has no BOM; all four redirected-stdin launch sites use the shared start helper; observable encoding tuple is restored on success and throw. M1/M2 killed. | pass |
| R3-2 exact ACL postcondition | Disposable real-file tests cover success, privilege error after apply, privilege error before apply, and non-privilege errors. M3/M4 killed. | pass |
| R3-3 valid real transport | Final retail result is valid Phase 0 JSON and not `JSONDecodeError`; the independent error is `-10005`. | pass for transport, broker gate blocked |
| R6 exact approved terminal state and rollback | Real UI transaction applies `1/0/0/0`, forces DLL/WebRequest off, verifies after `OK`, and restores exact prior state on `-10005`. | pass |
| R7-1 broker-neutral exact process selection | Fictitious Unicode/spaced paths, exact canonical matching, zero/multiple process cases, signature fence, and source literal gate. M5 killed. | pass |
| R7-2 apply plus post-OK verification | Fake-boundary state machine plus real official-UI execution; missing persistence fails and restores. M6 killed. | pass |
| R7-3 sanitized probe orchestration and rollback | `-10005`, malformed result, distinct login error, and exception branches tested. M7 killed. | pass |
| R7-4 ownership/output bounds | Pre-existing process is not closed by default; bootstrap-owned process is closed once; output contains only bounded classification/hash fields. M8 killed. | pass |
| Modal deadlock regression | Real execution reproduced synchronous `SendMessage(WM_COMMAND)` blocking on the modal Options dialog. A RED regression now requires non-blocking `PostMessage`; M9 killed. | pass |
| R8 cleanup-call array semantics | Exact PowerShell JSON representation `[811]` is asserted, proving one close call for the exact owned PID. | pass |
| R9-1 opt-in path/PID-fenced restart | Default never restarts; explicit switch closes the selected PID once and validates a distinct exact-path replacement. M10/M12 killed. | pass |
| R9-2 rollback targets restarted PID | Tests require initial UI on synthetic PID A and rollback UI only on PID B. M11 killed; real run reports restart plus rollback. | pass |
| R9-3 no force-close capability | Source gate forbids force-close primitives. M13 replaces graceful close with `Stop-Process -Force` and is killed. | pass |
| Must not expose trade mutation | Existing Phase 0/1 AST/source tests and final secret/capability gate. | pass |
| Phase 5 remains disabled | Real executions were read-only; no trading mutation API was introduced or called. | pass |

## Final fresh gauntlet

Command:

```powershell
.\tools\run-mt5-vm-powershell-regression-gauntlet.ps1 -IncludeRealExnessProbe
```

| Layer | Final result |
| --- | --- |
| Full focused suites | `69` tests passed, `0` failed, in `14.961s`. |
| Python static compilation | `python -m compileall -q backend\bridge\mt5_vm` passed. |
| PowerShell 5.1 parse | `PARSE_OK=7`; all changed/added PowerShell runtime files parsed with zero errors. |
| Mutation | `MUTATION_OK=13/13`; every mutant was executed, killed, and source restored byte-for-byte. |
| Diff hygiene | `git diff --check` passed; only existing LF→CRLF warnings were printed. |
| Secrets/capability | `SECRET_GATE_OK=task-files`; broker/profile literal and force-termination gates passed. |
| Real execution | `REAL_TERMINAL_BOOTSTRAP_OK=exit-2`; `TerminalRestarted=true`, `RolledBack=true`, `SettingsRetained=false`, code `-10005`; process settle gate passed. |
| Overall executable constraint | `MT5_VM_POWERSHELL_GAUNTLET=PASS`. This means the expected fail-closed/rollback contract passed, not that the retail MT5 account initialized. |

### Checker negative control

Before the final run, the same entry point with `-NegativeControl` created one uniquely named invalid
temporary `.ps1`, failed nonzero with `Missing condition in if statement`, and removed the exact
temporary file in `finally`. This proves the parser checker reaches its failure path for that known
bad input; it does not prove recognition of every possible PowerShell defect.

### Mutation list

1. Re-enable UTF-8 BOM.
2. Bypass the Phase 0 start helper.
3. Broaden the tolerated ACL exception.
4. Skip the exact ACL postcondition.
5. Select a terminal by executable name instead of canonical path.
6. Skip post-`OK` persistence verification.
7. Skip rollback on `-10005`.
8. Close a pre-existing terminal without ownership.
9. Reintroduce blocking modal Options open.
10. Restart without the opt-in switch.
11. Roll back using the stale pre-restart PID.
12. Skip restarted canonical-path verification.
13. Replace graceful close with force termination.

An intermediate mutation run failed closed because the M5 anchor matched two blocks after the
restart implementation. The runner did not skip the mutant; the anchor was narrowed to the resolver
and all 13 mutants were rerun from M1.

## Task-source manifest

The manifest hash is calculated from the following sorted UTF-8 lines joined by LF:

```text
backend\bridge\mt5_vm\Invoke-MT5VmPhase0.ps1	4db8f1ad21f292e6e15b2c1da0cf0109a97eba19bd1b6691458ddb0f09778b21
backend\bridge\mt5_vm\Invoke-MT5VmPhase1.ps1	0390359b6f3906903fafc3b48ad739c6ead055e3fd5d02c8923a42d5d330d700
backend\bridge\mt5_vm\Invoke-MT5VmPhase1TwoAccount.ps1	745da0be9e62ed36fa89ec61441ba15f857d8b79d10429bae1ca866afa8cc707
backend\bridge\mt5_vm\Invoke-MT5VmTerminalPythonApiBootstrap.ps1	b7d60db6399d8f0761986480cbe88044140a10ce51a052234f98b532adf6749f
backend\bridge\mt5_vm\Mt5VmProcess.ps1	2d5bddd89e23517be40cc5845f7342ef9d049137fa032d259f19a699ef7e3f27
backend\bridge\mt5_vm\Mt5VmTerminalUi.ps1	7794913151834b65b20ee5093cdcd18c215f881cd6fd2301d90251201beb5514
backend\bridge\mt5_vm\Save-MT5VmPhase0Credential.ps1	bc1e5ed2fd68f74a6d69cf6be72f6f61abc71bdb9fe2acc535632137e55f7755
backend\bridge\mt5_vm\test_powershell_process_contracts.py	c9f735badbace28c02d722e3d8ca56d535d289096d5a14c6ddfe5fa2037fd6bc
backend\bridge\mt5_vm\test_terminal_python_api_bootstrap.py	3815e2fcd0e07e9003d903653f3906745ce625808a852c37102c6a270018a91b
tools\run-mt5-vm-powershell-regression-gauntlet.ps1	02aa60aad5daf2ff73e633ccbe8bc1a1b0e3dfb64bfcde936611808617c507bc
tools\Test-MT5VmPowerShellMutations.ps1	2e304a4e426f8b9c7cd45ef78c41db55a6c05292b7bf7917d4a0f7c66c5331d3
```

## Skipped and known limits

- Changed-line coverage threshold: no installed coverage tool spans PowerShell 5.1 and the Python
  subprocess contracts without a new dependency. Branches are mapped to tests and 13 executable
  mutants; no percentage is claimed.
- Property framework: no Hypothesis/Pester property dependency was added. Deterministic generated
  Unicode payloads, fictitious terminal paths, state combinations, and adversarial process cases
  are covered; this is not claimed as exhaustive property testing.
- PSScriptAnalyzer/type checker: not installed. PowerShell AST parse and Python compile checks pass.
- Randomized-order suite: not configured. Focused and full suites were repeatedly green in fixed
  order; no flake claim beyond the observed runs.
- Independent verification: not performed against the final state.
- Broker/root-cause limit: settings and one restart were disproved as the sole cause of retail
  `-10005`. No unsupported registry rewrite, profile copy, portable-mode permission weakening, or
  terminal downgrade was attempted.

## Honest failure history

- Credential save originally reported `PrivilegeNotHeldException` after applying the intended DACL.
  The fix now accepts only that exact exception chain and only after a fresh exact ACL postcondition.
- Redirected stdin originally carried a UTF-8 BOM. Windows PowerShell 5.1 lacks
  `ProcessStartInfo.StandardInputEncoding`; the shared helper now temporarily changes only
  `[Console]::InputEncoding` around `Process.Start()` and restores its observable tuple in `finally`.
- Revision 8 corrected one test fixture's PowerShell single-element array representation from scalar
  `811` to `[811]`; no production code was changed for that correction.
- The first real generic UI run deadlocked because synchronous `SendMessage(WM_COMMAND)` opened a
  modal Options dialog. Exact Cancel controls were used to unwind without saving; semantic settings
  returned to the prior state. A RED test and M9 now prevent recurrence.
- The first restarted-target adversarial test found candidate PID promotion before path validation.
  The target is now promoted only after complete path/PID validation; wrong-path UI is never reached.
- The controlled restart briefly exposed multiple same-path transition processes; the final settle
  gate waits up to 30 seconds and requires exactly one responsive main-window process.

## Remaining blockers and local handoff

1. Signed agent: `backend\execution\target\release\mt5-vm-agent.exe` remains unsigned. Completion
   requires a legitimate CA-issued signing identity/private key and timestamp service selected and
   authorized by the user; purchasing or accepting identity terms was not inferred.
2. Retail terminal: the generic runtime input is installed and signed, but Python IPC remains
   `-10005` after official UI enablement and one graceful restart. Escalate the sanitized reproduction
   to the broker/MetaQuotes or provision a separately supported clean instance; do not bypass the
   gate.
3. FTMO demo: DPAPI alias exists, but the current control reaches MT5 and fails login with code `-6`;
   re-enter the disposable credential through a local secure prompt before normal lifecycle tests.
4. Independent views: user observation in the official FTMO and retail terminal/web views is still
   required; MarketLens output cannot serve as its own expected result.
5. V6: the authenticated public API/browser plus disposable Vault lifecycle remains a separate open
   exit gate.

Until these blockers are closed, V3, V4, V6, and V7 remain blocked and Phase 5 is not authorized.

## Publication boundary

The user authorized updating the sanitized plan/evidence, committing the audited task files, and
pushing the current branch. Publication does not change any technical verdict above: it records the
verified fixes and remaining blockers; it does not claim full Phase 0–4 completion.
