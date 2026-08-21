# SPEC — Local MT5 Phase 1–4 prerequisites (Tier 3)

- Status: approved; implementation/configuration may proceed within this SPEC.
- Repository root: `C:\Users\duong\Downloads\tradingview`.
- Scope: produce and verify one legitimately signed agent, provision two isolated demo MT5 slots,
  and establish independent FTMO/retail observations. This remains demo/read-only and does not
  authorize Phase 5.
- Current source: `master` at `fd28f7d4780f3fa16cdc10b849967125e77266a6`; the worktree already
  contains user-owned changes, including `backend/execution/crates/mt5-vm-agent/tests/managed_worker_cli.rs`.
  They will be preserved and no commit, reset, checkout, push, pull, deploy, or production migration
  will be performed.

## Current sanitized host audit

- DPAPI alias present: `ftmo-free-trial`.
- Signed MT5 slot present: `C:\Program Files\MetaTrader 5\terminal64.exe`.
- Agent present: `backend\execution\target\debug\mt5-vm-agent.exe`, Authenticode status `NotSigned`.
- No unexpired code-signing certificate with private key is available in the current-user or
  local-machine Personal stores, and `signtool.exe` is not on `PATH`.
- No second MT5 installation or second DPAPI demo alias was found in the audited standard paths.

## Failure model

1. A self-signed/test certificate or policy bypass is mistaken for reputable signing.
2. Signing credentials or broker credentials leak through chat, CLI arguments, environment,
   logs, Git, screenshots, or evidence.
3. A binary is signed from an unidentified or changing source state.
4. Two aliases accidentally share one account, one terminal installation, one broker catalog,
   or one running process.
5. A funded/live account or an order-mutation path is used.
6. Circular evidence is accepted because MarketLens output is used as the independent expected view.
7. A manual checkbox is claimed without the user actually observing the independent UI.
8. A failed/partial run leaves an orphan terminal/agent, broad ACL, reusable credential file,
   or misleading PASS evidence.

## Executable acceptance scenarios

### L1 — Reproducible release agent

Given the current source tree and existing locked Rust dependencies,
when `cargo build --locked --release -p mt5-vm-agent` runs from the execution workspace,
then `backend\execution\target\release\mt5-vm-agent.exe` exists, its SHA-256 and source-state
recipe are recorded, and the focused Rust agent tests pass before signing.

### L2 — Legitimate Authenticode signing

Given either Microsoft Artifact Signing Public Trust or an existing CA-issued Authenticode
code-signing identity controlled by the user,
when the release binary is signed with SHA-256 plus an RFC 3161 timestamp,
then `Get-AuthenticodeSignature` returns `Valid`, the signer chain is trusted, the post-sign SHA-256
is recorded, and the normal Phase 1 harness accepts the binary without
`-ApplicationControlTestHost`.

If no verified signing account/profile or CA-issued certificate is locally available, L2 is
`BLOCKED`; no self-signed certificate, private-trust test profile, reputation claim, or Application
Control exception may substitute. The user enters any Azure/CA authentication only in the official
local UI or secure prompt; no secret is requested in chat.

### L3 — Two isolated signed terminal slots

Given the existing FTMO demo and one new Exness MT5 demo created by the user in the official broker
UI,
when the official Exness MT5 installer is installed to a directory distinct from the FTMO slot and
both server catalogs are enrolled,
then both `terminal64.exe` files have valid MetaQuotes Authenticode signatures, distinct canonical
paths and instance catalogs, valid `Config\terminal.lic` files, and are stopped before harness use.

### L4 — Two secret-safe DPAPI aliases

Given the two disposable demo accounts,
when the existing `Save-MT5VmPhase0Credential.ps1` prompt is run once per account,
then aliases `ftmo-free-trial` and `exness-mt5-demo` exist under
`%LOCALAPPDATA%\MarketLens`, each file is schema 2, current-user DPAPI protected, owned by the current
Windows user, and grants no broad Windows principal. Passwords, raw logins, and exact servers are
never printed or copied into chat/Git.

### L5 — Independent views are actually independent

Given FTMO Client Area/Web MT5 and Exness Personal Area/Exness Terminal (or its official MT5 view),
when the user signs in directly in those official views,
then the expected identity/server, demo mode, positions, pending orders, seven-day history counts,
selected instrument specification, orders, and deals are read from those views rather than from a
MarketLens response. Only sanitized counts/verdicts are retained.

### L6 — Normal-path single- and two-account gates

Given L1–L5,
when `Invoke-MT5VmPhase1.ps1` runs for each alias and
`Invoke-MT5VmPhase1TwoAccount.ps1` runs both aliases concurrently with the two distinct slots,
then the signed normal path provisions and reconciles both demos, one terminal crash/recovery does
not disturb the other heartbeat/snapshot, all independent comparisons agree, and graceful stop
leaves zero owned agent/adapter/terminal processes. Any mismatch, timeout, cross-account row, or
orphan yields `BLOCKED`.

## Negative constraints

