# SPEC — Accept the Completed GCC Mirror Fallback and Finish the Gauntlet (Tier 3, Revision 7)

Status: **APPROVED — EXECUTION AUTHORIZED WITHIN THIS REVISION ONLY**

Date: 2026-08-24
Repository: C:\Users\duong\Downloads\tradingview
Baseline HEAD: f1a26cf304aaf48b0d64ff0f5a8a68f601abc28c on master
Baseline tree: 17790ddd855dc2de0d0f082eadab62e0b5c1df1d
Parent SPEC: docs/agent-evidence/mt5-windows-credential-store/SPEC_REVISION_6.md
Parent evidence: docs/agent-evidence/mt5-windows-credential-store/EVIDENCE.md, Revision 6 section
Parent stop report: .artifacts/mt5-windows-credential-store/toolchain-revision-6/blocked-state.json
Required approval token: **Duyệt SPEC Revision 7 chấp nhận GCC mirror fallback và chạy race gauntlet**

## 1. Narrow objective

Accept only the already completed Revision 6 UCRT64 GCC transaction whose first mirrors emitted
three DNS retrieval errors before pacman's built-in mirror fallback succeeded, then perform
read-only package/compiler attestation, the focused Go race command, and one fresh canonical
managed-MT5 gauntlet.

Revision 7 authorizes no package transaction. It does not permit retrying GCC, refreshing package
databases, changing mirrors, rolling packages back, uninstalling anything, weakening the existing
error checker, changing application/test/verifier source, or treating future retrieval errors as
acceptable. The acceptance in this revision is retrospective and bound to the exact persisted
Revision 6 transaction artifacts and final package state below.

## 2. Exact inherited transaction accepted by this revision

The only transaction eligible for retrospective acceptance is the Revision 6 invocation:

```text
pacman --noconfirm --needed --disable-download-timeout -S mingw-w64-ucrt-x86_64-gcc
```

It must continue to match all of these facts:

- invocation count exactly 1;
- process exit code 0;
- one ALPM transaction started and completed;
- package count changed from exactly 90 to exactly 107;
- exactly the 17 package records in Section 3 were added;
- no existing package was removed, replaced, upgraded, downgraded, or version-changed;
- package database check exits 0, no lock/process remains, and gcc.exe/g++.exe exist;
- captured output contains exactly the three retrieval error lines and one fatal-mirror warning
  described below, with no fourth error/warning and no signature, trust, checksum, integrity,
  conflict, collision, permission, database, disk, scriptlet, hook, or transaction error; and
- no retry, rollback, uninstall, package refresh, compiler execution, race, or gauntlet occurred
  after the stop.

The authoritative artifact hashes are:

| Artifact | SHA-256 |
|---|---|
| `.artifacts/mt5-windows-credential-store/toolchain-revision-6/gcc-install.json` | `5bf0c30c2af77d8f5b9ec3daddcc9a7a6009238e9e3656d13cb5cfd3624dfd91` |
| `.artifacts/mt5-windows-credential-store/toolchain-revision-6/gcc-install.log` | `78a10d75d7ab93983b5abccb7435221d9be5abd3288df4c1754e86760213381c` |
| `.artifacts/mt5-windows-credential-store/toolchain-revision-6/gcc-pacman-log-delta.log` | `a29fdc48f5114d439607a93f50ac7db5a6a5729615257371ea1a7bbc4d278568` |
| `.artifacts/mt5-windows-credential-store/toolchain-revision-6/blocked-state.json` | `594ec3492d8580cea7509fc23b3e3c3544d8ae40add398f2c98cdf8969144934` |

The accepted retrieval failures are limited to these exact package/redirect outcomes:

1. `mingw-w64-ucrt-x86_64-headers-14.0.0.r302.gd7f3c5201-1-any.pkg.tar.zst` could not resolve
   `mirror.archlinux.tw`;
2. `mingw-w64-ucrt-x86_64-crt-14.0.0.r302.gd7f3c5201-1-any.pkg.tar.zst` could not resolve
   `mirror.archlinux.tw`; and
3. `mingw-w64-ucrt-x86_64-binutils-2.47-3-any.pkg.tar.zst` could not resolve
   `mirrors.ustc.edu.cn`.

The one accepted warning is the corresponding fatal-mirror skip for `mirror.msys2.org` within the
same transaction. This revision accepts those lines only because the same invocation subsequently
completed the signed package integrity checks and exact ALPM transaction. It does not convert
`error:` into a generally allowed output category.

## 3. Exact installed GCC closure

The complete accepted addition is exactly:

