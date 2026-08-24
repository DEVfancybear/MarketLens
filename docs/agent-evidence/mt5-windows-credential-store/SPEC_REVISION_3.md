# SPEC — Resume the Signed MSYS2 Transaction and Close the Go Race Blocker (Tier 3, Revision 3)

Status: **AWAITING EXPLICIT APPROVAL — NO PACMAN RETRY, GCC INSTALL, OR GAUNTLET RUN AUTHORIZED**

Date: 2026-08-24
Repository: `C:\Users\duong\Downloads\tradingview`
Baseline HEAD: `b0cabaf67b247412dbd5e02a01c61e75ce54349e` on `master`
Parent SPEC: `docs/agent-evidence/mt5-windows-credential-store/SPEC_REVISION_2.md`
Parent evidence: `docs/agent-evidence/mt5-windows-credential-store/EVIDENCE.md`, Section 10
Required approval token: **`Duyệt SPEC Revision 3 retry pacman và chạy lại gauntlet`**

## 1. Objective and inherited state

Resume only the MSYS2 package operation that Revision 2 stopped, install the already-approved
UCRT64 GCC package from signed stock repositories, attest the compiler, run the focused Go race
test, and then run one fresh complete managed-MT5 gauntlet.

Revision 3 adopts rather than recreates the following persisted Revision 2 state:

- WinGet registration is exactly `MSYS2.MSYS2 20260611` at `C:\msys64`.
- The process identity is non-elevated.
- `msys2-runtime 3.6.10-3` and `pacman 6.1.0-25` are installed.
- `mingw-w64-ucrt-x86_64-gcc` is not installed and
  `C:\msys64\ucrt64\bin\gcc.exe` is absent.
- No pacman database lock or running process rooted below `C:\msys64` remains.
- User/Machine `Path`, `CC`, `CXX`, and `CGO_ENABLED` match the Revision 2 pre-install hashes.
- Revision 2's first full update committed only the required core runtime update. Its one allowed
  additional update attempt stopped before commit because DNS resolution and low-speed transfer
  timed out. Pacman reported `Errors occurred, no packages were upgraded.`
- The Revision 2 verifier source contract, missing-root negative control, compiler attestation, and
  process-local race environment wiring are already present and pass their three-test contract
  suite. Revision 3 does not rewrite them.

At Revision 3 authoring time, a read-only network probe resolved both MSYS2 hosts and returned HTTP
200 for the `msys` and `ucrt64` databases through both `repo.msys2.org` and the
`mirror.msys2.org` redirector. Execution must repeat this probe; the authoring result is not reused.

## 2. Authoritative package/update rules

- MSYS2 is rolling release and supports full system upgrades; a package install may proceed only
  after `pacman -Syu` completes successfully.
- The installed stock configuration has `SigLevel = Required` and includes:
  - `/etc/pacman.d/mirrorlist.msys` for `msys`;
  - `/etc/pacman.d/mirrorlist.mingw` for `ucrt64` and the other MinGW repositories.
- The first stock mirror is `mirror.msys2.org`; `repo.msys2.org` is the next primary server and the
  remaining entries are the installer-supplied fallback list. Revision 3 does not reorder, remove,
  add, or directly select a mirror.
- Pacman's documented `--disable-download-timeout` option disables the default low-speed/download
  timeout for proxy or security-gateway problems. It does not disable repository signatures,
  package signatures, checksums, dependency resolution, or conflict checks.
- Pacman's documented `--print-format` mode prints resolved targets instead of installing them.
  Revision 3 uses it to record and review each transaction before mutation.

Authoritative references:

- MSYS2 full-update procedure: https://www.msys2.org/docs/updating/
- MSYS2 package management: https://www.msys2.org/docs/package-management/
- MSYS2 stock mirror behavior: https://www.msys2.org/docs/mirrors/
- Pacman options and print semantics: https://man.archlinux.org/man/pacman.8.en
- UCRT64 GCC package: https://packages.msys2.org/packages/mingw-w64-ucrt-x86_64-gcc?repo=ucrt64
- Go race-detector requirements: https://go.dev/doc/articles/race_detector#Requirements