- No live/funded broker account; no `order_check`, `order_send`, modify, cancel, close, or Phase 5 action.
- No password, token, private key, PFX material, raw login/account/ticket, exact server, or Vault
  response in chat, Git, command arguments, ordinary environment variables, logs, or committed evidence.
- No Smart App Control/Application Control bypass and no weakening of Authenticode, ACL, reparse,
  lease, owner, or redaction checks.
- No account creation, identity verification, terms acceptance, or MFA approval is impersonated by
  the agent; those UI steps belong to the user.
- No source/config edits are planned. If a repository defect is found, stop, append a SPEC revision,
  add a RED reproducer, and obtain renewed approval before editing implementation or assertions.

## Setup, dependencies, generated files, and operations

- Existing tools: Rust/Cargo, Python/MetaTrader5 environment, PowerShell harnesses, and the installed
  FTMO MT5 slot.
- Signing tool, only after approval and only if the user has a verified signing identity:
  install Microsoft's official Artifact Signing Client Tools (which includes compatible SignTool)
  or use an already installed Windows SDK SignTool with the user's CA-issued certificate. This is a
  local machine installation and may require administrator approval and network access.
- Retail slot: use the official Exness MT5 Windows installer and a user-created demo MT5 account.
  Installation is local and may require administrator approval, network access, EULA acceptance,
  MFA, CAPTCHA, or regional eligibility handled only by the user.
- Local generated files: release agent under `backend\execution\target\release`; signed copy and
  sanitized verification output under `%LOCALAPPDATA%\MarketLens`; the second MT5 installation;
  one second DPAPI credential file; normal Phase 1 sanitized result files. Raw screenshots and
  unsanitized broker/terminal logs remain outside Git.
- Repository output after successful verification: update the existing Phase 1–4 `EVIDENCE.md`
  and authoritative plan with sanitized verdicts only. No commit or push is authorized.
- New application/runtime dependencies: none. Artifact Signing tools and the retail terminal are
  operator tooling, not repository dependencies.

## Approval checkpoints and execution order

1. User explicitly approves this exact SPEC.
2. Build/test the release agent and record its unsigned hash/source state.
3. If the user has no verified signing identity, stop L2 as `BLOCKED` and provide the official
   Artifact Signing setup boundary. Continue only after the user reports the local signing account,
   certificate-profile name, and endpoint/path alias; never request its token/password.
4. User completes official Exness registration/demo creation and any EULA/MFA/CAPTCHA. Continue
   after the user reports only the chosen alias and locally visible installer/account readiness.
5. Install/configure the second signed terminal slot and save both DPAPI credentials via secure
   local prompts.
6. User opens the official FTMO and Exness independent views and performs the observation. The
   `-IndependentWebMatchConfirmed` switch is supplied only after the user explicitly confirms the
   comparison; an answer to that checkpoint is not a revised-SPEC approval.
7. Run L6, the focused repository gauntlet, secret scan of the task diff/output, and an adversarial
   check for duplicate slots, swapped aliases, invalid signatures, broad ACLs, and orphan processes.
8. Write final EVIDENCE mapping L1–L6 and every negative constraint to actual results. Report only
   aliases and approved local paths to the user.

## Verification commands

```powershell
& "$env:USERPROFILE\.cargo\bin\cargo.exe" build --locked --release `
  --manifest-path backend\execution\Cargo.toml -p mt5-vm-agent
& "$env:USERPROFILE\.cargo\bin\cargo.exe" test --locked `
  --manifest-path backend\execution\Cargo.toml -p mt5-vm-agent --all-targets

Get-AuthenticodeSignature -LiteralPath `
  .\backend\execution\target\release\mt5-vm-agent.exe

.\backend\bridge\mt5_vm\Invoke-MT5VmPhase1.ps1 `
  -AccountAlias <alias> -TerminalPath <slot-path> -AgentPath <signed-agent-path>

.\backend\bridge\mt5_vm\Invoke-MT5VmPhase1TwoAccount.ps1 `
  -AccountAlias ftmo-free-trial,exness-mt5-demo `
  -TerminalPath <ftmo-slot>,<exness-slot> -AgentPath <signed-agent-path>
```

The exact SignTool/Artifact Signing command is intentionally not frozen until the user identifies
which legitimate signing backend is locally available; adding that input requires an append-only
SPEC revision and renewed approval before signing.

## Approval record

- Proposed on 2026-08-21.
- **Obtained.** The user explicitly approved this exact SPEC with
  `Duyệt SPEC Local MT5 Prerequisites` on 2026-08-21.

## Revision 1 proposal — unattended second-terminal installation

The approved SPEC described the official MT5 installer as an interactive UI checkpoint. MetaQuotes'
current official installation documentation explicitly supports unattended installation with
`/auto` and a distinct `/path`. The user requested that the installation itself be automated.

Revision 1 authorizes only these additional/changed actions:

1. If the previously opened installer UI is still running and the requested target has not been
   installed, close only that verified installer process.
2. Revalidate the downloaded installer's SHA-256 and MetaQuotes Authenticode signature immediately
   before execution.
3. Run the installer unattended as:

   ```powershell
   <verified-installer> /auto /path:"C:\Program Files\MetaTrader 5 Exness"
   ```

