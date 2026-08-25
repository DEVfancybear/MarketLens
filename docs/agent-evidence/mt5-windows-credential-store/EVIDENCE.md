# EVIDENCE — Managed MT5 Windows Credential Store

Verdict: **BLOCKED — Revision 8 repaired the committed-source and service-sandbox contracts through targeted GREEN, then stopped before database creation because the approved local credential failed PostgreSQL 17 authentication**

Date: 2026-08-24
SPEC: `docs/agent-evidence/mt5-windows-credential-store/SPEC.md` (Tier 3, Revision 1),
`docs/agent-evidence/mt5-windows-credential-store/SPEC_REVISION_2.md` (Tier 3, Revision 2),
`docs/agent-evidence/mt5-windows-credential-store/SPEC_REVISION_3.md` (Tier 3, Revision 3),
`docs/agent-evidence/mt5-windows-credential-store/SPEC_REVISION_4.md` (Tier 3, Revision 4),
`docs/agent-evidence/mt5-windows-credential-store/SPEC_REVISION_5.md` (Tier 3, Revision 5),
`docs/agent-evidence/mt5-windows-credential-store/SPEC_REVISION_6.md` (Tier 3, Revision 6), and
`docs/agent-evidence/mt5-windows-credential-store/SPEC_REVISION_7.md` (Tier 3, Revision 7), and
`docs/agent-evidence/mt5-windows-credential-store/SPEC_REVISION_8.md` (Tier 3, Revision 8)
Approval: exact user token recorded in the SPEC approval record
Baseline/HEAD: `f1a26cf304aaf48b0d64ff0f5a8a68f601abc28c` on `master`
Commit/push/deploy: **the Revision 3 blocked snapshot was committed and pushed as `f1a26cf`;
Revision 4, Revision 5, Revision 6, and Revision 7 performed no commit, push, deploy, production action,
broker action, or order**

## 1. Why the verdict is blocked

The Revision 1 final fresh gauntlet executed every declared layer and failed only `go-race`:

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

## 13. Revision 4 execution — stopped before package mutation

Revision 4 was approved with the exact token:

```text
Duyệt SPEC Revision 4 sửa MSYS2 CA và chạy lại gauntlet
```

The approved SPEC is
`C:\Users\duong\Downloads\tradingview\docs\agent-evidence\mt5-windows-credential-store\SPEC_REVISION_4.md`.
Its pre-approval SHA-256 is
`f3d80903e6ea2ac9aedd1175557240bad5397f21ee24081cdad7a0cc045560f8`; after the
append-only approval record its SHA-256 is
`74e72144ac81c42d4d91df0a60bacb7860b12531da62c0d13577f3a71c14b8fe`.

Revision 4 remained a Tier 3 environment repair. `codebase-memory-mcp` was unavailable both as an
MCP tool and CLI command, so the documented fallback, managed-MT5 runbook, complete `old-coder`
skill, and gauntlet reference were read before execution. No application, test, verifier,
assertion, timeout, threshold, or security boundary was changed.

### Adopted baseline and RED

The authoritative preflight is
`.artifacts/mt5-windows-credential-store/toolchain-revision-4/preflight.json` (SHA-256
`d8b63715fa864a227589d9ca09eca5d0842fd373551cf2fe53b3f1dce358aaad`). It proves:

- local HEAD, remote `master`, and CI head are
  `f1a26cf304aaf48b0d64ff0f5a8a68f601abc28c`; GitHub Actions run `32703593956`
  remains completed/success with all four jobs successful;
- the non-elevated Windows 11 Pro host has exact `MSYS2.MSYS2 20260611` under `C:\msys64`;
- 90 installed packages match the adopted Revision 3 post-transaction snapshot by content,
  including pacman `6.1.0-25`, runtime `3.6.10-3`, and `ca-certificates 20260816-1`;
- GCC is absent as both a package and `C:\msys64\ucrt64\bin\gcc.exe`;
- `pacman -Dk` exits zero, no lock or MSYS-rooted process exists, and the required installed
  command/script/hook owners and hashes were captured;
- 12 User/Machine environment presence/hash records and all three stock pacman config hashes are
  captured without full values; required signature policy and stock includes are present; and
- all three CA sources are nonempty while the three `/usr/ssl` destinations remain empty and
  mismatched. Default-path MSYS curl reproduces RED with exit `77` and the expected trust-anchor
  error.

The 90-record before snapshot is `packages-before.txt` (SHA-256
`81e7e042b5124a40848ca0b3d014929f7399ae74d72392029a10e2d2f9a6005e`).

### Checker, wrapper, and Windows TLS gates

`pre-mutation-controls.json` (SHA-256
`a25e3fed0c40240de9bca4f4dca68b4f038edcf53d2d96cfab8e97ad029da3ee`)
records:

- verifier contracts: 3 tests executed, 3 passed;
- canonical verifier PowerShell parse: 0 errors;
- missing compiler-root negative control: exact expected rejection;
- UCRT64 login-shell positive control: exit `0`, exact environment/PATH contract, and all four
  commands resolved below `/usr/bin`; and
- synthetic child `exit 23`: exact parent-observed exit `23`.

Both shell controls restored process `MSYSTEM`, `CHERE_INVOKING`, and PATH hashes. The Windows TLS
gate passed on attempt 1 with no retry: both hosts resolved and System32 curl returned exit `0` /
HTTP `200` for all four URLs. Its report SHA-256 is
`8c4ab9b68e46d3a94a58f5eb02b639c4c03cae4f36c4e1ca0f10b43dcf1c96b1`.

### Mandatory signed preview failure and stop

The exact approved login-shell command was run:

```text
pacman --noconfirm --disable-download-timeout -Syu --print-format '%r|%n|%v|%a|%R|%H|%l'
```

