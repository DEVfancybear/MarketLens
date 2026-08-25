# SPEC — Repair MSYS2 CA State and Close the Go Race Blocker (Tier 3, Revision 4)

Status: **AWAITING EXPLICIT APPROVAL — NO PACKAGE REPAIR, GCC INSTALL, OR GAUNTLET RUN AUTHORIZED**

Date: 2026-08-24
Repository: `C:\Users\duong\Downloads\tradingview`
Baseline HEAD: `f1a26cf304aaf48b0d64ff0f5a8a68f601abc28c` on `master`
Baseline tree: `17790ddd855dc2de0d0f082eadab62e0b5c1df1d`
Parent SPEC: `docs/agent-evidence/mt5-windows-credential-store/SPEC_REVISION_3.md`
Parent evidence: `docs/agent-evidence/mt5-windows-credential-store/EVIDENCE.md`, Sections 11–12
Required approval token: **`Duyệt SPEC Revision 4 sửa MSYS2 CA và chạy lại gauntlet`**

## 1. Objective and inherited stop state

Repair the exact partial MSYS2 certificate/hook state left by Revision 3, prove the repair through
content and real HTTPS checks, install the already approved UCRT64 GCC closure, run the focused Go
race detector, and then run the complete managed-MT5 gauntlet once from a fresh report root.

Revision 4 starts from a committed and pushed source baseline. Commit
`f1a26cf304aaf48b0d64ff0f5a8a68f601abc28c` is present on `origin/master`; GitHub Actions run
`32703593956` completed successfully for all four jobs: backend Go/vet, replay-client/frontend,
Rust workspace, and the Windows backend artifact job. The source commit is shipped, but the local
Tier 3 race/gauntlet blocker remains unresolved and must not be relabeled by the CI result.

The adopted host state is:

- exact WinGet package `MSYS2.MSYS2 20260611` under `C:\msys64`;
- pacman `6.1.0-25`, `msys2-runtime 3.6.10-3`, and 90 installed packages;
- the 29 Revision 3 base targets are at their previewed upgraded versions;
- no remaining full-system upgrade target in the current signed databases;
- no installed `mingw-w64-ucrt-x86_64-gcc` record and no
  `C:\msys64\ucrt64\bin\gcc.exe`;
- no pacman database lock and no running process rooted below `C:\msys64`;
- unchanged stock pacman configuration and mirrorlists; and
- the Revision 3 transaction returned process exit `0` but emitted failed pre/post hooks and
  `mkdir`/`cp` command-not-found errors after committing package changes.

The failure produced an observable certificate defect. The current nonempty extracted bundles do
not match the three destinations that the installed `ca-certificates` `post_upgrade` script copies:

| Source | Required destination | Current draft-time state |
|---|---|---|
| `/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem` | `/usr/ssl/certs/ca-bundle.crt` | destination is empty; SHA-256 mismatch |
| `/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem` | `/usr/ssl/cert.pem` | destination is empty; SHA-256 mismatch |
| `/etc/pki/ca-trust/extracted/openssl/ca-bundle.trust.crt` | `/usr/ssl/certs/ca-bundle.trust.crt` | destination is empty; SHA-256 mismatch |

A draft-time read-only MSYS curl HEAD request using the default CA path failed with exit `77` and
`error adding trust anchors from file: /usr/ssl/certs/ca-bundle.crt`. This is the Revision 4 RED
condition. `pacman -Dk` nevertheless reports no package database errors, so the scope is an exact
scriptlet/hook repair rather than a database rebuild or MSYS2 reinstall.

## 2. Authoritative guidance and command-boundary decision

The command design follows the current official MSYS2 documentation inspected on 2026-08-24:

- `https://www.msys2.org/docs/updating/` requires full-system upgrades rather than partial version
  upgrades. Revision 4 therefore refreshes/prints the full update plan and requires zero base
  targets before any repair or GCC install.
- `https://www.msys2.org/docs/environments/` states that `MSYSTEM=UCRT64` plus a login shell selects
  UCRT64 and places `/ucrt64/bin` and `/usr/bin` at the front of child PATH.
- `https://www.msys2.org/docs/package-management/` documents `pacman -S <package>` for package
  installation and `pacman -Qo` for ownership attestation.
- `https://www.msys2.org/docs/repos-mirrors/` documents the stock `msys` and `ucrt64` repository
  includes used by this installation.