4. Wait for completion and fail closed unless the target contains a valid MetaQuotes-signed
   `terminal64.exe`, a non-reparse installation root, and `Config\terminal.lic`. Derive the normal
   MetaQuotes instance ID from the canonical installation path and record only the sanitized path,
   hashes, and presence of its data directory/catalog.
5. Do not overwrite, update, stop, or reconfigure the existing
   `C:\Program Files\MetaTrader 5` slot. If the target directory already contains unexpected files,
   stop rather than merge or delete it.

Approval of Revision 1 authorizes unattended installation using MetaQuotes' documented automatic
mode at the exact target above. It does not authorize the agent to accept broker terms, create or
impersonate an Exness identity, solve CAPTCHA/MFA, choose a funded account, or fabricate independent
observations. Those account-security/legal checkpoints remain user-only. Signing also remains
blocked until a verified Artifact Signing/CA identity is supplied locally.

### Revision 1 approval

- Proposed on 2026-08-21.
- **Obtained.** The user explicitly approved this revision with
  `Duyệt SPEC Revision 1 auto-install MT5` on 2026-08-21.

## Revision 2 proposal — automated Artifact Signing bootstrap

The local audit found no Azure CLI session, Artifact Signing client tools, SignTool, CA-issued
certificate, or locally configured signing endpoint. The user requested maximum automation of the
signing identity path. A publicly trusted publisher identity cannot be fabricated or self-issued;
Microsoft requires the user's Azure authentication, subscription authority, identity validation,
and Artifact Signing role assignment.

Revision 2 authorizes the following local and Azure bootstrap actions:

1. Install the official `Microsoft.AzureCLI` and
   `Microsoft.Azure.ArtifactSigningClientTools` packages through WinGet. Record package versions and
   executable paths. These are operator tools, not repository dependencies.
2. Launch official Azure CLI browser/device authentication. The user alone completes sign-in, MFA,
   consent, billing/subscription eligibility, and publisher identity validation. No password,
   refresh token, access token, private key, or browser storage is read or copied by the agent.
3. After login, enumerate only sanitized subscription display aliases, Artifact Signing account
   aliases, certificate-profile aliases, regions, validation state, and RBAC readiness. Do not print
   tenant IDs, subscription IDs, principal IDs, tokens, billing details, addresses, or identity
   documents into chat or evidence.
4. Do not create a billable Azure resource until the user selects a sanitized subscription alias
   and supported region and explicitly confirms publisher identity validation is complete. That
   selection is input to an append-only Revision 3 and requires renewed approval before resource
   creation because it fixes billing scope and external-state targets.
5. Once an eligible Public Trust account/profile exists and the Signer role is effective, automate
   SHA-256/RFC-3161 signing of the exact L1 release agent, verify its trusted Authenticode chain,
   record pre/post-sign hashes, and run the normal Application Control path. Public Trust test or
   Private Trust profiles do not satisfy L2.

This revision does not authorize creating a fake/self-signed identity, weakening Smart App Control,
accepting Azure/MetaQuotes/Exness legal terms on the user's behalf, purchasing a subscription,
uploading identity documents, or using a production signing profile unrelated to MarketLens.

### Revision 2 approval

- Proposed on 2026-08-21.
- **Obtained.** The user explicitly approved this revision with
  `Duyệt SPEC Revision 2 automated signing bootstrap` on 2026-08-21.

## Revision 3 proposal — UTF-8 stdin transport and credential ACL postcondition

- Status: proposed; implementation is not authorized until the exact approval phrase below is
  received.
- Tier remains **Tier 3** because the affected paths carry broker credentials and control the
  account-validation boundary.

### Observed regressions

1. A live, read-only Exness Phase 0 invocation reached `phase0_probe.py` with a UTF-8 BOM at the
   start of redirected stdin. Python rejected the otherwise valid request with `JSONDecodeError`.
   A no-secret hard-coded JSON control reproduced the exact BOM failure.
2. `Save-MT5VmPhase0Credential.ps1` wrote the DPAPI payload and applied the intended protected DACL,
   but `Set-Acl` then raised `PrivilegeNotHeldException` because the process lacked
   `SeSecurityPrivilege`. A post-failure audit confirmed the new Exness file was schema 2,
   current-user DPAPI protected, owned by the current user, inheritance-protected, and granted only
   current-user plus `SYSTEM` full control. The misleading failure must not be ignored unless those
   exact postconditions are independently re-read and verified.

### Revision 3 failure model

1. A BOM corrupts Phase 0, either Phase 1 subprocess, or the two-account subprocess before request
   validation, producing a false broker/login blocker.
2. A no-BOM fix is applied to only one of the four redirected-stdin launch sites and the other path
   remains latent.
3. Unicode broker/server or symbol text is corrupted while removing the BOM.
4. ACL error suppression reports success even though the credential inherited a broad allow rule,
   has the wrong owner, or lacks the two required full-control entries.
5. A regression test prints or persists real account data, or uses the live credential as a test
   fixture.

### Executable acceptance scenarios