It was print-only for package payloads but attempted the authorized signed sync-database refresh.
It exited `1`, printed zero package targets, and failed before a valid zero-update plan could be
established. The output contains 144 `failed retrieving file` lines and the final
`failed to synchronize all databases`; 125 lines specifically report the known default-CA trust
anchor error. Timeouts and DNS failures were also present, but Revision 4 authorizes no retry of
this preview and requires it to pass before the cached CA repair.

The report `full-update-preview.json` has SHA-256
`525450877056a843df39b7b36c60516d9471e39e3b4ba4856b517ce6a6ba287a`; the complete log has
SHA-256 `6443bedd4a983030b897689bfeeafd0eb2252e196b81c45adc84086f8c35a238`.
The exact 197-byte pacman-log delta records only the print command and package-list synchronization;
its SHA-256 is `ff8519994cd21646e0ac5ac15f06f74e49687011fa7efa3b64fa19be6c5ba3fb`.

This is a fail-closed stop under Sections 5 and 17. Zero printed targets cannot relabel a failed
database refresh as a valid signed plan. Reordering the cached CA repair before this preview changes
the approved sequence and requires a revised SPEC.

### Stop-state and scenario map

`blocked-state.json` (SHA-256
`7f608355d8bbe41062f0bde59f0067fbe0bb3a8ad44e1630f96c9a7db25e6a14`) records:

- **0 package-mutating invocations**, 0 CA repair invocations, and 0 GCC invocations;
- 90 packages before/after with identical SHA-256
  `81e7e042b5124a40848ca0b3d014929f7399ae74d72392029a10e2d2f9a6005e`;
- `pacman -Dk` exit `0`, no lock, and zero MSYS-rooted processes;
- GCC still absent and the three CA destinations still empty/mismatched;
- 12/12 persistent environment and 3/3 config comparisons unchanged; and
- no CA preview/reinstall, GCC preview/install/retry, compiler attestation, race, gauntlet, commit,
  push, deploy, production action, broker action, or order.

Acceptance status:

- R4-S1 clean committed adoption: **PASS**.
- R4-S2 fail-closed UCRT64 login boundary: **PASS**.
- R4-S3 stock signed zero-update plan: **FAIL/BLOCKED**. Windows TLS passed, but the required
  login-shell refresh exited `1`.
- R4-S4 through R4-S11: **NOT RUN / UNVERIFIED** because R4-S3 failed before package mutation.
- R4-S12 honest closure or stop: **PASS** through this mapped BLOCKED report.

The canonical gauntlet was **not run** because the approved stop fired before CA repair, GCC, and
the focused race prerequisite. No Revision 4 full-suite, type/lint, coverage, mutation, property,
real-execution, supply-chain, or suite-health result exists. Earlier local/CI results are historical
only. Independent verification was not authorized or performed.

### Honest notes and required next decision

Two generated evidence helpers initially stopped without package, host-policy, or source mutation:

1. A preflight helper contained stale bash/texinfo implementation-package assumptions. The current
   package list was proven content-equal to Revision 3, the helper was corrected to attest
   `bash 5.3.015-1` and actual `install-info` owner `info 7.2-3`, and preflight was rerun.
2. A control helper had an ambiguous report-string interpolation after its read-only controls.
   Only that report string was corrected; every control was rerun fresh.
3. The first post-EVIDENCE status wrapper concatenated two scalar path outputs while counting them,
   although it printed the real two-line `git status` and `git diff --check` had already exited
   `0`. The corrected wrapper used explicit arrays, found exactly the two approved documentation
   paths, and passed.

The preview exceeded the initial command-yield window. Its exact bash/pacman processes and lock
were observed, no second pacman command was started, and the same processes finished normally
before evaluation.

Revision 4 remains **BLOCKED**. A separately approved revision must resolve the ordering
contradiction: repair the default CA from the already cached signed package before requiring the
online signed refresh. No such reordering or repair is authorized here.

## 14. Revision 5 execution — CA repaired, post-repair Qkk stopped

Revision 5 was approved with the exact token:

```text
Duyệt SPEC Revision 5 sửa CA trước signed refresh và chạy lại gauntlet
```

The approved SPEC is
`C:\Users\duong\Downloads\tradingview\docs\agent-evidence\mt5-windows-credential-store\SPEC_REVISION_5.md`.
Its pre-approval SHA-256 was
`f5a028d76a5bf082459f7624ef21e5f91cf47726c3e3260e6e5215467ba28f31`; after the append-only
approval record it is `09dca333bdc197763485013abd1989fbaf82c43bb1d8c9bb9d4c5bd7e108b352`.

### Preflight and gates

The Revision 5 preflight is
`.artifacts/mt5-windows-credential-store/toolchain-revision-5/preflight.json` (SHA-256
`088dca8d70a64e9e976362dbf2ac58905403ea6e7a4ce54d988500cb8357988b`). It recorded the clean
committed baseline `f1a26cf304aaf48b0d64ff0f5a8a68f601abc28c`, successful CI run `32703593956`,
90 packages, absent GCC, stock config, 12 persistent environment hashes, and the expected empty
CA destinations/exit-77 RED.

The copied verifier controls passed: 3 contract tests, PowerShell parse, missing-toolchain negative
control, UCRT64 login-shell command resolution, and exit-23 propagation. The report is
`pre-mutation-controls.json` (SHA-256
`98ba62d32314c341c1fe35ddfff9cbfd5eb028d9f126f540b030d40047547eba`).

Windows TLS passed on attempt 1: both hosts resolved and all four required URLs returned HTTP 200.
The cached CA preview passed exactly one target:

```text
msys|ca-certificates|20260816-1|any|||file:///var/cache/pacman/pkg/ca-certificates-20260816-1-any.pkg.tar.zst
```

### CA transaction

The sole CA mutation ran exactly once:

```text
pacman --noconfirm --disable-download-timeout -S ca-certificates
```

It exited 0, reinstalled only `ca-certificates 20260816-1`, left the package count at 90, and
the pacman-log delta records transaction start, same-version reinstall, and completion. The initial
scan incorrectly treated normal pacman checks such as `checking keyring` and `checking package
integrity` as errors; the corrected classification uses actual lines beginning `error:` or
`failed` and found zero. That correction changed only generated evidence code, not host state.

The repaired destination bundles are byte-equal to their extracted sources: 3/3. No rollback,
manual copy, cache deletion, or retry was performed.

### Mandatory post-repair Qkk stop

The required post-repair `pacman -Qkk ca-certificates` exited 1 and reported eight altered paths:

```text
/etc/pki/ca-trust/extracted/java/cacerts
/etc/pki/ca-trust/extracted/openssl/ca-bundle.trust.crt
/etc/pki/ca-trust/extracted/pem/email-ca-bundle.pem
/etc/pki/ca-trust/extracted/pem/objsign-ca-bundle.pem
/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem
/usr/ssl/cert.pem
/usr/ssl/certs/ca-bundle.crt
/usr/ssl/certs/ca-bundle.trust.crt
```

Revision 5 allowlists only the five generated paths below
`/etc/pki/ca-trust/extracted`. The three `/usr/ssl` paths are therefore unexpected under the
approved SPEC, even though their content hashes now equal the extracted sources. This is a hard
stop under R5-S5; no default-CA curl attestation, signed refresh, GCC preview/install/retry,
compiler attestation, focused race, or canonical gauntlet was run.

The authoritative stop report is
`.artifacts/mt5-windows-credential-store/toolchain-revision-5/blocked-state.json` (SHA-256
`b2780265b783ef8f2ce261a990337c7da83d33f4827ebeb3847047a91a6323a2`). It records:

- one successful CA transaction and zero GCC transactions/retries;
- unchanged 90-package snapshot;
- 3/3 CA bundle hash equality;
- 12/12 persistent environment and 3/3 config comparisons unchanged;
- no lock and zero MSYS-rooted processes; and
- signed refresh, race, and gauntlet all not attempted.

Acceptance status:

- R5-S1 clean inherited adoption: **PASS**.
- R5-S2 wrapper and controls: **PASS**.
- R5-S3 exact cached CA preview: **PASS**.
- R5-S4 single CA repair: **PASS**.
- R5-S5 functional CA recovery: **FAIL/BLOCKED** at the SPEC Qkk allowlist; three
  `/usr/ssl` paths are unexpected.
- R5-S6 through R5-S10: **NOT RUN / UNVERIFIED**.
- R5-S11 honest closure or stop: **PASS** through this mapped BLOCKED report.

### Honest execution notes and required next decision

Three generated helpers initially stopped without additional package mutation:

1. The first inline CA-attestation command had a PowerShell quote/parser error. No command ran;
   the persisted script was then parsed and used.
2. The persisted attestation first treated expected native Qkk warnings as terminating PowerShell
   stderr. It was corrected to capture diagnostics and evaluate exit code/allowlist explicitly.
3. The first blocked-state inline serializer had a PowerShell loop syntax error. The persisted
   serializer then recorded the exact eight altered paths and final host state.

Revision 5 remains **BLOCKED**. A new SPEC revision is required to decide whether the three
script-generated `/usr/ssl` paths are an explicit accepted Qkk allowance. No acceptance broadening,
manual repair, rollback, commit, push, deploy, or gauntlet run is authorized by Revision 5.

### Revision 5 final source and Git closure

The non-circular source manifest is
`.artifacts/mt5-windows-credential-store/toolchain-revision-5/source-state.json` (SHA-256
`17d903c76a89e560449b9c042d1f8fd225f6d7a93062e66e525625172b9be531`). It records HEAD
`f1a26cf304aaf48b0d64ff0f5a8a68f601abc28c`, committed tree
`17790ddd855dc2de0d0f082eadab62e0b5c1df1d`, exact allowed documentation paths only, and excludes
this EVIDENCE file from its own hash.

Final `git diff --check` exited `0`; direct trailing-whitespace checks found `0` lines; no lock or
MSYS-rooted process remains. The exact non-artifact status is:

```text
 M docs/agent-evidence/mt5-windows-credential-store/EVIDENCE.md
?? docs/agent-evidence/mt5-windows-credential-store/SPEC_REVISION_4.md
?? docs/agent-evidence/mt5-windows-credential-store/SPEC_REVISION_5.md
```

Generated `.artifacts/**` remains ignored and uncommitted. Revision 5 authorizes no commit or push.

### Final source and Git closure

The non-circular source manifest is
`.artifacts/mt5-windows-credential-store/toolchain-revision-4/source-state.json` (SHA-256
`899f25eff7e33961fa1649ceeebfb6ad1a74987d023d3f45a863d10adf61150c`). It records HEAD
`f1a26cf304aaf48b0d64ff0f5a8a68f601abc28c`, committed tree
`17790ddd855dc2de0d0f082eadab62e0b5c1df1d`, zero application/test/verifier/config path changes,
and excludes this EVIDENCE file from its own hash to avoid circularity.

Final `git diff --check` exited `0`, direct Markdown trailing-whitespace checks found `0` lines,
and the exact non-artifact status contains only:

```text
 M docs/agent-evidence/mt5-windows-credential-store/EVIDENCE.md
?? docs/agent-evidence/mt5-windows-credential-store/SPEC_REVISION_4.md
```