## 3. Scope

### In scope after exact approval

1. Re-attest the inherited Revision 2 state without exposing environment values.
2. Hash and verify the stock pacman configuration and required signature policy.
3. Run a bounded DNS/HTTPS reachability gate against the two stock MSYS2 endpoints.
4. Refresh sync databases and preview the full-upgrade transaction without installing it.
5. Complete one signed full MSYS2 update under `C:\msys64`.
6. Preview and install exactly `mingw-w64-ucrt-x86_64-gcc` plus the fixed-name signed dependency
   closure in Section 5.
7. Permit exactly one shared transport-only retry across steps 5 and 6 under Section 6. The total
   number of package-mutating pacman invocations is therefore at most three.
8. Run the already-persisted compiler attestation and missing-toolchain negative control.
9. Run the focused race command, followed only on success by the complete fresh gauntlet.
10. Append exact Revision 3 results to EVIDENCE and persist sanitized logs below the approved
    artifact roots.

### Explicit non-goals

- No WinGet reinstall, upgrade, repair, uninstall, package-agreement acceptance, or alternate MSYS2
  root.
- No mirrorlist or `pacman.conf` edit, mirror pinning, custom repository, raw package URL,
  `pacman -U`, package downgrade, package removal, database-only operation, overwrite flag, force
  flag, dependency bypass, signature bypass, checksum bypass, or sandbox bypass.
- No manual keyring repair, `pacman-key` operation, partial `pacman -Sy msys2-keyring`, cache purge,
  or deletion of partially downloaded files. A normal full update may update the already-installed
  `msys2-keyring` package.
- No persistent User/Machine `Path`, `CC`, `CXX`, or `CGO_ENABLED` change.
- No administrator elevation, UAC approval, reboot, Windows feature change, service control,
  firewall/proxy/DNS reconfiguration, Defender/Application Control exclusion, or execution-policy
  weakening.
- No application, test, verifier, SQL, frontend, production-runner, deployment-script, dependency
  manifest, or package-lock change. If a source change is needed, stop for another SPEC.
- No test weakening, skip, allowed-unverified conversion, threshold reduction, timeout increase in
  the gauntlet, or suppression of a real race/toolchain failure.
- No production deploy/run/restart, migration mutation, broker login, trade, commit, push, reset,
  branch rewrite, or remote mutation.

## 4. Dependencies and licenses

Revision 3 adds no dependency beyond the Revision 2-approved build-only toolchain:

| Dependency | Purpose | Source/license boundary |
|---|---|---|
| Existing `MSYS2.MSYS2 20260611` | Signed package-management root already installed by Revision 2 | Exact existing WinGet registration/root; MSYS2 BSD-3-Clause |
| `mingw-w64-ucrt-x86_64-gcc` | C/C++ compiler required by Go's Windows race detector | Stock signed MSYS2 `ucrt64` repository; GCC GPL-3.0-or-later |

The compiler is a verification/build dependency only. Revision 3 does not link or redistribute it
with the MarketLens backend artifact.

## 5. Transaction allowlist and preview

### Full base update

The full-update preview may contain only upgrades of packages already installed inside
`C:\msys64`. For every target, the recorded candidate version must be equal to or newer than the
installed version. Any new package, removal, downgrade, provider-choice prompt, replacement of an
installed package, or unresolved conflict stops before the mutating command.

The authoring-time sync database preview contains 29 upgrades and no removal. Versions may advance
because MSYS2 is rolling release, but the installed-package-only rule above remains fixed.

### GCC transaction

After the full update succeeds, a fresh non-mutating preview must resolve the target package plus
only these 16 dependency names:

1. `mingw-w64-ucrt-x86_64-binutils`
2. `mingw-w64-ucrt-x86_64-crt`
3. `mingw-w64-ucrt-x86_64-gcc-libs`
4. `mingw-w64-ucrt-x86_64-gettext-runtime`
5. `mingw-w64-ucrt-x86_64-gmp`
6. `mingw-w64-ucrt-x86_64-headers`
7. `mingw-w64-ucrt-x86_64-isl`
8. `mingw-w64-ucrt-x86_64-libiconv`
9. `mingw-w64-ucrt-x86_64-libwinpthread`
10. `mingw-w64-ucrt-x86_64-mpc`
11. `mingw-w64-ucrt-x86_64-mpfr`
12. `mingw-w64-ucrt-x86_64-tzdata`
13. `mingw-w64-ucrt-x86_64-windows-default-manifest`
14. `mingw-w64-ucrt-x86_64-winpthreads`
15. `mingw-w64-ucrt-x86_64-zlib`
16. `mingw-w64-ucrt-x86_64-zstd`

The only direct target is `mingw-w64-ucrt-x86_64-gcc`. At authoring time the preview is exactly 17
packages and reports GCC `16.2.0-3`. Signed version drift is allowed; dependency-name drift is not.
Any eighteenth package, missing allowlisted dependency, different repository, removal, downgrade,
installed-package conflict, alternate provider prompt, or unexpected replacement stops before
installation and requires a new SPEC.

The preview format records repository, package, version, architecture, replacements, conflicts,
and location without downloading or executing package payloads:

```powershell
$pacman = 'C:\msys64\usr\bin\pacman.exe'

& $pacman --noconfirm --disable-download-timeout -Syu `
  --print-format '%r|%n|%v|%a|%R|%H|%l'

& $pacman -Sp --needed `
  --print-format '%r|%n|%v|%a|%R|%H|%l' `
  mingw-w64-ucrt-x86_64-gcc
```

The first command may refresh signed sync databases but must not install/upgrade packages because
`--print-format` implies `--print`. All preview output is persisted before mutation.

## 6. Bounded retry policy

### Network gate

Before the first mutating pacman command, resolve both `mirror.msys2.org` and `repo.msys2.org`, then
require HTTP 200 for these four HEAD requests with redirects enabled, connect timeout 15 seconds,
and total request timeout 45 seconds:

- `https://repo.msys2.org/msys/x86_64/msys.db`
- `https://repo.msys2.org/mingw/ucrt64/ucrt64.db`
- `https://mirror.msys2.org/msys/x86_64/msys.db`
- `https://mirror.msys2.org/mingw/ucrt64/ucrt64.db`

If this gate fails, wait 60 seconds and repeat it once. A second failure stops Revision 3 without
running a package-mutating command. Probes are read-only and do not consume the package retry.

### Package invocation budget

The normal path has two mutating commands:

```powershell
& 'C:\msys64\usr\bin\pacman.exe' `
  --noconfirm --disable-download-timeout -Syu

& 'C:\msys64\usr\bin\pacman.exe' `
  --noconfirm --needed --disable-download-timeout `
  -S mingw-w64-ucrt-x86_64-gcc