#### R3-1 — All redirected JSON stdin is UTF-8 without BOM

Given a `ProcessStartInfo` configured by the shared MT5 VM process helper,
when PowerShell sends JSON containing ASCII, Vietnamese text, and non-BMP Unicode to a child
process,
then the first three bytes are not `EF BB BF`, the child decodes strict UTF-8, and the decoded JSON
equals the original value.

Given each of the four existing redirected-stdin launch sites in
`Invoke-MT5VmPhase0.ps1`, `Invoke-MT5VmPhase1.ps1` (two sites), and
`Invoke-MT5VmPhase1TwoAccount.ps1`,
when its `ProcessStartInfo` is started,
then the shared helper has explicitly configured `StandardInputEncoding` as
`UTF8Encoding(false)` before `Start()`.

#### R3-2 — Credential save succeeds only after an exact ACL postcondition

Given a disposable dummy password and a unique test alias under the current user's
`LocalAppData\MarketLens` directory,
when `Save-MT5VmPhase0Credential.ps1` writes and protects the file on a host where `Set-Acl` raises
`PrivilegeNotHeldException` after applying the DACL,
then the command exits successfully only if a fresh `Get-Acl` proves: owner equals the current-user
SID, inheritance is protected, and the complete explicit allow-rule set is exactly current user plus
`SYSTEM`, both with full control and no inherited rule.

Given any other ACL exception or any missing/extra/wrong postcondition,
then the save command fails closed and must not print its success message.

#### R3-3 — Real read-only Exness transport no longer fails at JSON decoding

Given the locally stored `exness-mt5-demo` DPAPI alias and the isolated MetaQuotes-signed Exness
terminal slot,
when the approved Phase 0 account probe is rerun,
then its result is valid Phase 0 JSON and `error_class` is not `JSONDecodeError`. Broker/demo checks
may still block for an independently reported broker/runtime reason; no trading mutation API is
invoked.

### Negative constraints

- No real login, server, password, encrypted payload, ticket, token, or account response is used in
  an automated fixture or written to repository output.
- No ACL error is broadly swallowed. Only a verified `PrivilegeNotHeldException` may proceed to a
  mandatory exact postcondition check; every other exception is rethrown.
- No weakening of DPAPI, reparse checks, owner checks, broad-principal checks, demo/read-only gates,
  Authenticode policy, or Phase 5 boundary.
- No application dependency, broker installation, signing purchase, commit, push, reset, checkout,
  deployment, or production mutation is authorized by this revision.

### Planned files and RED → GREEN → REFACTOR sequence

1. **RED/assertions only:** add
   `backend/bridge/mt5_vm/test_powershell_process_contracts.py` with Windows subprocess tests for
   no-BOM Unicode round trips, coverage of every redirected-stdin launch site, and a disposable
   dummy credential ACL integration test. Run the focused test file and retain the observed failures
   before editing implementation.
2. **GREEN/implementation only:** add a dependency-free shared helper at
   `backend/bridge/mt5_vm/Mt5VmProcess.ps1`; invoke it from the four launch sites in
   `Invoke-MT5VmPhase0.ps1`, `Invoke-MT5VmPhase1.ps1`, and
   `Invoke-MT5VmPhase1TwoAccount.ps1`; change `Save-MT5VmPhase0Credential.ps1` to tolerate only the
   observed privilege exception and then enforce the exact ACL postcondition. Test assertions stay
   frozen during this step.
3. **REFACTOR:** remove duplication only while assertions remain unchanged and green.
4. Add one rerunnable fail-closed entry point at
   `tools/run-mt5-vm-powershell-regression-gauntlet.ps1` and final evidence under this evidence
   directory. Generated dummy credentials use unique test names, contain no real account data, and
   are removed by the test after exact-path validation.

### Revision 3 gauntlet

- Focused RED/GREEN Windows subprocess suite, then all `backend.bridge.mt5_vm` Python unit tests.
- PowerShell parser check for every changed `.ps1` file.
- Deterministic Unicode round-trip cases plus generated JSON strings over a fixed seed.
- Changed-line coverage mapping for all helper/error-handling branches; if no installed coverage
  tool can enforce the threshold without adding a dependency, record the exact mapped branches and
  use mutation as the executable constraint rather than claiming a percentage.
- Manual mutation, with a persisted runner: re-enable BOM, omit one call site, broaden the tolerated
  exception, and weaken one ACL postcondition; every mutant must be killed and restoration verified.
- Adversarial checks: malformed JSON, Unicode edge cases, extra ACL principal, inherited ACL, wrong
  owner model, and a simulated non-privilege exception.
- Real execution: rerun the read-only Exness Phase 0 probe and verify bounded sanitized output,
  followed by an orphan-process and repository secret scan.
- New dependencies: **none**. Existing Windows PowerShell, Python `unittest`, and repository tools
  are sufficient.

### Revision 3 approval phrase

Approve this exact append-only revision with:

`Duyệt SPEC Revision 3 no-BOM stdin and ACL postcondition`

### Revision 3 approval

