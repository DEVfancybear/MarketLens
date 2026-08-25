# SPEC — Repair MSYS2 CA Before Signed Refresh and Close the Go Race Blocker (Tier 3, Revision 5)

Status: **AWAITING EXPLICIT APPROVAL — NO PACKAGE REPAIR, GCC INSTALL, RACE, OR GAUNTLET RUN AUTHORIZED**

Date: 2026-08-24
Repository: C:\Users\duong\Downloads\tradingview
Baseline HEAD: f1a26cf304aaf48b0d64ff0f5a8a68f601abc28c on master
Baseline tree: 17790ddd855dc2de0d0f082eadab62e0b5c1df1d
Parent SPEC: docs/agent-evidence/mt5-windows-credential-store/SPEC_REVISION_4.md
Parent evidence: docs/agent-evidence/mt5-windows-credential-store/EVIDENCE.md, Revision 4 section
Required approval token: **Duyệt SPEC Revision 5 sửa CA trước signed refresh và chạy lại gauntlet**

## 1. Objective and inherited stop state

Repair the exact default MSYS2 CA state left by Revision 3, then prove the repaired trust path,
refresh signed databases through the approved UCRT64 login boundary, install the already approved
UCRT64 GCC closure, run the focused Go race detector, and run one fresh complete managed-MT5
gauntlet.

Revision 4 passed preflight, wrapper controls, and the Windows TLS gate, but its mandatory
print-only signed database refresh exited 1 because the broken default MSYS CA prevented repository
database retrieval. It performed zero package mutations. The authoritative stop report is:

artifacts/mt5-windows-credential-store/toolchain-revision-4/blocked-state.json

Revision 5 changes only the order of the already authorized CA repair and signed refresh. The CA
repair remains a single same-version reinstall from the existing signed local cache; no manual copy,
TLS bypass, keyring refresh, mirror change, or package expansion is introduced.

## 2. Tier, failure model, and command boundary

This is Tier 3 because it touches package integrity, certificate trust, compiler supply chain,
process environment, concurrency, and money-adjacent execution tests.

The failure model requires evidence for:

| Failure mode | Required defence |
|---|---|
| Wrong source or host | Exact HEAD, remote, CI, WinGet, package, config, and environment preflight |
| Repair from an unexpected package | Exact cached CA preview, repository, version, architecture, path, signature policy |
| Exit zero with broken scriptlet | Full output/error scan, pacman-log delta, hook attestation, destination hashes, real HTTPS |
| Repair expands package state | Complete before/after package snapshot; exactly one same-version CA change |
| Signed refresh remains broken | Default-CA MSYS curl and signed zero-target preview after repair |
| Wrong command PATH | UCRT64 login-shell positive control and exit-23 propagation control |
| Unexpected GCC closure | Exact 17-name ucrt64 allowlist and no removals/conflicts |
| Retry after commit | Package snapshot and pacman-log equality; retry only for pre-commit GCC transport failure |
| Persistent environment mutation | 12 User/Machine presence/hash comparisons and process restoration |
| Real data race | Focused race command with nonzero tests and no DATA RACE output |
| Hidden gauntlet failure | Canonical fresh gauntlet, unchanged verifier, persisted per-layer reports |

Every MSYS command uses the absolute login-shell boundary:

PowerShell sets process-only MSYSTEM=UCRT64 and CHERE_INVOKING=1, invokes
C:\msys64\usr\bin\bash.exe --login -c with a literal command, and restores the prior process
state in finally. No User or Machine environment variable may be written.

## 3. Scope and hard exclusions

After exact approval, Revision 5 may perform:

1. Read-only preflight, package/config/environment snapshots, controls, and network probes.
2. One exact cached same-version ca-certificates reinstall.
3. Post-repair CA, hook, database, environment, and default-CA HTTPS attestation.
4. One signed full-update print-only refresh after CA recovery, requiring zero targets.
5. One exact 17-package mingw-w64-ucrt-x86_64-gcc installation.
6. At most one GCC-only transport retry under Section 9.
7. Compiler attestation, focused race execution, and one fresh canonical gauntlet.
8. Sanitized generated artifacts plus an append-only Revision 5 result in EVIDENCE.

Revision 5 does not authorize:

- any package before its exact read-only preview and all prerequisite gates;
- a full-system mutation, package outside the CA reinstall and exact GCC closure, or a CA retry;
- manual extraction/copying/overwriting of certificates or package files;
- pacman --overwrite, --dbonly, --nodeps, --noscriptlet, --assume-installed, or standalone pacman -U;
- keyring refresh, signature weakening, TLS bypass, custom CA variables, mirror/config edits, or
  alternate repositories;
- persistent PATH, CC, CXX, CGO_ENABLED, MSYSTEM, or CHERE_INVOKING changes;
- Windows security, firewall, DNS, proxy, service, reboot, production, deploy, broker, or order work;
- application, test, verifier, assertion, threshold, timeout, or source changes;
- rollback, uninstall, recursive deletion, cache/database deletion, commit, or push.

## 4. Preflight and stock boundary

Before mutation, persist under
artifacts/mt5-windows-credential-store/toolchain-revision-5/:

1. exact WinGet ID/version/root, OS, non-elevated identity;
2. HEAD/tree/branch, remote SHA, CI run 32703593956, and exact Git status;
3. complete sorted pacman -Q snapshot and count;
4. pacman/runtime versions, absent GCC, no lock, and no MSYS-rooted process;
5. SHA-256 and parsed policy for pacman.conf and both stock mirrorlists;
6. User/Machine presence plus SHA-256-only records for Path, CC, CXX, CGO_ENABLED, MSYSTEM, and
   CHERE_INVOKING (12 records, no full values);
7. process-scope presence/hashes before and after every wrapper;
8. pacman -Dk, ownership/version of bash, coreutils, info/install-info, pacman, and CA;
9. installed CA script and texinfo hook hashes;
10. CA source/destination sizes/hashes and the Revision 4 RED curl result.

The three adopted config hashes must remain:

| File | SHA-256 |
|---|---|
| C:\msys64\etc\pacman.conf | 0f25288c70ade80c7fac57d3149209b64a7ba23f00232b7e42103f6330b0c1c0 |
| C:\msys64\etc\pacman.d\mirrorlist.msys | 7353fdc95956d12a76b6d65231137f0166baf6e88661f142d1876dfe3b7f884d |
| C:\msys64\etc\pacman.d\mirrorlist.mingw | 0ba99a1ca7a8c1499daff0f70281a90abf034dbfdbffac7a68f2c4538d74a8e3 |

Any source/config/package/identity drift stops before mutation.

## 5. Gates before the CA transaction

Run and persist:

1. the three verifier contract tests, PowerShell parse, missing-toolchain negative control,
   UCRT64 login-shell positive control, and synthetic exit-23 control;
2. Windows DNS resolution for mirror.msys2.org and repo.msys2.org;
3. Windows TLS HEAD HTTP 200 for the four repository database URLs, with one read-only retry only
   after a 60-second delay if the first network attempt fails;
4. exact cached CA preview:

PowerShell invokes the login shell with:

pacman -Sp --print-format '%r|%n|%v|%a|%R|%H|%l' ca-certificates

The preview must contain exactly:

msys|ca-certificates|20260816-1|any|||file:///var/cache/pacman/pkg/ca-certificates-20260816-1-any.pkg.tar.zst

The cached package and its pacman-managed signature material must exist. Any version, repository,
architecture, dependency, replacement, conflict, removal, or location drift stops.

The CA transaction is intentionally allowed before the online signed database refresh because the
current default CA prevents that refresh. This is the sole ordering change from Revision 4.

## 6. Exact CA repair transaction

Record the complete package snapshot and pacman-log length immediately before mutation. Run exactly
once:

pacman --noconfirm --disable-download-timeout -S ca-certificates

This deliberately omits --needed so the installed 20260816-1 package reruns its normal scriptlet
and hooks using the corrected login-shell PATH. Exit zero is necessary but insufficient.

The output and pacman-log delta must show one same-version CA reinstall and no:

- command-not-found, scriptlet, hook, signature, keyring, checksum, integrity, dependency,
  conflict, collision, disk, permission, database, removal, downgrade, reboot, or policy error;
- package/version change outside the one CA reinstall; or
- retry.

Any CA transaction ambiguity or failure stops immediately. No CA repair retry is permitted.

## 7. Required CA recovery attestation

Before signed refresh, require:

1. package count and every package version equal the pre-CA snapshot except the same CA record;
2. pacman -Dk exit zero, no lock, and no MSYS-rooted process;
3. all three /usr/ssl destinations are nonempty and byte-equal to their extracted sources;
4. login-shell command resolution for mkdir, cp, and install-info below /usr/bin;
5. both texinfo hooks appear without errors in output/log;
6. pacman -Qkk ca-certificates has no missing/unexpected path outside the five known generated files;
7. default-CA MSYS curl returns HTTP 200 for all four repository URLs without any override;
8. all 12 persistent environment hashes and three config hashes remain unchanged.

Do not set CURL_CA_BUNDLE, SSL_CERT_FILE, GIT_SSL_NO_VERIFY, or another custom CA path.

## 8. Signed refresh after CA recovery

After Section 7 passes, rerun the signed login-shell command:

pacman --noconfirm --disable-download-timeout -Syu --print-format '%r|%n|%v|%a|%R|%H|%l'

Require exit zero, successful signed database refresh, zero printed base targets, no error category,
no package payload mutation, no lock/process, and package snapshot equality. This is a required
post-repair gate, not a package transaction.

Any nonzero exit, target, signature/trust error, or package drift stops before GCC.

## 9. Exact UCRT64 GCC closure and bounded retry

Preview:

pacman -Sp --needed --print-format '%r|%n|%v|%a|%R|%H|%l' mingw-w64-ucrt-x86_64-gcc

The target set must be exactly these 17 ucrt64 packages:

mingw-w64-ucrt-x86_64-binutils, crt, gcc-libs, gettext-runtime, gmp, headers, isl, libiconv,
libwinpthread, mpc, mpfr, tzdata, windows-default-manifest, winpthreads, zlib, zstd, gcc.

Require no removal, downgrade, alternate provider, installed conflict, or repository drift. Then
run exactly once:

pacman --noconfirm --needed --disable-download-timeout -S mingw-w64-ucrt-x86_64-gcc

At most one additional invocation of this exact GCC command is permitted, after 60 seconds, only
when the first GCC attempt failed exclusively before commit due DNS/connect/low-speed timeout,
temporary HTTP 408/429/5xx, or failed retrieval caused by those conditions; output explicitly says
no package was installed; complete package snapshot and pacman-log show no transaction start or
change; no forbidden error appears; no lock/process remains; and both Windows TLS and repaired
default-CA MSYS curl gates pass again. Any ambiguity, partial commit, or second GCC failure stops.

## 10. Compiler, environment, race, and gauntlet

The existing verifier must attest:

- C:\msys64\ucrt64\bin\gcc.exe and g++.exe exist;
- gcc -dumpmachine is exactly x86_64-w64-mingw32;
- pacman -Qo /ucrt64/bin/gcc.exe names mingw-w64-ucrt-x86_64-gcc;
- gcc --print-file-name libsynchronization.a resolves to an existing path below UCRT64; and
- all persistent environment/config hashes remain unchanged.

With process-only CGO_ENABLED=1, CC=C:\msys64\ucrt64\bin\gcc.exe,
CXX=C:\msys64\ucrt64\bin\g++.exe, and UCRT64 bin prefixed to PATH, run from backend:

go test -p=1 -count=1 -race ./internal/mt5credentials ./internal/execution

Require both packages to execute nonzero tests, exit zero, no WARNING: DATA RACE, and complete
process-state restoration.

Then run exactly once from a fresh report root:

powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File .\tools\verify-mt5-baremetal-managed-ea.ps1

Every required layer must pass; only R15-9-live-demo may remain UNVERIFIED_ALLOWED.

## 11. Executable acceptance scenarios

### R5-S1 — Clean inherited adoption

Given Revision 4 stop evidence and committed HEAD f1a26cf, when preflight runs, then exact package,
config, environment, CI, lock/process, and CA RED state are persisted; unexplained drift stops.

### R5-S2 — Fail-closed wrapper and controls

Given the absolute Bash boundary, when controls run, then UCRT64/PATH/command ownership,
exit-23 propagation, checker contracts, and process restoration all pass.

### R5-S3 — Exact cached CA preview

Given the broken default CA and the signed local cache, when preview runs, then exactly one
same-version msys CA package at the expected file URL is selected with no dependency or conflict.

### R5-S4 — Single CA repair