```

Exactly one additional invocation is shared across both stages. A failed command may be repeated
once only when all conditions below are true:

1. The failure is exclusively a transport failure before transaction commit, such as DNS
   resolution timeout, connection timeout, low-speed timeout, temporary HTTP 408/429/5xx, or
   `failed retrieving file` caused by those conditions.
2. Pacman output says no packages were upgraded/installed, the pacman log delta contains no package
   change, the installed-package snapshot is byte-for-byte equivalent by package/version, no
   database lock remains, and no MSYS2 process remains.
3. Output contains no invalid/corrupt signature, unknown trust, keyring, checksum, conflict,
   dependency, file-collision, disk-space, permission, database-corruption, scriptlet, removal,
   downgrade, reboot, or Application Control error.
4. The network gate passes again after a 60-second delay.

If the shared retry is consumed by the full update, the subsequent GCC install gets no retry. If
the full update succeeds on its first invocation, the shared retry remains available only for the
GCC install. A third failure, any ambiguous failure, any partial commit, or any non-transport error
stops immediately. No retry budget carries into another turn or process without a new SPEC.

Downloaded packages already retained by pacman may be reused and must still pass the normal
signature/integrity checks. Revision 3 does not manually delete, rename, trust, or install cached
payloads.

## 7. Failure model

| Failure mode | Required defence/evidence |
|---|---|
| Revision 2 state drift | Re-attest exact WinGet ID/version/root, non-elevated identity, package set, absent GCC, no lock/process, Git/source state, and persistent env hashes before mutation. Any mismatch stops. |
| Stock repository/config drift | Hash `pacman.conf`, `mirrorlist.msys`, and `mirrorlist.mingw`; require `SigLevel = Required` and the stock includes; never edit them. Unexpected hash/source drift stops. |
| Network outage repeats | Two bounded read-only probe rounds, then stop; no package invocation while the gate is red. |
| Infinite retry loop | One shared package retry, maximum three mutating pacman invocations total, with every attempt numbered and logged. |
| Retry after partial commit | Compare pacman log and complete package/version snapshot. Any package change or ambiguous state forbids retry. |
| Signature/keyring/integrity failure | Stop verbatim. Do not refresh keys manually, weaken verification, delete payloads, or switch source. |
| Package-plan expansion | Preview and enforce installed-only base upgrades plus the exact 17-name GCC closure. Any package-name drift stops before mutation. |
| Partial system upgrade | Require full update exit zero before GCC preview/install; no standalone keyring or selected base-package upgrade. |
| Mirror manipulation | Use absolute stock pacman executable and unchanged packaged mirrorlists; compare configuration hashes after installation. |
| Wrong architecture/toolchain | Require UCRT64 absolute paths, `gcc -dumpmachine` exactly `x86_64-w64-mingw32`, and `pacman -Qo` ownership by the approved GCC package. |
| Race runtime unsupported | Require `gcc --print-file-name libsynchronization.a` to return an absolute existing file below the approved UCRT64 tree. |
| Persistent environment mutation | Compare User/Machine `Path`, `CC`, `CXX`, and `CGO_ENABLED` to Revision 2 preflight presence/hash values. |
| Application Control block | Preserve exact output and stop; no exclusions, bypass, or altered execution policy. |
| Real data race | Preserve the race report and stop for a behavioral SPEC; do not edit source/tests under Revision 3. |
| Other gauntlet failure | Persist the complete summary and remain BLOCKED; do not weaken or skip the layer. |
| Destructive cleanup/rollback | Do not uninstall MSYS2 or manually delete its root under Revision 3. Preserve the adopted installation and request explicit direction. |

## 8. Executable acceptance scenarios

### R3-S1 — Exact adoption preflight

Given the Revision 2 stop state, when Revision 3 starts, then the exact WinGet package/root,
non-elevated identity, installed runtime/pacman versions, absent GCC, no lock/process, unchanged
persistent environment hashes, HEAD, and dirty worktree are recorded. Any mismatch stops without a
package mutation.

### R3-S2 — Stock signed repository boundary

Given `C:\msys64`, when pacman configuration is inspected, then `SigLevel = Required`, the `msys`
and `ucrt64` repositories include the two stock mirrorlist files, and their hashes are persisted.
No configuration file is edited.

### R3-S3 — Healthy transport gate

Given the four approved database URLs, when the bounded DNS/HEAD probe runs, then both hostnames
resolve and all four requests return HTTP 200. At most one read-only probe retry follows a failure;
a second failure stops before pacman mutation.

### R3-S4 — Fail-closed transaction previews

Given freshly synchronized signed databases, when base and GCC transactions are printed, then the
base targets are upgrades of installed packages only and the GCC targets are exactly the 17 names
in Section 5. Any drift stops before payload installation.

### R3-S5 — Complete full update

Given an accepted base preview and green network gate, when the full update runs, then pacman exits
zero, commits no removal/downgrade/unexpected package, leaves no lock/process, and a second
non-mutating full-update preview prints no remaining upgrade target.

### R3-S6 — One shared transport retry

Given either mutating stage fails before commit for an allowlisted transport-only reason, when
state equality and the network gate are re-proven after 60 seconds, then only that exact command may
run once more. A consumed retry, state change, ambiguous output, or non-transport error stops.

### R3-S7 — Exact GCC installation

Given R3-S5 passed and the fixed-name GCC preview is accepted, when the package command runs, then
pacman exits zero and installs exactly the target plus its approved dependency closure from the
`ucrt64` repository with required signatures.

### R3-S8 — Compiler compatibility attestation

Given the installed package, when the existing verifier checks it, then `gcc.exe` and `g++.exe`
exist under `C:\msys64\ucrt64\bin`, the target is exactly `x86_64-w64-mingw32`, `pacman -Qo`
attributes `gcc.exe` to `mingw-w64-ucrt-x86_64-gcc`, and `libsynchronization.a` resolves to an
absolute existing file below the UCRT64 tree.

### R3-S9 — Process-local compiler boundary

Given R3-S8 passed, when Go race executes, then only the race child receives `CGO_ENABLED=1`,
absolute `CC`/`CXX`, and a compiler-prefixed process PATH. User/Machine environment presence/hash
values and the stock pacman config hashes remain unchanged.

### R3-S10 — Focused real race execution

Given the attested child environment, when
`go test -p=1 -count=1 -race ./internal/mt5credentials ./internal/execution` runs, then both
packages build and execute tests, exit zero, and emit no race report. Compiler errors, zero tests,
timeout, Application Control, or a race report fail this scenario.

### R3-S11 — Fresh complete gauntlet

Given R3-S10 passed and no verifier assertion changed, when the one-command managed-MT5 gauntlet
runs from a fresh report root, then every required layer passes. Only the pre-approved
`R15-9-live-demo` may remain `UNVERIFIED_ALLOWED`; no other failure/unverified layer is accepted.

### R3-S12 — Honest closure or stop

Given execution finishes or stops, when EVIDENCE is updated, then it maps every R3 scenario to the
exact logs/results, records attempt count and package/config/env state, and never relabels an older
gauntlet as fresh. Only R3-S1 through R3-S11 passing changes the blocker to resolved.

## 9. Negative invariants

- Existing Revision 1/2 source assertions, tests, coverage thresholds, mutation score, timeouts,
  security checks, and production boundaries remain unchanged.
- The race layer is not skipped, softened, or converted to allowed-unverified.
- No package transaction runs before preview and network gates pass.
- No fourth package-mutating pacman invocation occurs.
- No retry occurs after any package change or non-transport/ambiguous error.
- No package outside an installed-only full upgrade or the exact GCC closure is installed.
- No signature, checksum, dependency, or conflict check is weakened.
- No persistent environment, pacman config, mirrorlist, Windows security, service, or network config
  is mutated.
- No secret, token, credential, full environment value, or sensitive URL content enters logs,
  Git, evidence, or chat.
- Existing unrelated worktree changes and Revision 1/2 artifacts remain untouched.
- A real race or other gauntlet failure is reported, not fixed under this environment-only SPEC.

## 10. Planned mutations and artifacts

### Host mutations after approval

Only these mutations are authorized:

1. Signed sync-database refresh performed by the preview/full-update operation.
2. Full upgrades of packages already installed in `C:\msys64`.
3. Installation of the exact 17-name UCRT64 GCC transaction.
4. At most one shared transport-only retry satisfying Section 6.

No Windows machine/user configuration mutation is authorized.

### Repository mutations after approval

- No application/test/verifier source change is planned or authorized.
- Append Revision 3 results to
  `docs/agent-evidence/mt5-windows-credential-store/EVIDENCE.md`.
- Generate sanitized, uncommitted reports only below:
  - `.artifacts/mt5-windows-credential-store/toolchain-revision-3/`;
  - the existing fresh gauntlet root `.artifacts/mt5-baremetal-managed-ea/`.

The Revision 3 SPEC itself is the only repository mutation before approval. No commit, push, or
deployment is planned.

## 11. Evidence-first execution sequence

Revision 3 changes environment state, not application behavior. No new source test is added, so a
new source RED is not applicable. The existing Revision 2 checker negative control remains the RED
analogue and must be rerun before trusting real compiler attestation.

After exact approval:

1. Persist current host/package/config/env/Git preflight to the Revision 3 artifact root.
2. Run the existing three-test verifier contract suite and PowerShell parse check.
3. Run the synthetic missing-root checker and require its expected fail-closed category.
4. Run the two-round-at-most read-only network gate.
5. Refresh/preview the base transaction and enforce Section 5.
6. Run the full update under the shared retry budget; require zero remaining upgrades afterward.
7. Preview/install the exact GCC closure under the remaining retry budget.
8. Run real compiler/package/runtime attestation and persistent env/config comparison.
9. Run the focused race command. A real race stops all source work.
10. Run the entire one-command gauntlet once from its fresh report root.
11. Append EVIDENCE from that final source state/run and run `git diff --check` plus exact status.

## 12. Required verification

The final entry point remains:

```powershell
powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass `
  -File .\tools\verify-mt5-baremetal-managed-ea.ps1
```

