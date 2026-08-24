# SPEC — Close the Go Race-Detector Toolchain Blocker (Tier 3, Revision 2)

Status: **AWAITING EXPLICIT APPROVAL — NO INSTALLATION OR IMPLEMENTATION AUTHORIZED**

Date: 2026-08-24
Repository: `C:\Users\duong\Downloads\tradingview`
Baseline HEAD: `b0cabaf67b247412dbd5e02a01c61e75ce54349e` on `master`
Parent SPEC: `docs/agent-evidence/mt5-windows-credential-store/SPEC.md` (Revision 1)
Parent evidence: `docs/agent-evidence/mt5-windows-credential-store/EVIDENCE.md`
Approval token: **`Duyệt SPEC Revision 2 cài MSYS2 UCRT64 GCC và chạy lại gauntlet`**

## 1. Objective and current evidence

Close the only failing layer from the final Revision 1 gauntlet by installing a bounded,
build-only Windows C toolchain and rerunning the complete managed-MT5 gauntlet from a fresh report
root.

The current host is Windows 11 Pro 64-bit (`10.0.26200`), Go is
`go1.26.5 windows/amd64`, `CC=gcc`, and `gcc.exe`, `clang.exe`, `cl.exe`, `pacman.exe`, and
`C:\msys64` are absent. WinGet `v1.29.290` is present. The current process is a non-elevated user
token (`DESKTOP-F7SJ82A\duong`). Revision 1's fresh report has 51 PASS layers, one allowed
unverified layer, and exactly one failure:

```text
# runtime/cgo
cgo: C compiler "gcc" not found: exec: "gcc": executable file not found in %PATH%
```

Go's official race-detector requirements state that Windows/amd64 needs cgo, a C compiler, and a
compiler containing mingw-w64 runtime libraries version 8 or later. Go specifies
`gcc --print-file-name libsynchronization.a` as the compatibility test: compliant output is a full
path rather than the unchanged filename.

Authoritative references:

- Go race-detector requirements: https://go.dev/doc/articles/race_detector#Requirements
- MSYS2 installation and UCRT64 GCC package: https://www.msys2.org/#installation
- MSYS2 environments: https://www.msys2.org/docs/environments/
- MSYS2 package management: https://www.msys2.org/docs/package-management/
- Microsoft WinGet exact install semantics and hash enforcement:
  https://learn.microsoft.com/windows/package-manager/winget/install

## 2. Scope

### In scope

- Install the exact x64 MSYS2 installer selected from the official WinGet community source:
  - package ID: `MSYS2.MSYS2`
  - installer version: `20260611`
  - scope: `user`
  - root: `C:\msys64`
  - installer URL reported by WinGet:
    `https://github.com/msys2/msys2-installer/releases/download/2026-06-11/msys2-x86_64-20260611.exe`
  - installer SHA-256 reported by WinGet:
    `3150d7d9aa5dedd900a7f52300d4d918271e3a8fc47de94848818fd5a430e6b0`
- Accept the WinGet community-source agreement and the MSYS2 package agreement only for this exact
  ID/version/source/scope transaction.
- Update only the isolated MSYS2 distribution under `C:\msys64` using its official signed package
  repositories, then install `mingw-w64-ucrt-x86_64-gcc` and its required signed dependencies.
- Attest GCC architecture, package ownership, version, and Go race-runtime compatibility before
  running any Go race test.
- Narrowly update the persisted gauntlet so the `go-race` child process receives absolute
  `CC`/`CXX` paths and a process-local compiler PATH. Add a fail-closed toolchain preflight and a
  known-bad missing-toolchain negative control.
- Run the focused race test and then the entire existing one-command gauntlet.
- Append Revision 2 results and the exact installed package transaction to EVIDENCE.

### Explicit non-goals

- No change to backend runtime behavior, Managed MT5 credential behavior, WinCred storage,
  PostgreSQL schema/data, frontend behavior, public API, or production configuration.
