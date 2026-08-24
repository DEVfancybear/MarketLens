# EVIDENCE — Managed MT5 Windows Credential Store

Verdict: **BLOCKED — Revision 3 stopped after committed base upgrades emitted scriptlet/hook failures; GCC and the gauntlet were not run**

Date: 2026-08-24
SPEC: `docs/agent-evidence/mt5-windows-credential-store/SPEC.md` (Tier 3, Revision 1),
`docs/agent-evidence/mt5-windows-credential-store/SPEC_REVISION_2.md` (Tier 3, Revision 2), and
`docs/agent-evidence/mt5-windows-credential-store/SPEC_REVISION_3.md` (Tier 3, Revision 3)
Approval: exact user token recorded in the SPEC approval record
Baseline/HEAD: `b0cabaf67b247412dbd5e02a01c61e75ce54349e` on `master`
Commit/push/deploy: **commit and push explicitly authorized after the Revision 3 BLOCKED report;
this is pre-commit evidence, and deploy remains neither performed nor authorized**

## 1. Why the verdict is blocked

The final fresh gauntlet executed every declared layer and failed only `go-race`:

```text
# runtime/cgo
cgo: C compiler "gcc" not found: exec: "gcc": executable file not found in %PATH%
```

That failure is persisted in
`.artifacts/mt5-baremetal-managed-ea/logs/14-go-race.log`. The affected command was the required
race-detector run for `./internal/mt5credentials` and `./internal/execution` with
`CGO_ENABLED=1`. The host has no discoverable GCC, Clang, or MSVC C compiler. Revision 1 did not
authorize installing another external toolchain. Per SPEC Sections 9 and 10, this is not a pass and
blocks completion, commit, and push unless the user explicitly accepts the reported blocker or
approves a revised toolchain-install scope.

No test was weakened or marked passing because of this environmental failure.

## 2. Final fresh run identity

Single rerunnable command:

```powershell
powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File .\tools\verify-mt5-baremetal-managed-ea.ps1
```

Persisted evidence:

- Summary: `.artifacts/mt5-baremetal-managed-ea/summary.json`
- Per-layer logs: `.artifacts/mt5-baremetal-managed-ea/logs/`
- Source manifest: `.artifacts/mt5-baremetal-managed-ea/source-state.json`
- Go coverage: `.artifacts/mt5-baremetal-managed-ea/go-cover.out`
- Go changed-line report: `.artifacts/mt5-baremetal-managed-ea/go-changed-coverage.json`
- Rust LCOV: `.artifacts/mt5-baremetal-managed-ea/rust-cover.lcov`
- Rust changed-line report: `.artifacts/mt5-baremetal-managed-ea/rust-changed-coverage.json`

Fresh-run facts from `summary.json`:

| Field | Value |
|---|---|
| Started (UTC) | `2026-08-24T05:40:47.9274657Z` |
| Completed (UTC) | `2026-08-24T05:57:42.8656501Z` |
| HEAD | `b0cabaf67b247412dbd5e02a01c61e75ce54349e` |
| Task-tree SHA-256 | `e52c10f41166a9e7542b5f29c663762e973bef3169bf0b0dbb1092baa1164303` |
| Final status | `FAIL` |
| Failed layers | `go-race` only |
| Allowed unverified | `R15-9-live-demo` only |

`EVIDENCE.md` is intentionally written after that final run and is therefore not part of the
recorded task-tree hash. It reports the run; it does not alter runtime behavior.

## 3. Implemented behavior

- Removed the active HashiCorp Vault runtime client and disposable Vault tool.
- Added provider-neutral `mt5credentials` domain types and a Windows Credential Manager store over
  `CredWriteW`, `CredReadW`, `CredDeleteW`, `CredEnumerateW`, and `CredFree`.