Before it runs, Revision 3 must persist:

1. WinGet registration/root, non-elevated identity, exact installed-package snapshot, pacman lock
   and process checks, Git HEAD/status, and sanitized persistent-env presence/hashes.
2. Pacman version, required signature policy, stock include paths, and before/after hashes for
   `pacman.conf`, `mirrorlist.msys`, and `mirrorlist.mingw`.
3. Every network probe result, package attempt number/command/exit, preview, pacman-log delta, and
   post-attempt package snapshot.
4. Exact final `pacman -Q` records for the base update targets and 17 GCC transaction packages.
5. Existing compiler attestation: version, target, ownership, and `libsynchronization.a` path.
6. Focused race output with nonzero executed tests and no race report.
7. One fresh full gauntlet summary/source-state/per-layer log set, with every required layer PASS
   and only `R15-9-live-demo` allowed-unverified.
8. Final environment/config comparison, `git diff --check`, exact `git status --short`, and source
   tree hash.

No Revision 1 or Revision 2 test result may be substituted for a Revision 3 final run. Independent
agent verification remains not authorized/performed; Revision 3 does not change that declared
confidence boundary.

## 13. Completion and stop rules

- The user's request to draft Revision 3 is authorization to write this SPEC only. It is not
  approval to execute it.
- No network/package mutation, GCC install, source change, focused race, full gauntlet, uninstall,
  commit, push, deploy, or production action may occur before the exact approval token below.