Revision 3 invoked the absolute `pacman.exe` directly from PowerShell. Its child scriptlets inherited
a Windows PATH without `C:\msys64\usr\bin`, which made the unqualified `mkdir`, `cp`, and
`install-info` calls fail. Revision 4 instead uses the absolute login-shell boundary:

```powershell
$bash = 'C:\msys64\usr\bin\bash.exe'
$env:MSYSTEM = 'UCRT64'       # process scope only
$env:CHERE_INVOKING = '1'     # process scope only
& $bash --login -c '<one exact literal command from this SPEC>'
```

Every call must save the prior process presence/value of `MSYSTEM` and `CHERE_INVOKING` and restore
them in `finally`. No command may set a User/Machine environment variable. The literal command may
not contain user-controlled data.

The read-only wrapper control already demonstrated:

```text
MSYSTEM=UCRT64
PATH=/ucrt64/bin:/usr/local/bin:/usr/bin:/bin:...
/usr/bin/pacman
/usr/bin/mkdir
/usr/bin/cp
/usr/bin/install-info
```

It exited `0`, and a separate `exit 23` child propagated exit `23` to PowerShell. Both controls must
be rerun and persisted before mutation. A draft-time attempt to pass the compound control through
`msys2_shell.cmd` hit Windows batch quoting and returned `255`; it changed no state. That batch
boundary is excluded from Revision 4 rather than repaired or trusted.

## 3. Scope

Revision 4 may perform only:

1. Read-only preflight, package/config/environment snapshots, network probes, wrapper controls,
   package-plan previews, and integrity checks.
2. One same-version reinstall of the single package `ca-certificates` from the signed local pacman
   cache, deliberately omitting `--needed` so its scriptlet and transaction hooks rerun.
3. One installation of the exact 17-name `mingw-w64-ucrt-x86_64-gcc` transaction from `ucrt64`.
4. At most one additional GCC invocation, only for an allowlisted transport failure before commit
   and only after all retry preconditions in Section 9 pass.
5. Process-local environment changes for the MSYS login child and Go race child, restored in
   `finally`.
6. Focused race execution and one fresh complete gauntlet.
7. Generated, sanitized logs under the two approved artifact roots and an append-only Revision 4
   result in EVIDENCE.

Revision 4 does not authorize:

- a second CA repair attempt;
- any mutating full-system update or package outside the single CA repair and exact GCC closure;
- deleting cached packages, package databases, locks, certificate files, or the MSYS2 root;
- `--overwrite`, `--dbonly`, `--nodeps`, `--noscriptlet`, `--assume-installed`, manual extraction,
  manual file copying, or a standalone `pacman -U`;
- keyring refresh, signature weakening, mirror/config edits, alternate mirrors, or TLS bypass;
- persistent PATH/`CC`/`CXX`/`CGO_ENABLED`/`MSYSTEM`/`CHERE_INVOKING` changes;
- Windows security, Application Control, service, firewall, DNS, proxy, or reboot changes;
- application, test, verifier, assertion, timeout, threshold, or source behavior changes;
- rollback/uninstall, recursive deletion, production/deploy/broker actions; or
- commit or push after Revision 4 without a separate user request.

## 4. Exact preflight and stock boundary

Before the first package mutation, persist to
`.artifacts/mt5-windows-credential-store/toolchain-revision-4/`:

1. exact WinGet ID/version/root and non-elevated Windows identity;
2. HEAD/tree/branch, remote SHA, successful CI run identity, and exact `git status --short`;
3. complete sorted `pacman -Q` package/version snapshot and package count;
4. pacman/runtime versions, absent GCC package/file, no lock, and no MSYS-rooted process;
5. SHA-256 and parsed signature/repository policy for `pacman.conf`, `mirrorlist.msys`, and
   `mirrorlist.mingw`;
6. User/Machine presence plus SHA-256-only values for `Path`, `CC`, `CXX`, `CGO_ENABLED`,
   `MSYSTEM`, and `CHERE_INVOKING` — 12 comparisons total, with no full values logged;
7. process-scope presence/hashes for `MSYSTEM`, `CHERE_INVOKING`, and PATH before/after each wrapper
   control;
8. `pacman -Dk` output and exact ownership/version of `bash`, `coreutils`, `texinfo`, pacman, and
   `ca-certificates`;
9. the installed CA script and texinfo hook hashes plus the three source/destination bundle sizes
   and hashes; and
10. the default-CA curl exit-77 RED result without logging sensitive headers.

The following configuration hashes are adopted from Revision 3 and must still match:

| File | Required SHA-256 |
|---|---|
| `C:\msys64\etc\pacman.conf` | `0f25288c70ade80c7fac57d3149209b64a7ba23f00232b7e42103f6330b0c1c0` |
| `C:\msys64\etc\pacman.d\mirrorlist.msys` | `7353fdc95956d12a76b6d65231137f0166baf6e88661f142d1876dfe3b7f884d` |
| `C:\msys64\etc\pacman.d\mirrorlist.mingw` | `0ba99a1ca7a8c1499daff0f70281a90abf034dbfdbffac7a68f2c4538d74a8e3` |

Require `SigLevel = Required`, stock `msys`/`ucrt64` includes, no `.pacnew` affecting these files,
and no config drift. Any mismatch stops before package mutation.

## 5. Network gate and signed plan refresh

Before mutation, resolve both `mirror.msys2.org` and `repo.msys2.org`, then require HTTP 200 with
redirects enabled, connect timeout 15 seconds, and total timeout 45 seconds for:

- `https://repo.msys2.org/msys/x86_64/msys.db`
- `https://repo.msys2.org/mingw/ucrt64/ucrt64.db`
- `https://mirror.msys2.org/msys/x86_64/msys.db`
- `https://mirror.msys2.org/mingw/ucrt64/ucrt64.db`

These first probes use Windows TLS because the MSYS default CA is the defect under repair. If the
gate fails, wait 60 seconds and repeat it once. A second failure stops before package mutation. The
read-only network retry does not consume the package retry.

Run the signed database refresh/full-update preview through the approved login shell:

```powershell
& $bash --login -c "pacman --noconfirm --disable-download-timeout -Syu --print-format '%r|%n|%v|%a|%R|%H|%l'"
```

`--print-format` implies print-only for package payloads. The command may refresh signed sync
databases but must print zero base upgrade targets. Any target stops Revision 4 because no mutating
base update is authorized.

## 6. Exact CA repair transaction

Preview the repair through the same login shell:

```powershell
& $bash --login -c "pacman -Sp --print-format '%r|%n|%v|%a|%R|%H|%l' ca-certificates"
```

The preview must contain exactly one target:

```text
msys|ca-certificates|20260816-1|any|||file:///var/cache/pacman/pkg/ca-certificates-20260816-1-any.pkg.tar.zst
```

Require the cached package and its pacman-managed signature material to exist. Any version,
repository, dependency, replacement, conflict, architecture, or location drift stops for a revised
SPEC. Pacman remains responsible for the normal required signature and integrity checks.

Run package-mutating invocation 1:

```powershell
& $bash --login -c 'pacman --noconfirm --disable-download-timeout -S ca-certificates'
```

Omitting `--needed` is intentional: the exact current package must be reinstalled so
`post_upgrade`, `texinfo-remove.hook`, and `texinfo-install.hook` execute inside the corrected PATH.
Process exit zero is necessary but not sufficient. The captured stdout/stderr and exact pacman-log
delta must contain one CA reinstall transaction and must contain none of:

- `command failed to execute correctly`, `command not found`, or unexpected scriptlet output;
- signature/keyring/checksum/integrity errors;
- dependency/conflict/file-collision/disk/permission/database errors;
- removal, downgrade, alternate-provider prompt, reboot, or Application Control errors; or
- package changes other than the same-version CA reinstall.

Any CA repair failure stops immediately. There is no repair retry and no manual completion of the
failed copies.

## 7. CA and hook repair attestation

After the repair, require all of the following before GCC preview:

1. package count and every package version remain identical to the pre-repair snapshot;
2. `pacman -Dk` exits zero and no lock/process remains;
3. each of the three `/usr/ssl` destination files is nonempty and byte-hash-equal to its specified
   extracted source in Section 1;
4. the login child resolves `mkdir`, `cp`, and `install-info` below `/usr/bin`;
5. the transaction output/pacman log shows both texinfo hooks without an error;
6. `pacman -Qkk ca-certificates` reports no missing file and no altered path outside the five
   generated files below `/etc/pki/ca-trust/extracted/`; generated content differences are retained
   as evidence and are not mislabeled as a pristine package check;
7. MSYS curl with no CA override returns HTTP 200 for all four Section 5 URLs; and
8. the full-update print-only preview still contains zero targets.

Do not set `CURL_CA_BUNDLE`, `SSL_CERT_FILE`, `GIT_SSL_NO_VERIFY`, or a custom CA path for this
attestation. The purpose is to prove the repaired default path.

## 8. Exact UCRT64 GCC closure

Preview only:

```powershell
& $bash --login -c "pacman -Sp --needed --print-format '%r|%n|%v|%a|%R|%H|%l' mingw-w64-ucrt-x86_64-gcc"
```

The target names must be exactly these 17 packages, all from `ucrt64`:

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
17. `mingw-w64-ucrt-x86_64-gcc`

The draft-time preview reports GCC `16.2.0-3`. Signed version drift is allowed only if the package
names/repository remain exact, no candidate is a downgrade, and no declared conflict matches an
installed package. Any eighteenth target, missing name, alternate provider, removal, installed
conflict, or repository drift stops before mutation.

Run package-mutating invocation 2:

```powershell
& $bash --login -c 'pacman --noconfirm --needed --disable-download-timeout -S mingw-w64-ucrt-x86_64-gcc'
```

Require exit zero, exactly the 17 previewed package additions, normal signature/integrity checks,
no other package/version change, no output error category from Section 6, no lock/process, and zero
remaining full-update or GCC targets.

## 9. Bounded GCC-only retry

At most one additional package-mutating invocation is authorized, and only for the exact GCC
command in Section 8. It may run after a 60-second delay only when all conditions are true:

1. the failure is exclusively DNS/connect/low-speed timeout, temporary HTTP 408/429/5xx, or
   `failed retrieving file` caused by those conditions before transaction commit;
2. output explicitly says no packages were installed/upgraded;
3. the complete package/version snapshot is unchanged, the pacman-log delta contains no transaction
   start or package change, no database lock remains, and no MSYS process remains;
4. output contains no signature/keyring/checksum/integrity/dependency/conflict/collision/disk/
   permission/database/scriptlet/hook/reboot/Application Control error; and
5. the Windows TLS gate and repaired default-CA MSYS curl gate both pass again after the delay.

The retry consumes package-mutating invocation 3. Any ambiguous failure, partial commit, or second
GCC failure stops immediately. No retry budget carries into another turn without a new SPEC.

## 10. Compiler, environment, and race attestation

After GCC installation, the existing verifier must prove:

- `C:\msys64\ucrt64\bin\gcc.exe` and `g++.exe` exist;
- `gcc -dumpmachine` is exactly `x86_64-w64-mingw32`;
- `pacman -Qo /ucrt64/bin/gcc.exe` attributes it to
  `mingw-w64-ucrt-x86_64-gcc`;
- `gcc --print-file-name libsynchronization.a` returns an absolute existing path below the approved
  UCRT64 tree; and
- all User/Machine environment presence/hashes and pacman configuration hashes remain unchanged.

Run the focused race command from `backend` with process-local values only:

```powershell
$env:CGO_ENABLED = '1'
$env:CC = 'C:\msys64\ucrt64\bin\gcc.exe'
$env:CXX = 'C:\msys64\ucrt64\bin\g++.exe'
$env:Path = 'C:\msys64\ucrt64\bin;' + $priorProcessPath
go test -p=1 -count=1 -race ./internal/mt5credentials ./internal/execution
```

Restore the complete prior process state in `finally`. Require both packages to execute nonzero
tests, exit zero, and emit no `WARNING: DATA RACE`. Compiler failure, timeout, Application Control,
zero tests, or a race report stops; no source/test fix is authorized by Revision 4.

## 11. Failure model

| Failure mode | Required defence/evidence |
|---|---|
| Wrong source/host baseline | Exact clean commit/remote/CI plus package/config/env preflight; drift stops. |
| Repeat of missing `/usr/bin` PATH | UCRT64 login-shell positive control and exact command ownership before mutation. |
| Wrapper hides child failure | Exit-23 propagation control; inspect child exit, stdout/stderr, and pacman-log delta. |
| Exit zero with failed scriptlet | Error-category scan plus three bundle hash checks and real default-CA HTTPS. |
| Repair expands scope | Exact one-package same-version cached preview; no repair retry or manual copying. |
| Partial-system version drift | Signed full-update preview must be empty before repair and before GCC. |
| Signature or trust failure | Stop verbatim; no key refresh, cache deletion, TLS bypass, or weakened policy. |
| Broken package database | `pacman -Dk`, complete snapshots, lock/process checks; no database reconstruction. |
| Unexpected GCC closure | Exact 17-name `ucrt64` allowlist and installed-conflict check. |
| Retry after commit | Package snapshot and pacman-log equality required; retry is GCC transport-only. |
| Wrong compiler/runtime | Absolute UCRT64 ownership, target, and `libsynchronization.a` attestation. |
| Persistent environment mutation | 12 User/Machine hashes plus process restoration checks. |
| Real data race | Preserve report and stop; do not edit source/tests under this SPEC. |
| Other gauntlet failure | Preserve fresh summary and remain BLOCKED; do not weaken or skip a layer. |
| Destructive recovery | No uninstall, root deletion, manual overwrite/copy, rollback, or policy bypass. |