Given R5-S3, when the one CA transaction runs, then only the same-version CA reinstall occurs,
normal hooks execute without errors, and no retry occurs.

### R5-S5 — Functional CA recovery

Given R5-S4, when attestation runs, then destination hashes, hooks, Qkk, database, environment,
config, and four default-CA HTTPS requests all pass.

### R5-S6 — Post-repair signed zero-update plan

Given R5-S5, when signed databases refresh, then exit is zero, signatures validate, no targets
are printed, and no package payload changes.

### R5-S7 — Exact GCC closure and retry policy

Given R5-S6, when GCC preview/install runs, then exactly the 17-name closure is installed; only
one eligible pre-commit transport retry may occur.

### R5-S8 — Compiler compatibility

Given R5-S7, when attestation runs, then absolute ownership, target triple, synchronization
runtime, and persistent boundary all match.

### R5-S9 — Focused real race

Given R5-S8, when the focused race runs, then both packages execute tests, exit zero, and emit no
data-race report.

### R5-S10 — Fresh complete gauntlet

Given R5-S9, when the canonical verifier runs from a fresh root, every required layer passes and
only the explicitly allowed live-demo gate is unverified.

### R5-S11 — Honest closure or stop

Given success or any stop, when EVIDENCE is appended, every scenario maps to fresh logs, exact
attempt counts, package/config/environment state, source state, and limitations.

## 12. Negative invariants

- No package mutation before its exact preview and all prerequisite gates.
- Exactly one CA mutation, no CA retry, no fourth package-mutating invocation.
- No retry after transaction state change or any non-transport/ambiguous failure.
- No package outside the CA reinstall and exact GCC closure changes.
- No trust, signature, checksum, dependency, TLS, security, or environment boundary is weakened.
- No secret, credential, full environment value, or sensitive response body enters artifacts, Git, or chat.
- No application/test/verifier/source changes; generated evidence stays under approved artifact roots.
- No old gauntlet is relabeled as Revision 5 evidence.
- No commit, push, deploy, production activation, broker login, or order is implied.

## 13. Dependencies, mutations, and artifacts

The only dependency addition is the already approved UCRT64 GCC closure, required by Go's Windows
race detector. No application/runtime dependency is added.

Host mutations are limited to the single cached CA reinstall, exact GCC closure, and one eligible
GCC retry. Repository mutations are limited to this SPEC before approval and an append-only
Revision 5 EVIDENCE result after execution. Generated artifacts are limited to:

- artifacts/mt5-windows-credential-store/toolchain-revision-5/
- artifacts/mt5-baremetal-managed-ea/

## 14. Evidence-first execution sequence

1. Persist preflight and controls.
2. Run Windows TLS gate.
3. Preview the exact cached CA package.
4. Run the single CA reinstall and inspect output/log delta.
5. Attest CA recovery and default HTTPS.
6. Run signed refresh and require zero targets.
7. Preview/install exact GCC, with only the bounded retry.
8. Attest compiler and environment.
9. Run focused race.
10. Run the fresh canonical gauntlet.
11. Append EVIDENCE and run final source/Git/whitespace closure.

## 15. Stop and completion rules

Any baseline/config drift, CA preview drift, CA scriptlet/hook error, default-CA failure after
repair, signed refresh failure, target, signature/integrity error, GCC closure drift, ineligible
retry, Application Control block, race, or gauntlet failure stops immediately. No automatic rollback
is authorized.

Completion requires R5-S1 through R5-S10 PASS. Otherwise EVIDENCE remains BLOCKED and no commit or
push occurs. Independent verification is not authorized by this SPEC.

## 16. Approval record (append-only)

- User asked the agent to draft Revision 5 after the Revision 4 fail-closed stop.
- Effective status at drafting: **AWAITING EXPLICIT APPROVAL**.
- Required implementation approval is the exact token:
  Duyệt SPEC Revision 5 sửa CA trước signed refresh và chạy lại gauntlet
- No package repair, GCC install, race, gauntlet, commit, push, deploy, or production action is
  authorized until that exact token is supplied for this exact file.
- User supplied the exact implementation approval token on 2026-08-24:
  Duyệt SPEC Revision 5 sửa CA trước signed refresh và chạy lại gauntlet
- Effective status after this append-only record: **APPROVED FOR IMPLEMENTATION**.