- Uses `CRED_TYPE_GENERIC`, `CRED_PERSIST_LOCAL_MACHINE`, and exact targets of the form
  `MarketLens:MT5:mt5-<32 lowercase hex>`. Account, owner, login, broker, and password values do not
  enter target metadata.
- Added versioned and bounded credential encoding, strict pre-native-call validation, typed and
  sanitized errors, exact idempotent deletion, and explicit clearing of Go/native credential
  buffers.
- Added a write/read/delete/absence readiness probe and exact-prefix synthetic-canary cleanup.
  Managed MT5 is enabled only after the independent identity key and credential-store probe both
  succeed.
- Removed active `MT5_VAULT_ADDR`, `MT5_VAULT_API_TOKEN_FILE`, and `MT5_VAULT_NAMESPACE`
  configuration. Non-empty legacy variables fail closed without echoing values.
- Preserved authenticated owner, reserve/write/activate/compensate, revision, lease, session,
  command, one-time grant, deletion-before-response, and removal-before-finalization boundaries.
- Updated environment examples, backend/operator/security documentation, frontend provider-neutral
  wording, docs verification, mutation runner, and the persisted gauntlet.
- Promoted the already pinned `golang.org/x/sys v0.46.0` module from indirect to direct use; no new
  runtime package/version or external service was added.
- No SQL schema change was introduced. Existing migration 0042 was exercised only as a regression
  gate.

## 4. SPEC acceptance mapping

| Scenario | Evidence from the final source state/run | Result |
|---|---|---|
| S1 Windows round-trip | `TestWindowsCredentialStoreRoundTripsAndKeepsMetadataOpaque`; repeated real `TestWindowsCredentialStoreDisposableRealLifecycle`; typed not-found and exact-delete assertions | PASS |
| S2 no Vault runtime | `TestValidateManagedMT5IdentityNeedsNoVaultConfiguration`, `TestManagedMT5StartupUsesCredentialManagerProbeWithoutVault`, `TestManagedMT5StartupEnablesOnlyAfterIdentityAndProbeSucceed`, real-readiness harness test, and `NO_VAULT_RUNTIME_DEPENDENCY=PASS` | PASS |
| S3 reject legacy Vault variables | `TestLoadRejectsLegacyVaultVariablesWithoutEchoingValues` and `TestReadConfigRejectsLegacyVaultFields` | PASS |
| S4 unavailable credential set | Injected Win32 error tests, `TestWindowsCredentialStoreFailsClosedForContextAndNativeErrors`, `TestManagedMT5StartupFailuresKeepCapabilityDisabled`, sanitized required-startup panic/log assertions | PASS |
| S5 metadata redaction | Fake native capture in `TestWindowsCredentialStoreRoundTripsAndKeepsMetadataOpaque` and native write validation tests | PASS |
| S6 input/size limits | Hostile/boundary codec tests, zero-native-call store tests, malformed native result tests, and 10,000 valid property round-trips | PASS |
| S7 exact idempotent deletion | `TestNativeCredentialDeleteValidatesAndMapsErrors`, `TestWindowsCredentialStoreValidatesGetAndDeleteBeforeWinAPI`, and handler fail-closed deletion tests | PASS |
| S8 no durable/public secret | `TestManagedMT5ConnectKeepsPasswordOutOfGatewayAndPublicResponse`, authenticated-owner/password-boundary source contracts, public redaction tests, and secret scan | PASS |
| S9 rotation/compensation | `TestManagedMT5CredentialRotationDeletesPreviousVersionAfterActivation`, `TestManagedMT5CredentialRotationCompensatesStoreAndActivationFailures`, connect compensation/conflict tests | PASS |
| S10 one-time grant cleanup | `TestPrivateCredentialGrantDeletesSessionSecretBeforeResponding`; Rust/agent credential-grant, replay, lease, and no-store boundary regressions | PASS |
| S11 remove all known versions | `TestManagedMT5DeleteRemovesEveryCredentialBeforeFinalizing` and `TestManagedMT5CredentialStoreFailuresBlockUnsafeProgress` | PASS |
| S12 Vault-only stale reference | Missing exact WinCred records return typed not-found; handler consumption/store failures block progress; no Vault client or plaintext migration path remains | PASS |
| S13 cross-platform | Linux package test and compiled artifact PASS; `TestUnsupportedPlatformCredentialStoreFailsClosed` executes under the unsupported test tag; full backend tests PASS | PASS |
| S14 real Windows smoke | Real lifecycle plus probe/absence tests executed twice under the actual Windows test identity; no broker/user credential used | PASS |