- Proposed and **obtained** on 2026-08-21.
- The user explicitly approved this exact revision with
  `Duyệt SPEC Revision 3 no-BOM stdin and ACL postcondition`.

## Revision 4 proposal — Windows PowerShell 5.1 no-BOM process start

- Status: proposed; implementation/assertion changes below are not authorized until the exact
  approval phrase is received.
- This revision changes only the R3-1 mechanism. R3-2, R3-3, all negative constraints, and Tier 3
  remain unchanged.

### Why Revision 3 must change

The first GREEN run proved that Windows PowerShell 5.1 uses .NET Framework's
`System.Diagnostics.ProcessStartInfo`, which has no `StandardInputEncoding` property. Attempting to
assign it raises `PropertyAssignmentException`; with non-terminating PowerShell error behavior the
child still starts and receives `EF BB BF`.

A no-secret byte-level control then proved the compatible mechanism:

1. Save the process-wide `[Console]::InputEncoding` object.
2. Set it to `UTF8Encoding(false)` only around `Process.Start()`.
3. Restore the original object in `finally`, whether start succeeds, returns false, or throws.
4. Use the existing `Process.StandardInput.Write()` and `Close()` calls.

The child received bytes exactly equal to `UTF8Encoding(false).GetBytes(payload)`, with no BOM.

### Revised R3-1 implementation contract

- Replace the invalid `Set-MT5VmUtf8NoBomStandardInput -StartInfo` API with
  `Start-MT5VmProcessWithUtf8NoBomStandardInput -Process` in `Mt5VmProcess.ps1`.
- The helper is the only code that calls `Process.Start()` at the four JSON-stdin sites. It must
  temporarily change only `[Console]::InputEncoding`, restore the exact original encoding object in
  `finally`, and return the original boolean start result.
- The four callers retain their existing fail-closed `if (-not <start>) { throw ... }` behavior and
  their existing secret-zeroing/stdio cleanup.
- The helper must work on Windows PowerShell 5.1; it must not require PowerShell 7, reflection,
  private .NET fields, temporary plaintext files, environment-carried credentials, or a new
  dependency.

### Revised RED/GREEN sequence

1. **Assertions only:** replace the invalid property-based helper assertion with tests that require
   the new start helper, exact no-BOM Unicode round trips, all four call sites routing start through
   it, and exact restoration of `[Console]::InputEncoding` after both successful start and a thrown
   start. Run and observe RED while the current invalid helper remains.
2. **Implementation only:** replace the current helper implementation and four call-site sequences;
   assertions remain frozen. Run focused GREEN and the unchanged ACL tests.
3. Continue the Revision 3 gauntlet, mutation, real Exness Phase 0 execution, and evidence. Record
   the failed `StandardInputEncoding` attempt and both byte-level controls honestly.

### Revision 4 approval phrase

Approve this exact append-only correction with:

`Duyệt SPEC Revision 4 PowerShell 5.1 no-BOM process start`

### Revision 4 approval

- Proposed and **obtained** on 2026-08-21.
- The user explicitly approved this exact revision with
  `Duyệt SPEC Revision 4 PowerShell 5.1 no-BOM process start`.

## Revision 5 proposal — observable encoding restoration semantics

- Status: proposed; the two assertion corrections below are not authorized until the exact approval
  phrase is received.
- Implementation mechanism, no-BOM requirement, ACL contract, call-site coverage, Tier, and all
  negative constraints remain unchanged.

### Observed PowerShell wrappers

The first Revision 4 GREEN run showed two PowerShell 5.1 observability details:

1. Assigning the saved `Encoding` back to `[Console]::InputEncoding` restores the original code page,
   web name, and preamble behavior, but a later getter returns a different managed object reference.
   Reference identity is therefore not an observable restoration contract.
2. A missing executable causes `Process.Start()`'s `Win32Exception` to appear as the inner exception
   of PowerShell's `MethodInvocationException`. Requiring the outer exception type to be exactly
   `Win32Exception` over-specifies PowerShell's invocation wrapper.

### Revised assertions only

- Successful and thrown-start tests compare the complete observable encoding tuple before and after:
  code page, web name, encoding name, and preamble bytes. Every field must match exactly.
- The thrown-start test requires the exception chain to contain
  `System.ComponentModel.Win32Exception`; it does not require that type to be the outer wrapper.
- First edit only these assertions/diagnostic fields and run RED/GREEN against the current helper.
  No implementation edit is authorized in that step. If all seven focused tests pass, continue the
  unchanged Revision 3/4 gauntlet without further helper changes.

### Revision 5 approval phrase

Approve this exact append-only assertion correction with:

`Duyệt SPEC Revision 5 observable encoding restoration`

### Revision 5 approval

- Proposed and **obtained** on 2026-08-21.
- The user explicitly approved this exact revision with
  `Duyệt SPEC Revision 5 observable encoding restoration`.

## Revision 6 proposal — persistent Exness terminal Python/API enablement

- Status: proposed; the host setting changes below are not authorized until the exact approval
  phrase is received.
- This revision applies only to the isolated Exness demo profile rooted at
  `C:\Program Files\MetaTrader 5 Exness\terminal64.exe`. It does not authorize changing the FTMO
  profile, a live/funded account, or any order operation.