- No persistent User or Machine `PATH`, `CC`, `CXX`, or `CGO_ENABLED` change. Compiler variables are
  supplied only to the race-test child process.
- No machine-scope install, administrator elevation, UAC approval, Windows feature enablement,
  reboot, service restart, firewall change, Defender/Application Control exclusion, or execution
  policy weakening.
- No Chocolatey, Scoop, Visual Studio Build Tools, WSL, Cygwin, raw/unverified compiler archive, or
  alternate package source.
- No `--ignore-security-hash`, `--force`, `--allow-reboot`, unsigned package, signature-policy
  weakening, or direct `pacman -U` package archive.
- No attempt to hide or bypass an Application Control block.
- No fix for a real data race if the now-runnable race detector finds one. That finding stops this
  revision for a new behavioral SPEC; tests and implementation will not be edited to make it pass.
- No production deploy, backend run, broker login, migration mutation, commit, push, reset, branch
  rewrite, or remote mutation.

## 3. Dependencies and licenses

### Direct build-only tools

| Dependency | Purpose | Source/license boundary |
|---|---|---|
| MSYS2 installer `20260611` | Isolated Windows package environment and signed package manager | Exact WinGet ID/version/source/hash; MSYS2 BSD-3-Clause |
| `mingw-w64-ucrt-x86_64-gcc` | GCC/MinGW-w64 compiler required by Go's Windows race detector | Official signed MSYS2 `ucrt64` repository; GCC GPL-3.0-or-later |

The compiler is a verification/build dependency only and is not linked into or redistributed with
the MarketLens production backend artifact by this revision.

At SPEC authoring time, the official MSYS2 installation page shows the GCC transaction as 17
packages (about 69.90 MiB download and 487.51 MiB installed):

- `mingw-w64-ucrt-x86_64-binutils`
- `mingw-w64-ucrt-x86_64-crt`
- `mingw-w64-ucrt-x86_64-gcc-libs`
- `mingw-w64-ucrt-x86_64-gettext-runtime`
- `mingw-w64-ucrt-x86_64-gmp`
- `mingw-w64-ucrt-x86_64-headers`
- `mingw-w64-ucrt-x86_64-isl`
- `mingw-w64-ucrt-x86_64-libiconv`
- `mingw-w64-ucrt-x86_64-libwinpthread`
- `mingw-w64-ucrt-x86_64-mpc`
- `mingw-w64-ucrt-x86_64-mpfr`
- `mingw-w64-ucrt-x86_64-tzdata`
- `mingw-w64-ucrt-x86_64-windows-default-manifest`
- `mingw-w64-ucrt-x86_64-winpthreads`
- `mingw-w64-ucrt-x86_64-zlib`
- `mingw-w64-ucrt-x86_64-zstd`
- `mingw-w64-ucrt-x86_64-gcc`

MSYS2 is a rolling signed repository, so exact package versions may advance after SPEC authoring.
Approval authorizes only the official full MSYS2 base update plus the signed dependency closure of
the named UCRT64 GCC package. Before installation, the complete proposed transaction must be logged.
Any removal, downgrade, repository outside the stock MSYS2 configuration, package outside the base
update or the GCC dependency closure, invalid signature, or unexpected dependency name stops work
before accepting the transaction.

## 4. Failure model