## 5. Negative-invariant mapping

| Invariant | Evidence | Result |
|---|---|---|
| Password crosses only the existing private one-time response | Go handler tests, Python boundary contracts, Rust agent tests, and high-confidence secret scan | PASS |
| Worker cannot call WinCred | WinCred implementation is confined to the Go provider; `test_windows_credential_store_uses_only_local_wincred_apis` and capability audit | PASS |
| Targets reveal no tenant/account fields | Exact target/metadata fake capture plus target-mapping property and mutation M9 | PASS |
| No wildcard production delete/cleanup | Exact ref validation; request-path Get/Delete use exact targets; enumeration is restricted to synthetic probe cleanup; sibling-preservation tests | PASS |
| Unexpected native errors fail closed | Injected write/read/delete/enumerate errors, typed-error mapping, probe-stage failures, mutation M11/M12 | PASS |
| Owner/revision/lease/session/command fencing is unchanged | Go connector regressions, Rust gateway/agent suites, Python safety contracts, and killed mutants M1-M8 | PASS |
| Legacy EA/read-only behavior remains | Full shuffled Go suite, Rust workspace suites, 48 Python VM regressions, EA compile/attestation, and 83 frontend trade tests | PASS |
| Identity/admin/bootstrap secrets stay independent | API source contract, identity-key tests, production runner export validation, harness contract | PASS |
| Production/deploy entrypoints and loopback topology stay canonical | Deploy self-test, config loopback tests, PowerShell safety contracts, capability audit and its known-bad control | PASS |
| No secret in repository additions/log evidence | Placeholder control PASS, planted credential-URL control rejected, task additions scan clean; store failure logs use category-only output | PASS |
| Credential buffers are cleared | Go/native buffer-clear tests and killed mutation M13 | PASS |

## 6. Gauntlet result map

### Go and Windows provider

- PASS: format, vet, full `./...` tests with `-shuffle=20260824`, focused API/harness/config/execution/provider tests.
- PASS: 10,000 valid property round-trips plus hostile/malformed/boundary inputs.
- PASS: real Windows credential lifecycle and probe tests, repeated twice.
- PASS: Linux compile/test/artifact and executable unsupported-platform branch.
- PASS: changed-line coverage `537/537` across 10 Go files; known-bad uncovered line rejected.
- PASS: every function in `internal/mt5credentials` reports 100% statement coverage in the final
  merged profile.
- PASS: module integrity.
- **FAIL/BLOCKER:** race-detector build could not start because `gcc` is absent.

### Rust execution boundary

- PASS: fmt, check, Clippy with warnings denied, supply-chain lock check.
- PASS: execution domain/gateway tests; gateway result includes `122 passed`, `4 ignored` (the four
  database tests were run separately in the disposable PostgreSQL layer).
- PASS: managed agent groups: `49 passed / 1 ignored`, `25 passed`, `5 passed`, and `4 passed`.
- PASS: stress/property rerun (`25 passed`).
- PASS: instrumented coverage build/warmup/tests, disposable DB integration, profile merge/export.
- PASS: changed-line coverage `5/5` across 2 Rust files; known-bad uncovered line rejected.

### Cross-stack and adversarial controls