```text
mingw-w64-ucrt-x86_64-binutils 2.47-3
mingw-w64-ucrt-x86_64-crt 14.0.0.r302.gd7f3c5201-1
mingw-w64-ucrt-x86_64-gcc 16.2.0-3
mingw-w64-ucrt-x86_64-gcc-libs 16.2.0-3
mingw-w64-ucrt-x86_64-gettext-runtime 1.0-1
mingw-w64-ucrt-x86_64-gmp 6.3.0-2
mingw-w64-ucrt-x86_64-headers 14.0.0.r302.gd7f3c5201-1
mingw-w64-ucrt-x86_64-isl 0.28-1
mingw-w64-ucrt-x86_64-libiconv 1.19-1
mingw-w64-ucrt-x86_64-libwinpthread 14.0.0.r302.gd7f3c5201-1
mingw-w64-ucrt-x86_64-mpc 1.4.1-1
mingw-w64-ucrt-x86_64-mpfr 4.2.2-3
mingw-w64-ucrt-x86_64-tzdata 2026c-1
mingw-w64-ucrt-x86_64-windows-default-manifest 20260815-1
mingw-w64-ucrt-x86_64-winpthreads 14.0.0.r302.gd7f3c5201-1
mingw-w64-ucrt-x86_64-zlib 1.3.2-2
mingw-w64-ucrt-x86_64-zstd 1.5.7-2
```

Any missing record, version drift, eighteenth UCRT64 addition, non-UCRT64 addition, change to one
of the original 90 records, or package count other than 107 stops before compiler execution.

## 4. Tier 3 failure model

This remains Tier 3 because compiler provenance and the race detector protect money-adjacent
execution and credential code.

| Failure mode | Required defence |
|---|---|
| Accepting a different failed transaction | Exact four artifact hashes, exact 3-error/1-warning set, one completed transaction |
| Partial or corrupt compiler install | Exact 107-package snapshot, `pacman -Dk`, `pacman -Qkk` over all 17 packages, ownership checks |
| Package mutation after the stop | Compare current package map with the persisted Revision 6 post-GCC map before every execution stage |
| Wrong compiler or target | Absolute paths, package ownership, versions, `-dumpmachine`, synchronization runtime, compile/link/run smoke |
| Environment leakage | Child-process-only CC/CXX/CGO/PATH and before/after presence/hash comparison |
| Real data race | Focused race command, both packages with nonzero test lists, no `WARNING: DATA RACE` |
| Hidden regression or checker failure | Unchanged canonical verifier, negative controls, fresh full gauntlet and per-layer reports |
| Secret or production side effect | Sanitized hashes/counts only; no broker credentials, production action, deploy, or order |

## 5. Scope and hard exclusions

After exact approval, Revision 7 may perform only:

1. read-only adoption/preflight of the exact Revision 6 artifacts and current host state;
2. read-only pacman package, database, ownership, and file-integrity queries;
3. compiler version/target/runtime attestation and one disposable compile/link/run smoke below the
   Revision 7 artifact root;
4. one focused Go race invocation with process-only compiler environment;
5. one fresh canonical managed-MT5 gauntlet;
6. sanitized generated artifacts plus an append-only Revision 7 EVIDENCE section; and
7. read-only final Git/source/package/config/environment closure.

Revision 7 does not authorize:

- `pacman -S`, `-Syu`, `-Sy`, `-R`, `-U`, database refresh, download, install, retry, rollback,
  uninstall, overwrite, cache deletion, or package repair;
- mirror, DNS, proxy, TLS, certificate, keyring, signature, repository, pacman config, security
  policy, firewall, service, PATH, or persistent environment changes;
- CA mutation, manual file copy, compiler repair, alternate compiler, or alternate package source;
- application, test, verifier, assertion, timeout, threshold, source, dependency, or lockfile changes;
- reuse of an old gauntlet report as fresh Revision 7 evidence;
- production/deploy activation, browser login, broker login, credential entry, account connection,
  order, commit, or push; or
- independent agent verification.

No package-mutating command is allowed even if a later read-only check fails. Failure means stop
and EVIDENCE, not repair.

## 6. Read-only adoption and preflight gates

Persist a new report under
`.artifacts/mt5-windows-credential-store/toolchain-revision-7/` and require:

1. HEAD/tree/branch, `origin/master`, successful CI run `32703593956`, and exact Git status with
   only the existing EVIDENCE and SPEC Revision 4/5/6/7 documentation paths;
2. the four Revision 6 artifact hashes in Section 2 exactly match;
3. the captured GCC log contains exactly 3 native `error:` lines and 1 `warning:` line, all matching
   Section 2, and the ALPM delta contains exactly one start, 17 exact installs, and one completion;