### Root-cause evidence

- The no-BOM transport and ACL gauntlet passes, and the default FTMO installation establishes MT5
  IPC. The same Python package returns `-10005` for every secondary slot.
- The Exness terminal was bootstrapped through the official `Login to Trade Account` dialog using
  DPAPI material only in local process memory; `accounts.dat` was created, but IPC still timed out.
- The working default profile has `[Experts] Enabled=1, Api=0`. A secondary managed profile that
  times out has `Enabled=0, Api=0`; the fresh Exness profile has no persisted `[Experts]` section.
- The official MT5 Options UI exposes the exact controls: `Allow algorithmic trading` and
  `Disable algorithmic trading via external Python API`. MetaQuotes support guidance for `-10005`
  calls for enabling the first and clearing the second.

### Authorized persistent changes and risk

Approval authorizes one exact UI transaction on the Exness demo terminal profile:

1. Set `Allow algorithmic trading` **checked**.
2. Set `Disable algorithmic trading via external Python API` **unchecked**.
3. Force `Allow DLL imports` **unchecked**.
4. Force `Allow WebRequest for listed URL` **unchecked**.
5. Click `OK`, then re-read the resulting boolean settings and run only the existing read-only
   Phase 0 probe.

This makes the Exness terminal capable of accepting algorithmic/API trading requests from other
software running under that profile. The MarketLens Phase 0/1 source remains read-only and its
gauntlet forbids `order_send`/`order_check`, but the terminal-level capability persists beyond this
session. DLL imports and WebRequest remain disabled to limit blast radius.

If Phase 0 still returns `-10005`, the settings are restored to their pre-change states through the
same official Options UI and the blocker remains open. No raw `common.ini` edit, CLI password,
clipboard secret, temporary plaintext credential, live account, or trade request is authorized.

### Revision 6 approval phrase

Approve this exact persistent Exness demo setting change with:

`Duyệt SPEC Revision 6 enable Exness demo Python API`

### Revision 6 approval

- Proposed and **obtained** on 2026-08-21.
- The user explicitly approved this exact revision with
  `Duyệt SPEC Revision 6 enable Exness demo Python API`.

## Revision 7 proposal — broker-neutral MT5 terminal Python/API bootstrap

- Status: proposed; tests and implementation below are not authorized until the exact approval
  phrase is received.
- This revision supersedes only the broker-specific execution mechanism proposed in Revision 6.
  Revision 6's exact checkbox states, demo/read-only boundary, rollback requirement, and all prior
  security constraints remain unchanged.
- Exness is permitted only as a runtime `TerminalPath`/`AccountAlias` supplied by the operator for
  the current real probe. The reusable implementation must not encode an Exness or FTMO install
  path, account alias, terminal profile hash, process ID, or broker-specific branch.

### Revision 7 failure model

1. A broker path, profile hash, or observed PID is embedded in source and silently breaks the next
   terminal slot.
2. Path matching selects another `terminal64.exe`, or more than one matching process is treated as
   safe.
3. A look-alike or unsigned executable is allowed to receive the settings transaction.
4. A hidden login/modal window or a changed MT5 dialog/control contract causes a partial or wrong
   settings update.
5. The script reports success from in-memory checkbox values although `OK` did not persist them.
6. Phase 0 still returns IPC timeout `-10005`, malformed output, or throws after applying settings,
   and the previous state is not restored exactly.
7. Cleanup terminates a terminal process that pre-existed the command, or leaves a process that the
   command itself started after a failed transaction.
8. Broker credentials or account identifiers reach command arguments, environment variables,
   clipboard, temporary plaintext files, ordinary output, tests, or repository evidence.

### Executable acceptance scenarios

#### R7-1 — Generic terminal selection is exact and fail-closed

Given any canonical MetaTrader installation path supplied through mandatory `-TerminalPath`,
when the bootstrap resolves the terminal process,
then it validates the existing MetaQuotes Authenticode boundary before mutation, matches a running
process only by case-insensitive canonical `ExecutablePath`, starts only that exact path when none is
running, and rejects multiple exact-path matches. It never chooses by executable name alone.

Given source and test sentinel paths for two fictitious brokers,
then the same code path handles both and an executable source gate rejects broker names, the known
Exness/default absolute paths, profile hash `53785E099C927DB68A545C249CDBCE06`, and observed PID
`20016` in the reusable implementation.

#### R7-2 — One common official-UI transaction applies and verifies exact state

Given the selected MT5 process and the official Options dialog,
when the common helper selects the Expert Advisors tab,
then it snapshots the four checkbox booleans and applies exactly:

- `Allow algorithmic trading = checked`;
- `Disable algorithmic trading via external Python API = unchecked`;
- `Allow DLL imports = unchecked`;
- `Allow WebRequest for listed URL = unchecked`.

The helper centralizes the MT5 command/control identifiers as named constants, verifies every
control exists and has a boolean state, clicks `OK`, reopens the official Options dialog, and
re-reads all four values before reporting success. A missing/ambiguous window, tab, control, or
non-boolean state fails closed. It never edits `common.ini` directly.