| Failure mode | Required defence/evidence |
|---|---|
| Wrong or ambiguous WinGet package | Use exact ID, version, source, x64 architecture, user scope, and root; preflight `winget show`; abort on any URL/hash drift. |
| Installer tampering | WinGet manifest SHA-256 must equal the pinned value; never use the hash-ignore flag; retain sanitized WinGet output. |
| Existing MSYS2 installation is overwritten | Both WinGet package registration and `C:\msys64` must be absent before installation; otherwise stop for a revised adoption plan. |
| Unexpected elevation or machine mutation | Require non-elevated user-scope install; abort on UAC/elevation requirement; do not write persistent environment variables. |
| Partial/unsigned MSYS2 update | Use stock signed repositories and a full isolated-system update; every command must exit zero; do not disable signature checking or use partial raw package installs. |
| Wrong architecture/toolchain | Require x64 UCRT64 paths, `gcc -dumpmachine` equal to `x86_64-w64-mingw32`, and package ownership from `mingw-w64-ucrt-x86_64-gcc`. |
| mingw-w64 runtime too old | `gcc --print-file-name libsynchronization.a` must return an absolute existing file, as required by Go. |
| PATH poisoning or runtime behavior drift | No persistent PATH change; pass absolute `CC`/`CXX` and prepend only `C:\msys64\ucrt64\bin` inside the `go-race` child environment. Other gauntlet layers retain their original environment. |
| Checker falsely passes without compiler | Add a known-bad missing-root negative control and observe it fail before trusting the real toolchain preflight. The authoritative control remains a real `go test -race`. |
| Application Control blocks GCC or a race binary | Record the exact block and fail; do not add an exclusion or retry outside the existing narrowly approved retry policy. |
| Race detector finds a real data race | Preserve output, fail the gauntlet, and stop for a new SPEC; do not weaken tests or silently fix source under this environment-only revision. |
| Install fails and rollback targets user data | Roll back only if preflight proved MSYS2 absent and this transaction registered the exact user-scope package; use exact WinGet uninstall, never recursive manual deletion. Residual unregistered files stop for user direction. |
| Supply-chain drift between approval and execution | Installer URL/hash must remain exact. Package-version drift is allowed only inside the signed allowlisted transaction described above and must be recorded in EVIDENCE. |

## 5. Executable acceptance scenarios

### R2-S1 — Exact clean preflight

Given the recorded non-elevated Windows user, when setup begins, then `C:\msys64`, the exact WinGet
package registration, and all supported C compilers are still absent; the OS, Go, WinGet, Git HEAD,
worktree state, and Revision 1 blocker are persisted without secret values. Any unexpected existing
installation stops the revision without modifying it.

### R2-S2 — Pinned installer selection

Given the WinGet community source, when `winget show` selects `MSYS2.MSYS2` exactly for x64/user
scope/version `20260611`, then its publisher, official GitHub release URL, and SHA-256 exactly match
Section 2. Any mismatch stops before installation.

### R2-S3 — Isolated user-scope installation

Given the clean preflight and matching manifest, when WinGet installs MSYS2, then only the exact
user-scope package rooted at `C:\msys64` is installed, no UAC/reboot occurs, and no persistent PATH
or compiler environment value changes.

### R2-S4 — Signed UCRT64 GCC transaction

Given fresh MSYS2, when its isolated base distribution is fully updated and
`mingw-w64-ucrt-x86_64-gcc` is installed, then all packages come from stock signed MSYS2 repos, no
package is removed/downgraded, the dependency closure is allowlisted, and the exact installed
package/version list is persisted.

### R2-S5 — Compiler compatibility attestation

Given installed UCRT64 GCC, when attestation runs, then `gcc.exe` and `g++.exe` exist under the exact
UCRT64 bin root, GCC reports `x86_64-w64-mingw32`, pacman attributes GCC to the approved package,
and `gcc --print-file-name libsynchronization.a` returns an absolute existing file. Any unchanged
filename, relative path, missing file, wrong target, or nonzero exit fails closed.

### R2-S6 — Process-local compiler wiring

Given an attested compiler, when the persisted gauntlet reaches `go-race`, then only that child
receives `CGO_ENABLED=1`, absolute `CC`/`CXX`, and a process-local compiler PATH. A fresh registry
read proves User/Machine PATH, `CC`, `CXX`, and `CGO_ENABLED` were not changed.

### R2-S7 — Toolchain checker negative control

Given a deliberately absent synthetic compiler root, when the home-grown toolchain checker runs,
then it exits/fails with the expected missing-toolchain category. The real compiler root must then
pass the same checker and emit sanitized version/target/library-path facts.