- PASS: 56 managed Python tests and 48 VM regression tests.
- PASS: PostgreSQL 0042 up/down/up, recovery, behavior gate; known-bad checker input rejected.
- PASS: mutation runner self-test `2/2`, byte-exact restore, and score `13/13`:
  authentication, password exposure, grant reuse, lease generation, pipe PID, readiness ordering,
  dirty-slot release, unknown-outcome resend, target mapping, size bound, idempotent not-found,
  probe gating, and buffer clearing were all killed.
- PASS: EA MetaEditor compile and release SHA-256 attestation.
- PASS: frontend typecheck, lint, and `83/83` trade tests; npm production audit found zero
  vulnerabilities.
- PASS: dependency-delta audit, Vault-removal audit, docs (`2558` checks, `151` Go routes,
  `72` environment keys, migration head `0042`), whitespace, secret scan, and capability audit.
- PASS: capability audit's planted worker-launch negative control was rejected; canonical runner
  identity-key validation/export appears exactly once.

## 7. RED -> GREEN evidence

Behavioral tests were introduced before their corresponding implementations and observed failing,
including provider codec/store behavior, WinCred native validation, startup capability gating,
legacy Vault configuration rejection, real harness readiness, log redaction, and native read-buffer
clearing. The final assertions were then kept while implementation was brought GREEN.

Two gauntlet defects were also reproduced before correction:

1. Standalone coverage executables under `.artifacts` were blocked by Windows Application Control;
   the gate now invokes package tests through `go test` and still persists/merges atomic profiles.
2. Capability audit treated generic closing braces as globally unique. A new contract was observed
   RED, then the audit was changed to require the complete ordered identity-key validation block
   exactly once while retaining a planted unapproved-capability negative control.

The final fresh gauntlet proves both corrections: Go coverage and capability audit PASS.

## 8. Limitations and unverified boundaries

- `go-race` is unverified because the host lacks an authorized C compiler. This is the completion
  blocker, not an allowed skip.
- `R15-9-live-demo` remains `UNVERIFIED_ALLOWED`: three disposable broker Demo identities/accounts
  and a separate execution-time confirmation were not supplied. No broker or production action was
  attempted.
- Independent agent verification was explicitly not authorized/performed by Revision 1.
- No production service restart, deployment, activation, commit, push, real broker login, or
  migration mutation was performed.
- The real WinCred smoke proves the current test identity. Production still requires the Go API to
  run consistently under one dedicated least-privilege Windows identity; changing/loss of that
  host identity requires users to reconnect credentials.
- Credential Manager is host/identity-bound and does not provide Vault-equivalent remote isolation,
  HA, centralized audit, or database-only restore. A process compromised under the same Windows
  identity can read that identity's generic credentials.
- codebase-memory-mcp and its CLI were unavailable. Discovery used the repository-mandated fallback:
  `docs/CODEBASE_MEMORY.md`, architecture/package documentation, and direct authoritative source
  inspection.

## 9. Required next decision

One of these explicit user decisions is required before this Tier 3 task can be called complete:

1. authorize a revised scope to install/configure a compatible Windows C compiler and rerun the
   one-command gauntlet; or
2. explicitly accept the exact missing-`gcc` race-detector blocker documented above.

Until then, this worktree is implemented and extensively verified, but **not complete and not
production-active**.

## 10. Revision 2 execution — blocked package transaction

Revision 2 was approved with the exact token:

```text
Duyệt SPEC Revision 2 cài MSYS2 UCRT64 GCC và chạy lại gauntlet
```

The approved clean preflight was persisted before host mutation at
`.artifacts/mt5-windows-credential-store/toolchain-revision-2/preflight.json`. It confirmed a
non-elevated Windows 11 Pro x64 user session, Go `1.26.5 windows/amd64`, no discoverable compiler or
MSYS2 installation, no WinGet MSYS2 registration, and no persistent compiler environment setting.
The WinGet manifest remained the exact approved `MSYS2.MSYS2` version `20260611`, installer URL, and
SHA-256 `3150d7d9aa5dedd900a7f52300d4d918271e3a8fc47de94848818fd5a430e6b0`.