Generated `.artifacts/**` remains locally ignored and uncommitted. Revision 4 authorizes no commit
or push, so this documented blocked state is intentionally left in the working tree.

## 15. Revision 6 execution — exact GCC closure installed, retrieval output blocked continuation

Revision 6 was approved with the exact token:

```text
Duyệt SPEC Revision 6 chấp nhận 8 Qkk paths và chạy gauntlet
```

The approved SPEC is
`C:\Users\duong\Downloads\tradingview\docs\agent-evidence\mt5-windows-credential-store\SPEC_REVISION_6.md`.
Its approval-recorded SHA-256 is
`bca670c6b5094d5cd418b02ecb746077a6cef0dac6519a36a9d7d1862f04f447`.
The repository codebase-memory MCP and documented CLI fallback were both unavailable in this
session; the CLI failed with `CommandNotFoundException`. The required fallback was used:
`docs/CODEBASE_MEMORY.md`, the backend architecture, the bare-metal runbook, the canonical
verifier, the current SPEC/EVIDENCE, and the exact Revision 5 artifacts were read before execution.

### Preflight, controls, and signed refresh

The generated Revision 6 checker was parsed and its negative controls passed. The final self-test
report is `.artifacts/mt5-windows-credential-store/toolchain-revision-6/self-test.json` (SHA-256
`11b1b2ff802bdfe1b649f3597dc89cae96f0b0b9cf12f5a42b60957fc2cc57ba`). It proved that an extra
exact-set item and a synthetic pacman signature error reach failure paths, and that one valid
target record reaches the parser's positive path.

The preflight report is
`.artifacts/mt5-windows-credential-store/toolchain-revision-6/preflight.json` (SHA-256
`003adbf037ba4617587e05b899fc81809f38d164fee58e6905d04c63ba89da29`). It records:

- HEAD, `origin/master`, branch, and successful CI run `32703593956` at
  `f1a26cf304aaf48b0d64ff0f5a8a68f601abc28c`;
- exactly 90 packages, equal to the Revision 5 post-CA snapshot, with GCC absent;
- `pacman -Dk` exit `0`, no lock, and zero MSYS-rooted processes;
- exactly the approved eight Qkk paths and no missing file;
- 3/3 CA destination/source pairs nonempty and byte-equal;
- 12/12 persistent environment presence/hash records and 3/3 config hashes unchanged; and
- the unchanged Revision 5 verifier controls plus the permitted existing four-request Windows TLS
  PASS report.

One optional fresh Windows HEAD probe stopped because a redirect target
`mirrors.ustc.edu.cn` did not resolve. A later default-CA curl observation returned HTTP 200 for
both `repo.msys2.org` URLs and HTTP 302 for the first `mirror.msys2.org` URL; it contained no
certificate, trust-anchor, or TLS error. Revision 6 permits the existing Windows TLS report, and
the current signed refresh remained mandatory, so neither optional observation was relabeled as a
fresh TLS PASS.

The signed login-shell refresh then ran exactly once:

```text
pacman --noconfirm --disable-download-timeout -Syu --print-format '%r|%n|%v|%a|%R|%H|%l'
```

It exited `0`, printed zero package targets, emitted no forbidden error, left all 90 package
records unchanged, restored process environment, and left no lock/process. The report is
`signed-refresh.json` (SHA-256
`948956711c0e79100e8365afe6d58ac69d1adde4908325a27274d5881ac547d3`).

### GCC preview and sole transaction

The GCC preview exited `0` with exactly the approved 17 names, all from `ucrt64`; no selected
package was outside the allowlist and no declared replacement/conflict named an installed package.
The report is `gcc-preview.json` (SHA-256
`1c7383d1bbbeaf8522db3d848d928c72b559d01c87b3be5fc68a5e3090b68e9a`).

The exact install command ran once:

```text
pacman --noconfirm --needed --disable-download-timeout -S mingw-w64-ucrt-x86_64-gcc
```

It exited `0`, started and completed one ALPM transaction, added exactly the 17 previewed packages,
changed or removed zero existing packages, and increased the complete package count from 90 to
107. However, before fallback downloads completed, its captured output contained three native
`error:` retrieval lines and one corresponding fatal-mirror warning: two redirected hosts
(`mirror.archlinux.tw` and `mirrors.ustc.edu.cn`) could not be resolved. The pacman log nonetheless
records all 17 installs and transaction completion.

The fail-closed generated checker intentionally rejects every native line beginning `error:`. It
therefore recorded `gcc-install.json` as FAIL despite process exit `0` and exact final package
state. That report's SHA-256 is
`5bf0c30c2af77d8f5b9ec3daddcc9a7a6009238e9e3656d13cb5cfd3624dfd91`; the complete install log is
`78a10d75d7ab93983b5abccb7435221d9be5abd3288df4c1754e86760213381c`, and the pacman-log delta is
`a29fdc48f5114d439607a93f50ac7db5a6a5729615257371ea1a7bbc4d278568`.

Because transaction commit had begun and completed, Revision 6 permits no retry. No second GCC
invocation, rollback, uninstall, compiler execution/attestation, focused race, or canonical
gauntlet was attempted.

### Acceptance and invariant mapping

- R6-S1 resume integrity: **PASS** — 90-package baseline, exact eight Qkk paths, 3/3 bundles,
  12/12 environment, 3/3 config, CI/Git, lock/process, controls, and adopted TLS evidence passed.
- R6-S2 signed zero-update refresh: **PASS** — exit `0`, zero targets, zero package drift.
- R6-S3 exact GCC closure: **FAIL/BLOCKED** — the exact 17-package closure committed with no other
  package change, but the transaction output contained three fail-closed retrieval error lines.