## 12. Executable acceptance scenarios

### R4-S1 — Clean committed adoption

Given commit `f1a26cf` and Revision 3 stop evidence, when R4 starts, then local/remote SHA, successful
CI run, exact package state, absent GCC, config/env hashes, no lock/process, and the three empty CA
destinations are persisted. Any unexplained mismatch stops before mutation.

### R4-S2 — Fail-closed UCRT64 login boundary

Given the absolute Bash path, when the wrapper controls run, then `MSYSTEM=UCRT64`, PATH begins with
the approved UCRT/MSYS prefixes, four required commands resolve below the approved root, success
returns zero, synthetic `exit 23` returns 23, and parent process state is restored.

### R4-S3 — Stock signed zero-update plan

Given stock required-signature configuration and a green Windows TLS gate, when signed databases
are refreshed through the print-only full update, then zero base targets are printed. Any target or
config/source drift stops.

### R4-S4 — Exact cached repair preview

Given the installed CA version and failed copy state, when the repair is printed, then it is exactly
one same-version `msys/ca-certificates` package from the expected local cache with no dependency,
replacement, conflict, or removal.

### R4-S5 — Successful scriptlet/hook repair

Given R4-S4, when the single repair transaction runs, then it completes without any error category,
records only the CA reinstall, reruns both hooks, and receives no retry.

### R4-S6 — Functional default CA recovery

Given R4-S5, when repair attestation runs, then all three destinations are nonempty and equal their
sources, database/package state is valid, no unexpected `Qkk` path exists, and default-CA MSYS curl
returns HTTP 200 for all four repository URLs without an override.

### R4-S7 — Exact GCC transaction

Given zero remaining base targets and the exact 17-name preview, when GCC installs, then only those
17 `ucrt64` packages are added with required signatures. Only an eligible pre-commit transport
failure may consume the single GCC retry.

### R4-S8 — Compiler compatibility

Given R4-S7, when the verifier attests the compiler, then absolute paths, package ownership, target
triple, and `libsynchronization.a` all match Section 10.

### R4-S9 — Process-local environment boundary

Given the attested compiler, when focused race execution ends, then all parent process values are
restored and all 12 User/Machine environment plus three config hashes remain unchanged.

### R4-S10 — Focused real race

Given R4-S8/R4-S9, when the focused race command runs, then both packages execute tests, exit zero,
and emit no data-race report.

### R4-S11 — Fresh complete gauntlet

Given R4-S10 and unchanged verifier assertions, when the canonical command runs from its fresh
report root, then every required layer passes and only `R15-9-live-demo` remains
`UNVERIFIED_ALLOWED`.

### R4-S12 — Honest closure or stop

Given execution completes or stops, when EVIDENCE is appended, then every R4 scenario maps to exact
fresh logs, package attempts, config/env state, source state, and limitations. Only R4-S1 through
R4-S11 passing changes the blocker to resolved.

## 13. Negative invariants

- No application/test/verifier assertion, coverage threshold, mutation score, timeout, or security
  boundary changes.
- No package-mutating command runs before its exact preview and all prerequisite gates pass.
- No fourth package-mutating invocation and no repair retry.
- No retry after state change, scriptlet/hook output, or any non-transport/ambiguous failure.
- No package outside the exact CA reinstall and exact GCC closure changes.
- No signature, checksum, dependency, conflict, TLS, or certificate validation is weakened.
- No full environment value, secret, token, credential, or sensitive response body enters logs,
  Git, evidence, or chat.
- No persistent environment, pacman config, mirrorlist, Windows policy, service, or network config
  changes.
- Existing committed source remains unchanged; generated artifacts and local `.git/info/exclude`
  remain uncommitted.
- No old gauntlet is relabeled as Revision 4 evidence.
- No commit, push, deploy, production activation, broker login, or order is implied by completion.

## 14. Planned mutations, dependencies, and artifacts

### Host mutations after exact approval

1. Signed sync-database refresh from the print-only full-update preview.
2. Same-version reinstall of exactly `ca-certificates 20260816-1`.
3. Installation of exactly the 17-name UCRT64 GCC transaction.
4. At most one eligible GCC transport retry.