### R2 RED -> GREEN verifier evidence

The new contract
`ManagedGauntletContractTests.test_go_race_toolchain_is_absolute_process_local_and_fail_closed`
was first observed RED with 16 failures. The complete failure output is retained in
`.artifacts/mt5-windows-credential-store/toolchain-revision-2/contract-red.log` with SHA-256
`72a3bbc562f560789eee38f2dd5d7b1bdb9146b85592bac01ca498974e8cd8f3`.

After the verifier implementation, the same focused unittest passed (`Ran 1 test`, `OK`). A parsed
copy of `Assert-GoRaceToolchain` then rejected a synthetic absent absolute root with the exact
`Go race GCC is missing from the approved compiler root` category and emitted
`GO_RACE_TOOLCHAIN_NEGATIVE_CONTROL_OK`; the complete PowerShell verifier parsed successfully.

The persisted verifier now requires the fixed `C:\msys64\ucrt64\bin` compiler root, absolute
`CC`/`CXX`, a process-local compiler `PATH`, exact `x86_64-w64-mingw32` target, an existing absolute
`libsynchronization.a`, the signed package query and ownership result, and unchanged User/Machine
`CC`, `CXX`, `CGO_ENABLED`, and `Path` hashes. It does not persist environment variables.

### Exact host transaction and failure

WinGet installed the exact approved package successfully at user scope under `C:\msys64` and
reported both `Successfully verified installer hash` and `Successfully installed`. A fresh
registration query returned:

```text
MSYS2 MSYS2.MSYS2 20260611
```

The first authorized `pacman --noconfirm -Syu` exited zero after upgrading only
`msys2-runtime` to `3.6.10-3`. It explicitly required all MSYS2 processes to exit, activating the
single additional full-update pass allowed by SPEC lines 261–263. Its transaction log is
`.artifacts/mt5-windows-credential-store/toolchain-revision-2/pacman-system-update-1.log` with
SHA-256 `618f2f3d568c1d6eaf3a74ed05d7eaa3a8f90f710b49e77ffee30c50202c263d`.

The one authorized additional `pacman --noconfirm -Syu` invocation exited 1 before commit. The
relevant terminal result was:

```text
error: failed retrieving file ... from mirror.msys2.org : Resolving timed out
error: failed retrieving file ... from repo.msys2.org : Operation too slow
warning: failed to retrieve some files
error: failed to commit transaction (unexpected error)
Errors occurred, no packages were upgraded.
```

The failed transaction log is
`.artifacts/mt5-windows-credential-store/toolchain-revision-2/pacman-system-update-2.log` with
SHA-256 `2b37c5559807e587138e6568d062a0f7e5548cc96a5f20402a96640a0d2ef73c`.
Revision 2 expressly says that more retries require a SPEC revision, so neither another update nor
the combined GCC-install `-Syu` command was run.

### Post-failure state and scenario map

The sanitized terminal-state attestation is persisted at
`.artifacts/mt5-windows-credential-store/toolchain-revision-2/blocked-state.json`:

- WinGet registration: exact `MSYS2.MSYS2 20260611` remains installed.
- Base runtime query: `msys2-runtime 3.6.10-3`.
- GCC package query: exit 1, package not installed; `C:\msys64\ucrt64\bin\gcc.exe` is absent.
- No pacman database lock and no running process rooted under `C:\msys64`.
- User and Machine `CC`, `CXX`, `CGO_ENABLED`, and `Path`: all eight presence/hash checks unchanged
  from the clean preflight; neither persistent PATH acquired the compiler root.
- No elevation, reboot, service control, security-policy change, broker action, production action,
  commit, push, deploy, or rollback was performed.

Acceptance status:

- R2-S1, R2-S2, R2-S3, R2-S6 contract, and the R2-S7 missing-root negative control: **PASS**.
- R2-S4 signed/full base update and GCC transaction: **BLOCKED** by the exhausted authorized network
  attempt; the failed transaction committed no packages.
- R2-S5 real compiler attestation, R2-S8 focused race, R2-S9 fresh full gauntlet, and R2-S10 clean
  closure: **NOT RUN**, because GCC was not installed and the SPEC required an honest stop.
- R2-S11 rollback: **NOT INVOKED**. The exact registered user-scope MSYS2 base was retained for an
  explicit revised retry or an explicit exact-package uninstall decision; no manual deletion was
  attempted.

The Revision 1 summary remains the latest full gauntlet result. It was not reused or relabeled as a
Revision 2 pass. Completion now requires a newly approved bounded retry revision, followed by real
toolchain attestation, the focused race command, and one fresh complete gauntlet.

After recording the stop state, all currently runnable verifier-only checks were repeated from the
current worktree: `python -m unittest -v backend.bridge.mt5_vm.test_managed_gauntlet` passed all
three tests, PowerShell parsed `tools/verify-mt5-baremetal-managed-ea.ps1` with zero errors, and
`git diff --check` exited zero. These checks do not substitute for the unrun focused race or full
gauntlet.

## 11. Revision 3 execution — committed update stopped on scriptlet failure

Revision 3 was approved with the exact token:

```text
Duyệt SPEC Revision 3 retry pacman và chạy lại gauntlet
```

The approved SPEC is
`docs/agent-evidence/mt5-windows-credential-store/SPEC_REVISION_3.md`. Its pre-approval SHA-256 was
`ca34c3ff1c4ee8b87d9b288ce2b43b9453c00ecdfe7bafb21183e5506bd7e371`; the append-only approval
record changed the file SHA-256 to
`11f14f59555bee1441ee0b8815616a3ef8ac1d3ed3271c6c9988576043a171b3` before host mutation.

### Startup, preflight, and fail-closed controls

`codebase-memory-mcp` and its CLI remained unavailable after the mandatory startup check. The
repository fallback was repeated by reading `docs/CODEBASE_MEMORY.md`, the bare-metal runbook, and
the authoritative files relevant to this environment-only revision. The complete `old-coder`
Tier 3 instructions and gauntlet reference were also reapplied.

The clean preflight is
`.artifacts/mt5-windows-credential-store/toolchain-revision-3/preflight.json` (SHA-256
`f78fb2fdd70e7c8193797578fb8c5683e93478ca193d47b00afb4398ef9c664d`). It recorded HEAD
`b0cabaf67b247412dbd5e02a01c61e75ce54349e`, the adopted exact WinGet registration
`MSYS2.MSYS2 20260611`, `C:\msys64`, `msys2-runtime 3.6.10-3`, pacman `6.1.0-25`, 90 installed
packages, absent GCC, no pacman lock/MSYS process, a non-elevated identity, the existing dirty
worktree, 8/8 unchanged persistent-environment presence/hash checks, and 3/3 approved pacman config
hashes.

Before package mutation:

- `python -m unittest -v backend.bridge.mt5_vm.test_managed_gauntlet` passed 3/3 tests; the log
  SHA-256 is `07cf8a265fdb2582a4bd3cdcdebab5e8a6bfd2870bf388a9eea9e94477f83074`.
- The PowerShell verifier parsed with zero errors. The extracted existing checker rejected the
  synthetic missing compiler root with the exact expected category and emitted
  `GO_RACE_TOOLCHAIN_NEGATIVE_CONTROL_OK`; its log SHA-256 is
  `3e293c98e5012c397618a4c7dc1aeb5c141f93307a01b81327ee466e37f928ef`.
- The first and only network-gate round resolved both approved hosts and returned HTTP 200 for all
  four repository database HEAD requests. No read-only network retry was needed.