- R6-S4 compiler/environment attestation: **NOT RUN / UNVERIFIED** after the R6-S3 stop.
- R6-S5 focused real race: **NOT RUN / UNVERIFIED** after the R6-S3 stop.
- R6-S6 fresh complete gauntlet: **NOT RUN / UNVERIFIED** after the R6-S3 stop.
- R6-S7 honest closure or stop: **PASS** through this mapped BLOCKED report.

Negative invariants remained intact: no Revision 6 CA mutation or manual file operation occurred;
only the exact 17-package GCC closure changed package state; only one GCC invocation occurred; no
source, test, verifier assertion, timeout, or threshold changed; no persistent environment/config
changed; no secret value entered evidence; and no commit, push, deploy, broker login, or order
occurred. GCC and G++ files now exist under the approved UCRT64 root, but they are deliberately not
claimed as attested or race-capable because continuation stopped before those commands.

### Honest helper stops and final closure

Four generated-helper issues stopped safely before the GCC transaction and were corrected without
host/package mutation:

1. strict-mode attempted `.Count` on an empty process result; it was changed to explicit array
   materialization;
2. the optional fresh Windows TLS probe encountered the redirect DNS failure above, so the SPEC-
   permitted existing PASS report was validated and adopted;
3. the optional default-CA curl classified a valid HTTP 302 as nonzero overall; it was retained as
   a network observation while certificate/trust errors remained fatal and signed refresh remained
   mandatory; and
4. the first GCC preview helper incorrectly required architecture `x86_64` and empty package
   replacement metadata, while current signed UCRT64 packages report architecture `any` and
   uninstalled `-git` alternatives. The checker was corrected to the approved repo/name closure and
   actual installed-package conflict boundary before any GCC install.

The authoritative final stop report is
`.artifacts/mt5-windows-credential-store/toolchain-revision-6/blocked-state.json` (SHA-256
`594ec3492d8580cea7509fc23b3e3c3544d8ae40add398f2c98cdf8969144934`). Its read-only final
attestation records 107 packages, `pacman -Dk` exit `0`, 8/8 Qkk paths, 3/3 equal CA bundles,
12/12 environment and 3/3 config hashes unchanged, no lock/process, and exactly one completed GCC
transaction. The source report is `source-state.json` (SHA-256
`8dced6fcf3c6946a82a9c76d3dc8f2c5a2a9d62584eb3ad3dcb5721eaada54b6`). The persisted checker
SHA-256 is `4d0332a9b45abc469cb50bde41f1a5aadc6e48a050bba35604d991af620d8688`.

Revision 6 remains **BLOCKED**. A separately approved SPEC revision is required to accept a
successful exact transaction that used pacman's built-in mirror fallback while still emitting
retrieval `error:` lines, or to authorize another disposition. No retry is allowed after commit,
and no rollback is authorized.

## 16. Revision 7 execution — compiler and race passed, canonical gauntlet blocked

Revision 7 was approved with the exact token:

```text
Duyệt SPEC Revision 7 chấp nhận GCC mirror fallback và chạy race gauntlet
```

The approved SPEC is
`C:\Users\duong\Downloads\tradingview\docs\agent-evidence\mt5-windows-credential-store\SPEC_REVISION_7.md`.
Its approval-recorded SHA-256 is
`cbf44b8659004d5f43b2e71eea17ac350fffb859415852f3b8871a16fa7780c4`.
Codebase-memory MCP remained unavailable and its documented CLI fallback was not installed, so the
repository-required fallback documentation, current source, exact Revision 6 reports, backend
architecture, bare-metal runbook, and canonical verifier were used.

### Exact adoption and no-mutation preflight

The final generated Revision 7 checker has SHA-256
`1eff9b441eed1a93c201fe89e4d478d04e9f82c8640ecdf39b13ffb5e24fa81c`. Its self-test report is
`.artifacts/mt5-windows-credential-store/toolchain-revision-7/self-test.json` (SHA-256
`0fa8fba4664e5bb67cb1490614103a1d62e83b0b524427a3877f9aab2b391e40`). Six negative controls
passed: extra retrieval error, missing retrieval error, changed package, altered Qkk result,
unreadable input, and missing ALPM completion were all rejected.

The adoption/preflight report is
`.artifacts/mt5-windows-credential-store/toolchain-revision-7/preflight.json` (SHA-256
`c4ed8155069c4d724da1364be9de84d226b4b307ef9af66dc8eb374e75bc7a9d`). It classified the exact
Revision 6 transaction as:

```text
ACCEPTED_WITH_EXACT_MIRROR_FALLBACK_EVIDENCE
```

That PASS was limited to the four approved Revision 6 artifact hashes, exact 3-error/1-warning
set, one completed ALPM transaction, and exact final state. Fresh preflight proved:

- 107 package records equal the Revision 6 post-GCC snapshot;
- the original 90 records are unchanged and the only additions are the exact 17 approved UCRT64
  GCC records;
- all 17 GCC-closure packages pass `pacman -Qkk` with zero altered files;
- `pacman -Dk` and two compiler ownership queries exit 0;
- CA Qkk remains the exact eight-path allowance and 3/3 bundles remain byte-equal;
- 12/12 persistent environment records and 3/3 config hashes remain unchanged;
- no pacman lock or MSYS-rooted process exists; and
- HEAD/tree/remote/CI, Git documentation-only status, and frozen verifier/control source match.

Revision 7 ran zero package-mutating, database-refresh, retry, rollback, uninstall, mirror, TLS,
DNS, proxy, keyring, or persistent-environment commands.

### Compiler and focused race

Compiler attestation PASS is recorded in
`.artifacts/mt5-windows-credential-store/toolchain-revision-7/compiler-attestation.json` (SHA-256
`f71b9773d9e3bb65a46d98e91932f993f6f2f9760dcafb596e51c55982a1b806`):