### R2-S8 — Focused race detector execution

Given the attested compiler environment, when the exact Revision 1 race command runs against
`./internal/mt5credentials` and `./internal/execution`, then both packages build and execute with
`-race`, at least one test runs in each tested package, exit is zero, and output contains no race
report. A compiler failure, zero-test result, timeout, race report, or Application Control block is
a failure.

### R2-S9 — Final fresh full gauntlet

Given R2-S8 passes and all verifier assertions are frozen, when
`tools\verify-mt5-baremetal-managed-ea.ps1` runs once from a fresh report root, then every required
layer passes. `R15-9-live-demo` may remain only the already-approved `UNVERIFIED_ALLOWED`; no other
failed or unverified layer is accepted.

### R2-S10 — Honest closure or honest stop

Given the final run, when EVIDENCE is updated, then it records the exact installer/package
transaction, compiler attestation, source state, commands, layer counts, and final summary. A real
race or any other failure leaves the verdict BLOCKED. Only a clean full run changes the Revision 1
toolchain blocker to resolved.

### R2-S11 — Exact rollback boundary

Given installation fails before compiler attestation and preflight proved MSYS2 was absent, when
rollback is safe, then only the exact `MSYS2.MSYS2` user-scope installation created by this task may
be uninstalled through WinGet. No recursive delete is allowed; any residual or ambiguous path is
reported and left untouched for explicit user direction.

## 6. Negative invariants

- Application/backend source and production behavior must not change.
- Revision 1 tests, coverage thresholds, mutations, security gates, and assertions must not weaken.
- The race layer must not be skipped, converted to allowed-unverified, or treated as pass on a
  compiler/toolchain failure.
- No persistent environment-variable or PATH mutation.
- No admin elevation, reboot, service control, broker activity, or production action.
- No installer/package ambiguity, alternate source, hash bypass, signature bypass, force flag, or
  package downgrade/removal.
- No secret, credential, token, full environment dump, or agreement prompt content containing user
  data may enter chat, Git, or evidence.
- Existing unrelated worktree changes and Revision 1 artifacts must be preserved.
- If a real data race is found, no source/test fix is authorized by Revision 2.

## 7. Planned source and host mutations

### Host mutations after approval

1. Exact user-scope WinGet install of MSYS2 `20260611` into `C:\msys64`.
2. Full package update confined to the MSYS2 root.
3. Installation of UCRT64 GCC and its signed dependency closure inside that root.
4. No persistent Windows environment mutation.

Planned WinGet command (after all preflight assertions):

```powershell
winget install --id MSYS2.MSYS2 --exact --version 20260611 `
  --source winget --scope user --architecture x64 --location C:\msys64 `
  --silent --no-upgrade --accept-source-agreements --accept-package-agreements `
  --disable-interactivity
```

Planned isolated package operations use `C:\msys64\usr\bin\bash.exe -lc` and stock `pacman`:

```text
pacman --noconfirm -Syu
pacman --noconfirm --needed -Syu mingw-w64-ucrt-x86_64-gcc
```

If the first full update reports that another pass is required, all MSYS2 processes must exit and
the same full update may run one additional time. More retries or keyring repair require a SPEC
revision.

### Repository mutations after approval

- `backend/bridge/mt5_vm/test_managed_gauntlet.py`
  - first add contract assertions for the fixed compiler root, process-local environment, preflight,
    and missing-toolchain negative control; run and observe RED.
- `tools/verify-mt5-baremetal-managed-ea.ps1`
  - add the minimum fail-closed toolchain preflight/negative-control layer and race-only environment
    wiring; do not change any existing test target, threshold, timeout, or acceptance semantics.
- `docs/agent-evidence/mt5-windows-credential-store/EVIDENCE.md`
  - append the Revision 2 final result after the fresh run.
- Generated, uncommitted reports only below
  `.artifacts/mt5-windows-credential-store/toolchain-revision-2/` and the existing
  `.artifacts/mt5-baremetal-managed-ea/` report root.

Any required application-code, SQL, frontend, production-runner, deployment-script, dependency
manifest, or additional repository-file change stops for a new SPEC.

## 8. RED → GREEN → REFACTOR sequence

1. Persist clean host/package/source preflight and re-confirm the exact Revision 1 race failure.
2. Add the gauntlet source-contract assertions and observe them fail before verifier implementation.
3. Implement only the fail-closed toolchain checker and process-local race environment.
4. Run the missing-root negative control, observe expected failure, then run the real preflight.
5. Install and attest the toolchain; no source assertion changes after this point.
6. Run the focused race command. If it exposes a race, stop without modifying application/tests.
7. Run PowerShell parse and focused verifier contracts.
8. Run the complete one-command fresh gauntlet.
9. Append EVIDENCE from that single fresh final run and re-check source/host mutation boundaries.

## 9. Required verification and commands

The final verification remains the existing one-command entry point:

```powershell
powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass `
  -File .\tools\verify-mt5-baremetal-managed-ea.ps1
```