#### R7-3 — Probe orchestration restores exact prior state on IPC/bootstrap failure

Given mandatory `-TerminalPath` and safe `-AccountAlias` runtime inputs,
when `Invoke-MT5VmTerminalPythonApiBootstrap.ps1` applies R7-2 and delegates to the existing
read-only `Invoke-MT5VmPhase0.ps1 -Mode Account`,
then credentials remain inside the existing DPAPI/stdin boundary and the bootstrap consumes only
the sanitized Phase 0 result.

If the result has `last_error_code = -10005`, is missing/malformed, or bootstrap execution throws,
the command restores the exact four-value snapshot through the same official UI, reopens Options to
verify the restoration, and exits nonzero. If MT5 initialization succeeds or reaches a distinct
sanitized account/login blocker, the approved state remains applied and that independent result is
reported without being relabeled as success.

#### R7-4 — Process ownership and output remain bounded

Given a terminal process that existed before invocation,
then cleanup never closes it. Given a terminal process started by the bootstrap, then failure and
rollback close only that owned process through a normal window close and verify its exit; inability
to close it is reported as a blocker, never retried with forced termination. Output contains only
canonical-path hash/ownership flags, checkbox booleans, phase/error class, and exit status; no raw
login, server, account, ticket, password, or decrypted/encrypted payload is printed.

### Planned files and RED → GREEN → REFACTOR sequence

1. **RED/assertions only:** add
   `backend/bridge/mt5_vm/test_terminal_python_api_bootstrap.py` with PowerShell 5.1 subprocess tests
   for broker-neutral source, exact-path/multiplicity behavior, exact four-state application,
   post-`OK` verification, rollback on `-10005`/malformed output/exception, non-IPC preservation, and
   process ownership. Thin Win32/process boundary functions may be replaced only in the test process;
   the settings state machine itself is not mocked. Observe every new behavior fail before adding
   implementation.
2. **GREEN/implementation only:** add dependency-free common library
   `backend/bridge/mt5_vm/Mt5VmTerminalUi.ps1` and generic operator entry point
   `backend/bridge/mt5_vm/Invoke-MT5VmTerminalPythonApiBootstrap.ps1`. Test assertions remain frozen.
3. **REFACTOR:** centralize named UI constants and remove orchestration duplication while all
   assertions remain unchanged and green.
4. Extend `tools/run-mt5-vm-powershell-regression-gauntlet.ps1` and its persisted mutation runner;
   write final results to this task's `EVIDENCE.md`. No commit, push, reset, checkout, deploy, or
   production operation is authorized.

### Revision 7 gauntlet

- Focused RED/GREEN tests, then all `backend.bridge.mt5_vm` Python tests.
- Windows PowerShell 5.1 parser checks for every changed/added `.ps1` file.
- Manual mutations must be killed for: name-only process matching, omitted post-`OK` verification,
  skipped `-10005` rollback, and closing a pre-existing terminal.
- Adversarial cases: zero/multiple exact processes, invalid signature, missing/duplicate controls,
  non-boolean checkbox state, modal obstruction, malformed/missing probe result, rollback failure,
  and a terminal path containing spaces and Unicode.
- Real execution uses the installed Exness demo only as runtime input; it records sanitized Phase 0
  classification, verifies restoration if `-10005` persists, checks owned-orphan state, and scans the
  repository diff/task artifacts for secrets and broker-specific implementation literals.
- Changed-line coverage is mapped to executable scenarios and mutations. Property tooling may be
  skipped only if unavailable without a new dependency; deterministic generated terminal paths and
  state combinations remain required.
- New application/runtime dependencies: **none**. Existing Windows PowerShell, Python `unittest`,
  and repository tooling are sufficient.

### Revision 7 approval phrase

Approve this exact broker-neutral revision with:

`Duyệt SPEC Revision 7 common MT5 Python API bootstrap`

### Revision 7 approval

- Proposed and **obtained** on 2026-08-21.
- The user explicitly approved this exact revision with
  `Duyệt SPEC Revision 7 common MT5 Python API bootstrap`.

## Revision 8 proposal — observable single-element cleanup-call array

- Status: proposed; the assertion correction below is not authorized until the exact approval
  phrase is received.
- The first Revision 7 GREEN run passed 10 of 11 tests. The remaining test boundary initialized
  `closeCalls` as `@()` and appended exactly one PID. Windows PowerShell 5.1 preserves that explicit
  array shape through `ConvertTo-Json`, so the observed value is `[811]`, not scalar `811`.
- Change only `test_cleanup_closes_only_a_process_started_by_bootstrap` to require the exact array
  `[811]` (therefore both the exact owned PID and exactly one close call). Do not change production
  code in this assertion step. This corrects representation without weakening the R7-4 behavior.
- After the corrected assertion is GREEN, continue the unchanged Revision 7 refactor, full gauntlet,
  mutation set, and real broker-neutral runtime invocation.

### Revision 8 approval phrase

Approve this exact assertion correction with:

`Duyệt SPEC Revision 8 cleanup call array semantics`

### Revision 8 approval

- Proposed and **obtained** on 2026-08-21.
- The user explicitly approved this exact revision with
  `Duyệt SPEC Revision 8 cleanup call array semantics`.

## Revision 9 proposal — controlled broker-neutral terminal restart

- Status: proposed; tests, implementation, and the terminal restart below are not authorized until
  the exact approval phrase is received.
- Real Revision 7 execution proved that the generic UI transaction now applies and re-reads the
  approved state, but the immediate Phase 0 probe still returns `-10005`; the helper then restores
  the exact prior four-value state successfully. The remaining bounded hypothesis is that the
  terminal creates its external-Python IPC listener only during process startup.
- This revision remains broker-neutral. The installed demo terminal is supplied only through the
  existing runtime `TerminalPath` and `AccountAlias`; no broker path, alias, profile hash, or PID is
  added to reusable source.

### Authorized behavior

Add an explicit `-RestartTerminalAfterSettings` switch to
`Invoke-MT5VmTerminalPythonApiBootstrap.ps1` and its common core. The default remains off and keeps
the Revision 7 rule that a pre-existing process is never closed.

When the switch is present, the bootstrap may perform one controlled restart after the approved
state has passed post-`OK` verification:

1. Reconfirm the selected process belongs to the exact canonical, trusted `TerminalPath`.
2. Close only that PID through a normal main-window close and require a bounded clean exit. Never
   use `Stop-Process`, taskkill, process termination APIs, or a second/stronger close primitive.
3. Run the existing Phase 0 probe, which may start only the same exact terminal path; resolve the new
   exact-path PID before any verification or rollback.
4. If IPC still returns `-10005`, malformed output, or bootstrap failure, restore the exact prior
   four checkbox values through the restarted terminal's official UI and verify them after `OK`.
5. Preserve process presence: if the terminal was running before the command, leave exactly one
   exact-path terminal running afterward; if the bootstrap originally started it, close only the
   final owned process gracefully.

No live account, order API, raw configuration edit, credential exposure, unrelated terminal close,
restart loop, or automatic retry beyond this single controlled restart is authorized.

### Revision 9 executable scenarios

#### R9-1 — Restart is explicit and path/PID fenced

Given the switch is absent, no pre-existing terminal close boundary is called. Given the switch is
present and one exact-path process is selected, exactly that PID is closed once, its exit is
verified, and the post-probe process must resolve to the same canonical executable path. Zero,
multiple, mismatched, or unresponsive processes fail closed.

#### R9-2 — Rollback targets the restarted process

Given prior state `0/0/0/0`, approved state `1/0/0/0`, original PID A, and restarted PID B,
when the sanitized probe returns `-10005`,
then rollback is invoked on PID B with the exact prior state, PID A is never addressed again, the
summary reports one restart and exact rollback, and one exact-path process remains running.

#### R9-3 — No force-close capability exists

The reusable helper and entrypoint contain no `Stop-Process`, `taskkill`, `Kill()`,
`TerminateProcess`, or WMI/CIM process termination call. A failed graceful close returns a sanitized
blocker and prevents the probe; it does not retry with broader authority.

### RED → GREEN and gauntlet extension

1. **RED/assertions only:** add focused boundary tests for default-no-close, explicit one-close,
   new-PID exact-path resolution, rollback-on-new-PID, process-presence preservation, and a source
   capability gate forbidding force termination. Observe RED before implementation.
2. **GREEN/implementation only:** extend the existing common helper/entrypoint; assertions remain
   frozen. No new file or dependency is required.
3. Extend mutation with at least: restart without the switch, rollback using the stale PID, and a
   skipped new-path verification. Every mutant must be killed and byte-exact restoration retained.
4. Final fresh gauntlet includes one real opt-in restart/probe. It records only path hash, ownership/
   restart booleans, Phase 0 class/code, rollback verdict, exact process count, and secret scan.

### Revision 9 approval phrase

Approve this exact controlled restart with:

`Duyệt SPEC Revision 9 controlled generic MT5 restart`

### Revision 9 approval

- Proposed and **obtained** on 2026-08-21.
- The user explicitly approved this exact revision with
  `Duyệt SPEC Revision 9 controlled generic MT5 restart`.

## Publication authorization — documentation, commit, and push

- Authorized on 2026-08-21 by the user's direct instruction: `update docs, commit and push`.
- Update only the authoritative plan and evidence records needed to preserve the sanitized Phase
  0–4 verdict: V3, V4, V6, and V7 remain blocked, and Phase 5 remains unauthorized.
- Stage exactly the task files recorded by the final clean-scope audit, create one normal commit on
  the current `master` branch, and push it to `origin/master` only after the fresh gauntlet, diff
  hygiene, and secret gates pass.
- This authorization does not include force-push, history rewrite, tag/release creation, deployment,
  production migration, Phase 5 work, or committing credentials, tokens, account identifiers, raw
  broker logs, or unrelated worktree changes. A rejected non-fast-forward push must remain rejected
  unless the user separately authorizes the required reconciliation.