- The base print-only preview contained exactly 29 installed-package upgrades from the stock
  repository and no installed-package conflict, removal, or downgrade. Its structured target log
  SHA-256 is `48a2b39015f120e7c129991a733ee0af7cd24c4fa194bedf0dbf30eb6ccb7e91`.

### Exact transaction result and mandatory stop

The first package-mutating command was the approved absolute executable invocation:

```powershell
C:\msys64\usr\bin\pacman.exe --noconfirm --disable-download-timeout -Syu
```

Pacman returned process exit code `0`, but that exit code was not treated as sufficient evidence of
success. Its own output and ALPM log reported all of the following after transaction processing had
started:

```text
error: command failed to execute correctly
/tmp/alpm_AAzVUp/.INSTALL: line 14: mkdir: command not found
/tmp/alpm_AAzVUp/.INSTALL: line 15: cp: command not found
/tmp/alpm_AAzVUp/.INSTALL: line 16: cp: command not found
/tmp/alpm_AAzVUp/.INSTALL: line 17: cp: command not found
error: command failed to execute correctly
```

The output also records failed pre- and post-transaction hooks. The complete command log has
SHA-256 `bd43fc0a630e8eb570275f6d57bbf3686b6bd924f30d89c26ebb5cc92bc4e4ad`; the exact pacman-log
delta has SHA-256 `c9c3df132c5f745b4c3908772cf78d2af270b8a68f23ff8320df4d78a238194d`.

The transaction committed all 29 previewed version upgrades. The package count remained 90, no
package was added or removed, and the post-state comparison found no version change outside the
approved preview. Because this was a non-transport scriptlet/hook failure after package state had
changed, SPEC Section 6 forbade the shared retry even though it had not been consumed. Attempt
accounting is therefore: **1 package-mutating invocation, 0 retries, retry no longer permitted**.
No second base update, GCC preview/install, compiler attestation, focused race, or full gauntlet was
run.

Read-only diagnosis confirmed that `C:\msys64\usr\bin\mkdir.exe` and `cp.exe` both exist and are
owned by `coreutils 8.32-5`. The inherited child PATH did not contain `C:\msys64\usr\bin`, so a
profile-free MSYS Bash child could not resolve the commands. Prefixing that directory only in a
diagnostic child made both resolve as `/usr/bin/mkdir` and `/usr/bin/cp` and execute successfully.
No User/Machine PATH was changed. The installed `ca-certificates` script shows those unqualified
commands on the exact failed lines 14-17. The diagnostic logs are retained under the Revision 3
artifact root; they are diagnosis only, not a repair or passing integrity attestation.

### Stop-state attestation and scenario map

The authoritative stop-state report is
`.artifacts/mt5-windows-credential-store/toolchain-revision-3/blocked-state.json` (SHA-256
`5224cc77f52c10d7cc5e96956f4505174e98a49487b94fec09c7697a40cdb9e0`). It records:

- exactly 29 preview-matching upgrades, 0 additions, and 0 removals;
- no remaining pacman lock and no process rooted below `C:\msys64`;
- no installed `mingw-w64-ucrt-x86_64-gcc` record and no
  `C:\msys64\ucrt64\bin\gcc.exe`;
- all 8/8 User/Machine `CC`, `CXX`, `CGO_ENABLED`, and `Path` presence/hash checks unchanged;
- all 3/3 `pacman.conf`/mirrorlist hashes unchanged; and
- no retry, GCC action, race action, gauntlet action, rollback, uninstall, security-policy change,
  service/network configuration, production action, broker action, commit, push, or deploy.