- Any preflight drift, red network gate, transaction-plan drift, exhausted retry, package state
  change after a failed attempt, signature/keyring/integrity/conflict/disk/permission error,
  Application Control block, real race, or failed gauntlet layer stops and is reported verbatim.
- Revision 3 authorizes no automatic rollback or uninstall. The adopted MSYS2 root remains in place
  after a stop; no recursive/manual deletion is allowed.
- Completion requires installed/attested GCC, focused race PASS, full fresh gauntlet PASS except the
  existing R15-9 allowed-unverified item, unchanged persistent environment/config boundaries, and
  updated EVIDENCE.
- Completion does not authorize or imply commit, push, deploy, backend activation, or broker use.

## 14. Approval record (append-only)

- Revision 3 was drafted on 2026-08-24 after Revision 2 exhausted its only allowed extra full-update
  attempt on a transport failure before commit.
- User input `Soạn SPEC Revision 3 retry pacman` authorized drafting this file only.
- Awaiting the exact token:
  `Duyệt SPEC Revision 3 retry pacman và chạy lại gauntlet`.
- Effective status: **AWAITING EXPLICIT APPROVAL**.
- Approved by the user on 2026-08-24 with the exact token:
  `Duyệt SPEC Revision 3 retry pacman và chạy lại gauntlet`.
- Approved pre-append SPEC SHA-256:
  `ca34c3ff1c4ee8b87d9b288ce2b43b9453c00ecdfe7bafb21183e5506bd7e371`.
- Effective status after this append-only record: **APPROVED FOR IMPLEMENTATION**.
- Authorization remains bounded by Sections 3, 5, 6, 9, 10, 12, and 13; no fourth mutating
  pacman invocation, source edit beyond EVIDENCE, persistent environment/config change, commit,
  push, deploy, production action, or broker action is authorized.