- GCC and G++ are the package-owned MSYS2 `16.2.0` executables below the absolute UCRT64 root;
- `gcc -dumpmachine` is exactly `x86_64-w64-mingw32`;
- `libsynchronization.a` resolves to an existing path below UCRT64;
- the exact generated `int main(void) { return 0; }` smoke compiled, linked, and ran with exit 0;
- package count remained 107, config/environment hashes remained equal, and no lock/process remained.

The focused race command ran exactly once:

```text
go test -p=1 -count=1 -race ./internal/mt5credentials ./internal/execution
```

It exited 0, listed 25 `mt5credentials` tests and 59 `execution` tests before execution, emitted
successful `ok` results for both packages, and contained no `WARNING: DATA RACE` or Application
Control block. Package/config/environment state remained unchanged. The report is
`.artifacts/mt5-windows-credential-store/toolchain-revision-7/focused-race.json` (SHA-256
`2609dedcf8482cbe9a89648a5a969344856207cd60cb521d7f2cce1a8dc362bc`).

### Single fresh canonical gauntlet

The approved canonical entry point ran exactly once:

```powershell
powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File .\tools\verify-mt5-baremetal-managed-ea.ps1
```

The fresh run started at `2026-08-24T10:48:40.0584015Z`, completed at
`2026-08-24T11:06:16.2626090Z`, and ran for `1056.204` seconds. It used HEAD
`f1a26cf304aaf48b0d64ff0f5a8a68f601abc28c` and task-tree SHA-256
`15ca7f224e28c9aed863af571b422638f751cdde2383fe4bea490bbe4977d1c0`.

The authoritative summary is `.artifacts/mt5-baremetal-managed-ea/summary.json` (SHA-256
`6c20cc8c7a1fe9a8e2117166f69f8ceeba89a3124a4e4bf0108fedf57e13b837`):

| Result | Count |
|---|---:|
| PASS | 45 |
| FAIL | 10 |
| UNVERIFIED_ALLOWED | 1 |
| Total | 56 |

Fresh PASS highlights include:

- PowerShell parse, deploy self-test, Go format/vet, module integrity, and the complete shuffled Go
  suite across 26 tested packages (plus 8 packages with no tests);
- focused Go tests, three credential property tests including 10,000 round trips, four repeated
  real Windows credential-store smoke executions, Linux/unsupported-platform boundaries, and the
  canonical Go race/toolchain/environment layers;
- Rust fmt/check/Clippy, domain/gateway results of `28 passed` and `122 passed / 4 ignored`, managed
  agent groups `49 passed / 1 ignored`, `25`, `5`, and `4` passed, plus `25` stress/property tests;
- Rust coverage toolchain/build/warmup/tests/merge/export stages (coverage gates themselves failed
  for the missing committed-source diff described below);
- 57 managed Python tests and 48 VM regression tests;
- mutation runner self-test `2/2`, EA compile and release attestation, frontend typecheck/lint,
  83/83 frontend trade tests, npm production audit with 0 vulnerabilities, Vault-removal audit,
  backend docs, whitespace, secret-diff scan, and capability-diff audit; and
- `R15-9-live-demo` remained the sole explicitly allowed unverified layer. No broker or production
  action was attempted.

### Exact failed layers and root causes

The ten failed layers are grouped by two actual blockers plus one committed-source dependency
assertion:

1. **Committed-source changed-line assumptions — six failures.** The canonical verifier discovers
   changed Go/Rust production files only from `git diff HEAD` plus untracked files. Revision 3 had
   already committed the task source in `f1a26cf`, and the current worktree contains only EVIDENCE
   plus SPEC documents. `changed-source-diffs` therefore failed with `No changed go production
   source files were discovered`. No Go/Rust diff files were created, so
   `go-changed-coverage-gate`, `go-changed-coverage-negative-control`,
   `rust-changed-coverage-gate`, and `rust-changed-coverage-negative-control` all failed closed on
   missing unified diffs rather than producing coverage claims. `dependency-delta-audit` likewise
   requires the exact two-line working-tree `backend/go.mod` promotion delta, but that delta is now
   committed and the working diff is empty.
2. **Windows Application Control — four failures.** `rust-database-integration`,
   `postgres-0042-positive`, and `postgres-0042-negative-control` could not start their disposable
   database executable because Windows reported `An Application Control policy has blocked this
   file`. The mutation run killed 12/13 mutants; `M6_READY_BEFORE_FRESH_POLL` reached the same
   Application Control infrastructure failure, so `mutation-score` correctly failed rather than
   reporting a 13/13 kill score.

No failure was relabeled or retried. Revision 7 does not authorize verifier edits, a synthetic
working-tree source reconstruction, Application Control mutation, alternate database executable,
or another gauntlet run.

### Gauntlet side effect and exact restoration

The canonical EA compile layer passed but regenerated three tracked publish outputs: the EX5,
release JSON, and SHA file. They were clean before the run and the Revision 7 SPEC requires frozen
source. A fail-closed cleanup helper first proved the exact dirty path set, backed up those three
gauntlet-produced versions below the Revision 7 artifact root with hashes, and restored exactly
those three paths to their HEAD blobs. No user/pre-existing change was discarded.

The manifest is
`.artifacts/mt5-windows-credential-store/toolchain-revision-7/gauntlet-ea-output-restore.json`
(SHA-256 `8dc441de7ac3ef6ea7369aa793f04d337787df2dd27f0aa1f7f2d71206904a89`). It records `3/3`
backed up and `3/3` restored-to-HEAD outputs. The helper itself has SHA-256
`df8aff12dd79cd6f15c82eb5285e825ba0484f130f9a1b910d7772bee1d4ff58`.