It must include and persist:

1. Host/compiler preflight and its known-bad missing-root negative control.
2. `gcc --version`, `gcc -dumpmachine`, package ownership/version, and the absolute existing
   `libsynchronization.a` result.
3. The actual focused `go test -p=1 -count=1 -race ./internal/mt5credentials ./internal/execution`
   with nonzero executed tests and no race report.
4. Every unchanged Revision 1 layer: full shuffled Go tests, WinCred real smoke, Linux/unsupported
   builds, 100% changed-line gates and negative controls, 13/13 mutation, Rust suites/coverage,
   Python/VM/PostgreSQL regressions, EA attestation, frontend, npm audit, dependency/Vault/docs/
   whitespace/secret/capability audits.
5. Registry/process checks proving no persistent PATH/CC/CXX/CGO environment mutation.
6. `git diff --check`, exact final `git status --short`, source manifest/tree hash, WinGet package
   registration, and exact `pacman -Q` transaction records.

No layer may reuse the Revision 1 result. All reported numbers must come from the one fresh run after
the final verifier edit.

Independent agent verification remains **not authorized/performed**. Revision 2 does not change the
declared downgrade in Revision 1.

## 10. Completion and stop rules

- User input `1` selected the option to draft this SPEC; it is not approval of this document.
- No install, package agreement acceptance, source edit beyond this SPEC, uninstall, or gauntlet
  rerun may occur before the exact approval token is received.
- Installer metadata drift, preexisting MSYS2, unexpected UAC/elevation, package signature failure,
  transaction outside the allowlist, reboot request, Application Control block, real race, or any
  failed gauntlet layer stops work and is reported verbatim.
- A safe task-owned rollback may use exact WinGet uninstall only as described in R2-S11. Ambiguous
  residual files are never recursively deleted.
- Completion requires an attested installed compiler, focused race PASS, full fresh gauntlet PASS
  except the existing R15-9 allowed-unverified item, and updated EVIDENCE.
- Completion does not authorize or imply commit, push, deploy, production activation, or broker use.

## 11. Approval record (append-only)

- Revision 2 drafted on 2026-08-24 after the user selected option `1` from the Revision 1 blocker
  choices.
- That selection is recorded as input to this document, not approval.
- Awaiting the exact token:
  `Duyệt SPEC Revision 2 cài MSYS2 UCRT64 GCC và chạy lại gauntlet`.
- Approved by the user on 2026-08-24 with the exact token:
  `Duyệt SPEC Revision 2 cài MSYS2 UCRT64 GCC và chạy lại gauntlet`.
- Effective status after this append-only record: **APPROVED FOR IMPLEMENTATION**.
- Authorization remains bounded by Sections 2, 6, 7, 9, and 10; no administrator elevation,
  persistent environment change, application-code edit, commit, push, deploy, or production action
  is authorized.