4. complete current `pacman -Q` output contains exactly 107 records and is byte/content-equal to
   Revision 6 `packages-after-gcc.txt`;
5. all original 90 records remain unchanged and the only additions are the 17 exact records in
   Section 3;
6. `pacman -Dk` exits 0, no pacman lock exists, and no MSYS-rooted process is active;
7. read-only `pacman -Qkk` checks over each of the 17 GCC-closure packages report no missing or
   altered packaged file and no package database error;
8. `pacman -Qo /ucrt64/bin/gcc.exe /ucrt64/bin/g++.exe` names only
   `mingw-w64-ucrt-x86_64-gcc` as owner;
9. the CA Qkk result remains exit 1 with exactly the eight Revision 6 allowlisted generated paths,
   no missing file, and 3/3 CA bundle source/destination hashes equal;
10. all 12 persistent User/Machine presence/hash records and all three pacman/mirror config hashes
    equal the Revision 6 stop state, with no `.pacnew` file;
11. the canonical verifier and its control sources are content-equal to HEAD; and
12. the existing source tree contains no application/test/verifier/config change beyond the exact
    documentation paths above.

The generated adoption checker must fail closed and prove at least these known-bad controls before
its PASS is trusted:

- a fourth synthetic retrieval error is rejected;
- one missing expected retrieval error is rejected;
- a missing ALPM completion is rejected;
- an eighteenth package or one changed original package is rejected;
- an unreadable/truncated input artifact is rejected; and
- a missing/altered compiler package file is rejected by a synthetic Qkk parser fixture.

Any preflight drift stops before gcc.exe, g++.exe, or Go race execution.

## 7. Retrospective acceptance boundary

If and only if Section 6 passes, Revision 7 classifies Revision 6 R6-S3 as:

```text
ACCEPTED_WITH_EXACT_MIRROR_FALLBACK_EVIDENCE
```

This classification means only that the persisted transaction is sufficiently bounded to proceed
with compiler verification. It does not rewrite the Revision 6 FAIL/BLOCKED result, delete its error
logs, weaken the Revision 6 checker, or claim the compiler works before Section 8 passes.

## 8. Compiler attestation and disposable real execution

With only child-process environment changes, require:

- `C:\msys64\ucrt64\bin\gcc.exe` and `g++.exe` exist and are owned by the exact GCC package;
- both `--version` commands exit 0 and identify the installed 16.2.0 package family;
- `gcc -dumpmachine` is exactly `x86_64-w64-mingw32`;
- `gcc --print-file-name libsynchronization.a` resolves to an existing file below
  `C:\msys64\ucrt64\`;
- all package/config/persistent-environment/lock/process gates remain unchanged; and
- a generated minimal C program under the Revision 7 artifact root compiles, links, runs, and exits
  0 using the absolute gcc path. Its source, executable hash, command, stdout/stderr, and cleanup
  disposition are recorded; it must not be placed in an application/source directory.

The smoke source is exactly equivalent to:

```c
int main(void) { return 0; }
```

The generated source and executable remain ignored artifacts; no recursive or broad cleanup is
authorized.

## 9. Focused Go race

First list tests read-only and require nonzero test names independently for both packages. Then run
exactly once from `backend` with process-only `CGO_ENABLED=1`, absolute CC/CXX, and UCRT64 PATH:

```text
go test -p=1 -count=1 -race ./internal/mt5credentials ./internal/execution
```

Require:

- process exit 0;
- both packages emit successful `ok` results;
- both pre-list checks prove nonzero tests executed;
- no `WARNING: DATA RACE`, compiler error, Application Control error, hang, or timeout; and
- process environment, package map, config hashes, lock, and MSYS process state are restored.

Any failure stops before the canonical gauntlet. The race command is not retried.

## 10. Fresh canonical gauntlet

After Sections 6 through 9 pass, invoke exactly once from the repository root:

```powershell
powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File .\tools\verify-mt5-baremetal-managed-ea.ps1
```

The canonical verifier owns safe cleanup/recreation only of its exact ignored report root
`.artifacts/mt5-baremetal-managed-ea`. Every required layer must PASS, changed-line coverage gates
must execute and fail closed, mutation controls must pass, all required test filters must execute a
nonzero count, and only `R15-9-live-demo` may remain `UNVERIFIED_ALLOWED`.

No failed layer may be relabeled, skipped, retried by changing assertions, or replaced with an old
result. A failing gauntlet blocks completion, commit, and push.

## 11. Executable acceptance scenarios

### R7-S1 — Exact retrospective adoption

Given the Revision 6 artifacts, when adoption runs, then exact hashes, error/warning set, ALPM
completion, package delta, database, Qkk, ownership, config, environment, Git, and source gates pass.

### R7-S2 — No new package mutation

Given R7-S1, throughout Revision 7 no package-mutating command, retry, rollback, refresh, or mirror
change occurs, and the complete 107-package map remains unchanged.

### R7-S3 — Real compiler attestation

Given R7-S1 and R7-S2, when compiler attestation runs, then absolute ownership, versions, target,
synchronization runtime, and disposable compile/link/run smoke all pass.

### R7-S4 — Focused real race

Given R7-S3, when the focused race runs, then both packages have nonzero tests, exit 0, and emit no
data-race report.

### R7-S5 — Fresh complete gauntlet

Given R7-S4, when the canonical verifier runs once from a fresh report root, every required layer
passes and only the allowed live-demo gate remains unverified.

### R7-S6 — Honest closure or stop

Given success or any stop, EVIDENCE maps every scenario and negative invariant to fresh reports,
exact commands/counts/hashes, source state, limitations, and skipped layers without relabeling.

## 12. Negative invariants

- Zero Revision 7 package mutation, database refresh, network download, retry, rollback, or uninstall.
- The retrospective exception applies only to the exact four hashed Revision 6 artifacts and exact
  3-error/1-warning set; it is not a general error-output allowance.
- No CA, mirror, TLS, DNS, proxy, keyring, signature, security, config, or persistent environment change.
- No source/test/verifier/assertion/timeout/threshold/dependency/lockfile change.
- No secret, credential, full environment value, sensitive body, or broker identifier in artifacts,
  Git, or chat.
- No production, deploy, browser, broker, account, order, commit, or push action.
- No old report is presented as fresh Revision 7 evidence.

## 13. Dependencies, tools, generated files, and Git operations

No new dependency or package is authorized. Revision 7 uses only the already installed PowerShell,
Git, GitHub CLI, MSYS2 pacman/bash, UCRT64 GCC/G++, Go, Python, Rust/Cargo, LLVM coverage tools, and
repository scripts already exercised by the canonical verifier. If any required tool is missing or
blocked, the corresponding layer is BLOCKED; no installation or workaround is authorized.

After approval, generated sanitized files may be created only below:

- `.artifacts/mt5-windows-credential-store/toolchain-revision-7/`; and
- `.artifacts/mt5-baremetal-managed-ea/` through the canonical verifier's exact-root lifecycle.

The persisted Revision 7 helper must provide the rerunnable preflight/compiler/race stages and its
negative controls. The canonical verifier remains the single full-gauntlet entry point. Generated
artifacts stay ignored and uncommitted.

No commit or push is authorized. Git operations are read-only: status, diff, hashes, source state,
and remote/CI verification.

## 14. Evidence-first execution sequence

1. Persist and run checker negative controls.
2. Run exact read-only adoption/preflight; stop on any drift.
3. Record the retrospective acceptance classification without editing Revision 6 history.
4. Run compiler ownership/version/target/runtime and disposable compile/link/run attestation.
5. Run the one focused race command.
6. Run the canonical gauntlet exactly once from its fresh exact report root.
7. Append Revision 7 EVIDENCE and run final Git/package/config/environment/whitespace closure.

There is no RED application test because Revision 7 changes no application behavior or test code.
RED-equivalent evidence is the required negative-control suite for the new retrospective adoption
checker. GREEN is the exact adoption and compiler/race/gauntlet execution under frozen repository
source.

## 15. Stop and completion rules

Any artifact hash drift, altered error set, incomplete transaction, package/file-integrity drift,
unexpected Qkk path, ownership mismatch, compiler smoke failure, environment/config drift, race,
Application Control block, or gauntlet failure stops immediately. No package repair, retry, rollback,
source change, or alternate toolchain is authorized after a stop.

Completion requires R7-S1 through R7-S5 PASS and R7-S6 mapped honestly. Otherwise EVIDENCE remains
BLOCKED and no commit or push occurs. Independent verification is not authorized by this SPEC.

## 16. Approval record (append-only)

- User requested a new SPEC after the Revision 6 fail-closed GCC mirror-fallback stop.
- Effective status at drafting: **AWAITING EXPLICIT APPROVAL**.
- Required exact implementation token:
  `Duyệt SPEC Revision 7 chấp nhận GCC mirror fallback và chạy race gauntlet`
- No compiler execution, generated smoke executable, focused race, canonical gauntlet, commit,
  push, deploy, production action, broker action, or order is authorized until that exact token is
  supplied for this exact file.
- 2026-08-24: User supplied the exact implementation token:
  `Duyệt SPEC Revision 7 chấp nhận GCC mirror fallback và chạy race gauntlet`.
- Effective status after that token: **APPROVED** for the exact scope and stop rules above.