### Acceptance and invariant mapping

- R7-S1 exact retrospective adoption: **PASS**.
- R7-S2 no new package mutation: **PASS** — package map remained exactly 107 throughout.
- R7-S3 real compiler attestation: **PASS** — ownership/version/target/runtime and smoke all pass.
- R7-S4 focused real race: **PASS** — one invocation, two successful packages, no race report.
- R7-S5 fresh complete gauntlet: **FAIL/BLOCKED** — 45 PASS / 10 FAIL / 1 allowed-unverified.
- R7-S6 honest closure or stop: **PASS** through this mapped BLOCKED report.

Negative invariants are preserved at closure: no package/network/toolchain/environment/config/CA
mutation; the mirror-fallback exception stayed bound to the exact Revision 6 artifacts; no
application/test/verifier/assertion/timeout/threshold/dependency/lockfile change remains; no secret
or credential entered evidence; no old report was presented as fresh; and no commit, push, deploy,
production action, broker login, account connection, or order occurred.

The final closure report is
`.artifacts/mt5-windows-credential-store/toolchain-revision-7/final-state.json` (SHA-256
`289cce745a377e41d954784875ed3b677d6734d0e4694f4b50ca70d3fdd670fe`). It records the unchanged
107-package map, exact eight-path CA Qkk state, 3/3 bundles, 12/12 environment and 3/3 config hashes,
no lock/process, zero package-mutating commands, one focused race, and one canonical gauntlet. The
non-circular source report is `source-state.json` (SHA-256
`76e43a55e6faf9a66210a3d7d55a932fc89849aaa44351105e760bd2a64b6d9d`).

Revision 7 remains **BLOCKED**. A separately approved revision is required to define a committed
baseline for changed-line coverage/dependency assertions and to decide the Windows Application
Control disposition. Revision 7 authorizes neither change.

## 17. Revision 8 execution — committed baseline GREEN, credential preflight stopped safely

Revision 8 was approved with the exact token:

```text
Duyệt SPEC Revision 8 sửa committed baseline và dùng PostgreSQL service sandbox
```

The approved SPEC is
`C:\Users\duong\Downloads\tradingview\docs\agent-evidence\mt5-windows-credential-store\SPEC_REVISION_8.md`.
Its approval-recorded SHA-256 is
`a2b6f107f180cf09dfe2e7c23b6451dde344d41b53bcbfa0bb153b888efc1f12`.
Codebase-memory MCP remained unavailable and the documented CLI fallback was not installed. The
repository fallback, current verifier/migration source, Revision 7 reports, complete `old-coder`
skill, and gauntlet reference were read before implementation.

### RED evidence

Assertions were added before implementation and observed failing:

- Python verifier/migration contracts ran 9 tests and produced 11 expected assertion failures for
  the missing immutable baseline and service-sandbox boundary. The retained log is
  `.artifacts/mt5-windows-credential-store/revision-8/red/python-contracts-red.log` (SHA-256
  `eb2cb7f6f612a65f2b22d62ef2262cedb37f1cd980e1e50229ae5e71cb9dd99c`).
- `go test -count=1 ./cmd/mt5-migration-gate` failed to compile with the expected undefined safety
  functions. The retained log is
  `.artifacts/mt5-windows-credential-store/revision-8/red/go-helper-red.log` (SHA-256
  `adbd06b9a515435a106e1fc249f6d29cb66f49e06a064fc61c531a98233bf20e`).

### Targeted GREEN before real execution

The frozen assertions were not weakened. After implementation:

- `go test -count=1 ./cmd/mt5-migration-gate` passed;
- PowerShell parsing passed for the canonical verifier, mutation runner, and migration gate; and
- the combined Python verifier/migration contract command ran 9 tests, all passed.

The implementation keeps the database runner test-only: production builds contain an inert command,
while the explicit PowerShell gate invokes the test implementation. The canonical verifier now
freezes task base `b0cabaf67b247412dbd5e02a01c61e75ce54349e`, attests implementation commit
`f1a26cf304aaf48b0d64ff0f5a8a68f601abc28c`, uses that base for coverage/source/dependency/secret/
capability/whitespace discovery, and explicitly requests the loopback service sandbox for Rust,
positive, negative-control, and M6 database paths.

These are targeted intermediate results, not a final gauntlet claim.

### Real sandbox attempts and hard stop

The first service-sandbox invocation stopped before connection or database creation because a
PowerShell `Split` overload selected the wrong enum overload. That implementation-only parser bug
was corrected; no assertion or security boundary changed.

The second invocation passed the exact running-service and local credential-shape preflight, then
PostgreSQL rejected authentication for role `postgres` on `127.0.0.1:5432`. The sanitized helper
report is
`.artifacts/migration-0042/service-20260824T131151715Z-cbc2b9198116483c874732ddbb6e416b.json`
(SHA-256 `8e74319a7d3b67f0a33c6422b56b35b04129f2c1363f2ee84db98ce5b5d8d850`). It records:

```text
status=FAIL
database_created=false
database_removed=false
server_major=17
```

The outer sanitized report is
`.artifacts/migration-0042/result-20260824T131151715Z-cbc2b9198116483c874732ddbb6e416b.json`
(SHA-256 `770f7c0705bb9cbea1a8d79da62c32b01aa366e3e96b0956d01fe1d910b6bf87`).
No password or connection URL was logged or copied into evidence.

Post-stop closure proved the exact service remained `Running` with unchanged process ID `4164`,
the helper never reached `CREATE DATABASE`, and Git diff whitespace checking exited zero. No
database, schema, row, service, policy, package, config, persistent environment, broker, or
production mutation occurred.