The final non-artifact task-source manifest records HEAD
`b0cabaf67b247412dbd5e02a01c61e75ce54349e`, 68 changed/untracked/deleted paths, and task-tree
SHA-256 `c0bb4ccb85e7a3a2fa0cf2061ac4a068d0469265c72719e3586f4e6e1b1fa5de`. It is retained at
`.artifacts/mt5-windows-credential-store/toolchain-revision-3/source-state.json` (file SHA-256
`d094add79db6759ad803dea37ede212303c1ae723e7ba0f1993b55ddfaeac18f`). As with the earlier final
run, this post-run `EVIDENCE.md` is explicitly excluded to avoid a circular self-hash; the manifest
records that exclusion. The exact 62-line final `git status --short` is retained in
`git-status-final.log` under the same artifact root (SHA-256
`da8d738d6d5602b66ca4af6527cab64dc3f86e9dfab64f20d41079ad7efcc5de`). Final
`git diff --check` exited zero; its line-ending notices were warnings only, not whitespace errors.

Acceptance status:

- R3-S1 exact adoption preflight: **PASS**.
- R3-S2 stock signed repository boundary: **PASS**.
- R3-S3 healthy transport gate: **PASS** on round 1.
- R3-S4 transaction previews: base preview **PASS**; GCC preview **NOT RUN**, so the complete
  scenario is **UNVERIFIED/BLOCKED**.
- R3-S5 complete full update: **FAIL/BLOCKED** because committed output contained scriptlet and hook
  failures; the zero-remaining-upgrade check was intentionally not used to relabel it as success.
- R3-S6 shared retry: **PASS for the stop branch**; state changed and the error was non-transport,
  so no retry occurred.
- R3-S7 through R3-S11: **NOT RUN** because R3-S5 failed. No older race or gauntlet result was
  substituted.
- R3-S12 honest closure or stop: **PASS** through this mapped BLOCKED report.

Independent verification remains not authorized/performed. The latest complete application
gauntlet remains the earlier Revision 1 run and is historical evidence only; it is not a Revision 3
result.

### Honest execution notes and required next decision

Three read-only/evidence-wrapper corrections occurred and did not change package or source state:

1. The first preflight wrapper transcribed one expected mirrorlist hash incorrectly and stopped
   before writing its report or invoking pacman; the current file hash was independently rechecked
   before the successful preflight.
2. The first negative-control wrapper had a PowerShell pipeline syntax error, so the checker did
   not run; the corrected wrapper then produced the required fail-closed result without editing the
   verifier.
3. The first blocked-state serializer nested the preview JSON array, and its next run treated the
   expected missing-GCC query stderr as terminating. Both stopped read-only; the final serializer
   derives absence from the complete package snapshot and passed every state assertion.
4. The first final-closure wrapper treated Git's LF/CRLF notices as terminating PowerShell errors.
   The corrected wrapper retained the notices, checked Git's actual exit code `0`, and then passed
   the manifest, status, lock/process, and absent-GCC assertions without changing source or host
   state.

Completion now requires a newly reviewed SPEC revision that explicitly authorizes repair and
re-attestation of the committed MSYS2 transaction under a process-local MSYS `/usr/bin` PATH before
any GCC install. Only after the scriptlet/hook state is proven healthy may the exact GCC closure,
real compiler attestation, focused race, and one fresh complete gauntlet run. Revision 3 itself
does not authorize that repair, so the task remains **BLOCKED**.

## 12. Explicit blocked-snapshot ship decision

After receiving the Revision 3 BLOCKED result, the user directed:

```text
commit and push, làm sạch git rồi làm tiếp: SPEC Revision 4
```

This is explicit authorization to commit and push the documented blocked source snapshot despite
the missing GCC/race/gauntlet closure. It does not relabel Revision 3 as passing, authorize deploy or
production activation, or authorize the Revision 4 repair before that new SPEC is drafted and
separately approved. Generated `.artifacts/**` evidence remains intentionally uncommitted. The
final commit SHA and remote/CI conclusion are necessarily verified after this pre-commit report and
must not be inferred from the baseline SHA above.

The first cached pre-commit whitespace check rejected Markdown hard-break spaces in these newly
tracked SPEC/EVIDENCE files. The spaces were removed without changing their meaning; the staged
checker was rerun after the correction and is required to exit zero before commit.