The GCC closure is the only dependency addition. It is a build/test dependency required by Go's
Windows race detector and was already disclosed in Revisions 2–3. No application/runtime dependency
is added.

### Repository mutations after exact approval

- Append Revision 4 results to
  `docs/agent-evidence/mt5-windows-credential-store/EVIDENCE.md`.
- Generate sanitized, uncommitted evidence only below:
  - `.artifacts/mt5-windows-credential-store/toolchain-revision-4/`;
  - `.artifacts/mt5-baremetal-managed-ea/` for the fresh canonical gauntlet.

This SPEC file is the only repository mutation before approval. No application source, commit,
push, deploy, or production action is planned by Revision 4.

## 15. Evidence-first execution sequence

Revision 4 changes environment state, not application behavior. The failed default-CA curl and
three empty destination hashes are the observed RED. The login-shell exit-23 control and the
existing missing-GCC checker are fail-closed checker controls; no new source test is applicable.

After the exact approval token:

1. Create the Revision 4 artifact root and persist the complete preflight.
2. Rerun verifier contracts, PowerShell parse, login-shell positive/negative controls, and existing
   missing-toolchain negative control.
3. Run the bounded Windows TLS gate.
4. Refresh/print the signed full-update plan and require zero targets.
5. Preview the exact cached CA repair.
6. Run package-mutating invocation 1 and inspect exit/output/log delta.
7. Prove CA content, hook, package database, default HTTPS, env, and config recovery.
8. Preview the exact GCC closure.
9. Run package-mutating invocation 2, using invocation 3 only under Section 9.
10. Run compiler/package/runtime attestation and final package/env/config comparison.
11. Run the focused race command.
12. Run the entire canonical gauntlet once from a fresh report root.
13. Append EVIDENCE and run final source/status/whitespace checks.

## 16. Required final verification

Focused race prerequisite:

```powershell
Push-Location .\backend
go test -p=1 -count=1 -race ./internal/mt5credentials ./internal/execution
Pop-Location
```

The exact process-local compiler environment in Section 10 is mandatory.

Final one-command gauntlet:

```powershell
powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass `
  -File .\tools\verify-mt5-baremetal-managed-ea.ps1
```

Final evidence must include:

- every wrapper/network/package attempt with command, exit, stdout/stderr category, pacman-log
  delta, and before/after package snapshot;
- the CA source/destination hashes and real default-CA HTTPS results;
- exact 17 package records, compiler version/target/ownership/runtime path;
- focused race output with nonzero tests and no race report;
- one fresh gauntlet summary/source-state/per-layer log set;
- only `R15-9-live-demo` as allowed-unverified;
- 12/12 persistent environment and 3/3 pacman config comparisons unchanged;
- exact final `git status --short`, `git diff --check`, and source tree hash; and
- every stopped/skipped layer honestly marked unverified, never pass.

Independent agent verification remains not authorized/performed. Completion requires all R4-S1
through R4-S11 to pass; otherwise the result remains BLOCKED. Completion does not authorize a
commit, push, deployment, backend restart, worker activation, broker use, or order.

## 17. Completion and stop rules

- The request to continue with Revision 4 authorizes drafting this SPEC only.
- No package repair, GCC install, focused race, full gauntlet, EVIDENCE update, commit, push, deploy,
  rollback, or production action may occur before the exact approval token.
- Any baseline/config drift, nonzero base plan, repair preview drift, CA repair error, default-CA
  failure, GCC closure drift, ineligible/exhausted retry, signature/integrity error, Application
  Control block, real race, or failed gauntlet layer stops immediately.
- Revision 4 authorizes no automatic rollback. The current MSYS2 root and any successfully committed
  package transaction remain in place after a stop for a new explicit decision.

## 18. Approval record (append-only)

- The user input `commit and push, làm sạch git rồi làm tiếp: SPEC Revision 4` authorized the
  completed commit/push/clean-baseline operation and drafting this file. It did not authorize the
  package repair or any later step.
- Required implementation approval is the exact token:
  `Duyệt SPEC Revision 4 sửa MSYS2 CA và chạy lại gauntlet`.
- Effective status at drafting: **AWAITING EXPLICIT APPROVAL**.
- User supplied the exact implementation token on 2026-08-24:
  `Duyệt SPEC Revision 4 sửa MSYS2 CA và chạy lại gauntlet`.
- Effective status after this append-only record: **APPROVED FOR IMPLEMENTATION**.