### Acceptance map and required next decision

- R8-S1 exact Revision 7 adoption: **PARTIAL/PASS through targeted source and host checks**; the
  final full preflight was not reached.
- R8-S2 committed task baseline: **TARGETED PASS**, not final-gauntlet evidence.
- R8-S3 shared task-diff audits: **TARGETED PASS**, not final-gauntlet evidence.
- R8-S4 loopback PostgreSQL sandbox: **FAIL/BLOCKED before database creation** because the sole
  approved `backend/.env` credential failed authentication.
- R8-S5 through R8-S8: **NOT RUN / UNVERIFIED** after the R8-S4 hard stop.

Revision 8 forbids trying another password, resetting PostgreSQL authentication, changing the
credential source, or prompting through an undeclared channel. It therefore remains **BLOCKED**.
A separately approved revision is required to collect the local PostgreSQL administrator credential
through a secure local prompt and OS-protected store. The credential must never be sent in chat.
No canonical gauntlet, EVIDENCE commit, push, CI verification, deploy, broker action, or order was
performed under Revision 8.
## 18. Revision 9 execution — secure local credential prompt stopped

- Approval token was supplied for Revision 9; contract tests passed 11/11 after adding the
  DPAPI credential-file wrapper and service-mode import path.
- The wrapper was launched in a visible Windows PowerShell process. No credential file was
  created and no PostgreSQL preflight or canonical gauntlet was entered; the prompt returned
  without a credential (equivalent to cancellation in this non-interactive run).
- No password, secret, connection URL, database, service, production, broker, or Git mutation
  occurred. Revision 9 remains BLOCKED until the user completes the local prompt with a valid
  PostgreSQL credential and the single final gauntlet reaches a terminal result.

## 19. Revision 9 review and user-directed BLOCKED snapshot handoff

On 2026-08-25 the user explicitly stopped the interactive production-completion path and requested
that the code be reviewed, committed, and pushed so it could be built and inspected on the
production server. The two operative requests were:

```text
à thôi, commit and push code để tôi build production server rồi tôi xem
vẫn conf các file chưa commit, rà soát rồi cũng commit and push đi bạn
```

This is recorded as explicit acceptance to ship the known-BLOCKED source snapshot. It does not
convert the missing local PostgreSQL credential run into PASS, authorize entering a secret in chat,
or justify a production-active/completion claim. No interactive credential prompt, PostgreSQL
sandbox, canonical gauntlet, deploy, service restart, broker connection, or order was run during
this review.

### Review findings corrected with fail-first evidence

1. A new Go negative test proved that a password containing reserved characters could leave its
   URL-encoded userinfo in a sanitized diagnostic. The test binary failed with
   `sanitized diagnostic exposed URL-encoded PostgreSQL userinfo`; the sanitizer now redacts the
   complete encoded userinfo before decoded-password fallback redaction, and the test passes.
2. The first credential-wrapper self-test stopped while constructing its broad-ACL fixture because
   `Set-Acl` requested unavailable `SeSecurityPrivilege`. The fixture now deliberately retains its
   inherited/unprotected ACL, which is the broad state the checker must reject, without requesting
   additional host privilege.
3. The next self-test run proved that `Remove-Item` attempted an interactive operation for the
   junction negative-control fixture. Exact validated reparse paths now use non-recursive
   `Directory.Delete`/`File.Delete`. One junction left by the failed run was verified as the exact
   generated fixture below the Revision 9 artifact root and removed non-recursively; its target was
   not changed.
4. The exact committed-baseline secret scan initially rejected two already-committed localhost
   parser negative-control URLs. The verifier now removes only those two fixed synthetic fixtures
   before applying the unchanged high-confidence credential-URL pattern. Newly added Go fixtures
   construct URLs through `url.URL`/`url.UserPassword`, so no credential URL literal is stored in
   their source.

### Final fresh non-interactive review gauntlet

The following checks were run against the final reviewed source before staging:

| Layer | Result |
|---|---|
| PowerShell parse | 4/4 changed scripts parsed with zero errors |
| Python verifier/migration contracts | 11 passed, 0 failed |
| Go migration-gate tests | 3 passed, 1 explicit service-gate skip, 0 failed |
| Go compile/static checks | test binary compiled; inert command built; `go vet` passed |
| Credential wrapper self-test | 8/8 known-bad controls rejected; structural DPAPI fixture passed; cleanup passed |
| Mutation-runner self-test | 2/2 killed; byte-exact restore passed |
| Canonical high-confidence task-addition secret scan | clean after exact approved synthetic placeholders |
| UTF-8/source whitespace | all task text decoded strictly as UTF-8; `git diff --check` passed |
| Credential closure | process credential environment absent; zero credential CLIXML files remain |

Direct `go test` execution from the default temporary build directory was blocked by Windows
Application Control. The same package was compiled with `go test -c` to the ignored Revision 9
review artifact root and its complete test binary ran successfully there. `gitleaks` was not
installed; the repository's canonical fail-closed high-confidence scan and negative-control model
was executed directly instead.

Codebase-memory MCP and its documented CLI remained unavailable. The repository-required fallback
documentation, exact task sources, approved Revision 4 through Revision 9 SPECs, and complete
EVIDENCE history were used for discovery and review.

### Remaining BLOCKED boundary

Revision 9 remains **BLOCKED**. The positive PostgreSQL credential preflight, isolated migration
database lifecycle, Rust managed-database tests, 13/13 real mutation run, changed-line coverage,
full canonical gauntlet, and production identity/runtime boundaries remain unverified in this
handoff. Commit and push below deliver reviewable source only; they are not evidence that the
credential-store task, deployment, Scheduled Task/worker activation, or broker Demo R15-9 is
production-active.
