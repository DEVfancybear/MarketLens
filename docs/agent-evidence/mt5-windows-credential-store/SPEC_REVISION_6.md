# SPEC — Accept CA-Generated /usr/ssl Qkk Paths and Finish the Gauntlet (Tier 3, Revision 6)

Status: **APPROVED — EXECUTION AUTHORIZED WITHIN THIS REVISION ONLY**

Date: 2026-08-24
Repository: C:\Users\duong\Downloads\tradingview
Baseline HEAD: f1a26cf304aaf48b0d64ff0f5a8a68f601abc28c on master
Parent SPEC: docs/agent-evidence/mt5-windows-credential-store/SPEC_REVISION_5.md
Parent evidence: docs/agent-evidence/mt5-windows-credential-store/EVIDENCE.md, Revision 5 section
Parent stop report: artifacts/mt5-windows-credential-store/toolchain-revision-5/blocked-state.json
Required approval token: **Duyệt SPEC Revision 6 chấp nhận 8 Qkk paths và chạy gauntlet**

## 1. Narrow objective

Resume from the already completed and attested Revision 5 CA reinstall. Accept the exact eight
post-repair ca-certificates Qkk altered paths observed on this host, then run the remaining
approved signed refresh, GCC closure, compiler attestation, focused race, and fresh canonical
gauntlet.

This revision changes only the Qkk acceptance boundary. It does not authorize another CA
transaction, manual certificate copy, rollback, package database repair, TLS bypass, source change,
or any change to the GCC allowlist or gauntlet assertions.

## 2. Inherited facts and exact Qkk allowlist

Revision 5 evidence proves:

- CA transaction ca-certificates 20260816-1 ran exactly once and exited 0;
- package snapshot remained 90 records;
- all three CA destinations are byte-equal to their extracted sources;
- persistent environment is unchanged 12/12, config hashes unchanged 3/3, and no lock/process remains;
- controls and Windows TLS gate passed; and
- no signed refresh, GCC, race, or gauntlet has run.

The only accepted altered paths for pacman -Qkk ca-certificates are exactly:

1. /etc/pki/ca-trust/extracted/java/cacerts
2. /etc/pki/ca-trust/extracted/openssl/ca-bundle.trust.crt
3. /etc/pki/ca-trust/extracted/pem/email-ca-bundle.pem
4. /etc/pki/ca-trust/extracted/pem/objsign-ca-bundle.pem
5. /etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem
6. /usr/ssl/cert.pem
7. /usr/ssl/certs/ca-bundle.crt
8. /usr/ssl/certs/ca-bundle.trust.crt

No ninth path, missing file, package removal, package version drift, or database error is accepted.
The three /usr/ssl paths are accepted only because the installed CA script intentionally copies
the extracted bundles there and Revision 5 proved their byte hashes equal the sources.

## 3. Scope and exclusions

Revision 6 may perform only:

1. Read-only resume preflight and re-attestation of the eight-path Qkk allowlist;
2. the signed full-update print-only refresh requiring zero targets;
3. the exact 17-name UCRT64 GCC preview/install and one eligible transport retry;
4. compiler attestation and the focused Go race command;
5. one fresh canonical managed-MT5 gauntlet; and
6. generated sanitized artifacts plus append-only Revision 6 EVIDENCE.

It does not authorize:

- any CA reinstall/retry, manual copy, overwrite, rollback, uninstall, cache/database deletion;
- package changes outside the exact GCC closure;
- signature/keyring/TLS/mirror/config/security/environment weakening;
- application, test, verifier, assertion, timeout, threshold, or source changes;
- production/deploy/broker/order actions; or
- commit or push.

## 4. Resume gates before signed refresh

Persist a fresh resume report under
artifacts/mt5-windows-credential-store/toolchain-revision-6/ containing:

- exact HEAD/remote/CI and Git status;
- complete package snapshot equal to the Revision 5 post-CA snapshot;
- no pacman lock or MSYS-rooted process;
- unchanged three config hashes and 12 persistent environment presence/hashes;
- Qkk exit 1 with exactly the eight paths in Section 2 and no missing file;
- all three CA destination/source byte hashes equal; and
- the existing control and Windows TLS reports, or fresh equivalent controls.

Any drift stops before signed refresh. No command may mutate packages before this resume report
and the signed refresh preview is evaluated.

## 5. Signed refresh and exact zero-target gate

Through the absolute UCRT64 login-shell boundary, run:

```text
pacman --noconfirm --disable-download-timeout -Syu --print-format '%r|%n|%v|%a|%R|%H|%l'
```

Require exit 0, successful signed database refresh, zero printed base targets, no signature,
trust, checksum, integrity, dependency, conflict, permission, database, or retrieval error,
unchanged package snapshot, no lock/process, and restored process environment.

Any target, error, drift, or ambiguous output stops immediately. This is print-only for package
payloads and does not authorize a full-system mutation.

## 6. GCC closure, retry, race, and gauntlet

Use the unchanged Revision 5 exact preview and allowlist of these 17 ucrt64 packages:

mingw-w64-ucrt-x86_64-binutils, crt, gcc-libs, gettext-runtime, gmp, headers, isl, libiconv,
libwinpthread, mpc, mpfr, tzdata, windows-default-manifest, winpthreads, zlib, zstd, gcc.

Install with:

```text
pacman --noconfirm --needed --disable-download-timeout -S mingw-w64-ucrt-x86_64-gcc
```

At most one additional identical GCC invocation is allowed after 60 seconds and only for an
eligible pre-commit transport failure with unchanged package/log state, no forbidden error, no
lock/process, and passing Windows TLS plus repaired default-CA curl gates. No retry after commit
or ambiguous failure.

Attest absolute gcc/g++, target x86_64-w64-mingw32, package ownership, libsynchronization.a,
persistent environment, and config hashes.

Run from backend with process-only CGO_ENABLED=1, CC, CXX, and UCRT64 PATH:

```text
go test -p=1 -count=1 -race ./internal/mt5credentials ./internal/execution
```

Require both packages to execute nonzero tests, exit 0, and no WARNING: DATA RACE.

Then run once from a fresh report root:

```powershell
powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File .\tools\verify-mt5-baremetal-managed-ea.ps1
```

Every required layer must pass; only R15-9-live-demo may remain UNVERIFIED_ALLOWED.

## 7. Acceptance scenarios

### R6-S1 — Resume integrity

Given Revision 5 state, when resume preflight runs, then package/config/environment/lock/process
state and exact eight-path Qkk allowlist pass.

### R6-S2 — Signed zero-update refresh

Given R6-S1, when the signed print-only refresh runs, then it exits 0 with zero targets and no
error or package drift.

### R6-S3 — Exact GCC closure

Given R6-S2, when GCC preview/install runs, then only the exact 17-name closure is added and only
one eligible transport retry may occur.

### R6-S4 — Compiler and environment attestation

Given R6-S3, when attestation runs, then compiler paths, target, ownership, runtime library,
config hashes, and persistent environment all pass.

### R6-S5 — Focused real race

Given R6-S4, when the focused race runs, both packages execute tests, exit 0, and emit no data race.

### R6-S6 — Fresh complete gauntlet

Given R6-S5, when the canonical verifier runs, every required layer passes and only the allowed
live-demo gate remains unverified.

### R6-S7 — Honest closure or stop

Given success or any stop, EVIDENCE maps every scenario to fresh logs, exact attempts, source state,
and limitations. No failed layer is relabeled as pass.

## 8. Negative invariants and completion

- No CA mutation or manual file operation is allowed in Revision 6.
- No package outside the exact GCC closure changes.
- No fourth package-mutating invocation and no retry after state change.
- No source/test/verifier assertion or gauntlet threshold changes.
- No secret, credential, full environment value, or sensitive response body enters artifacts, Git, or chat.
- No commit, push, deploy, production activation, broker login, or order is implied.

Completion requires R6-S1 through R6-S6 PASS. Otherwise EVIDENCE remains BLOCKED and no commit or
push occurs. Independent verification is not authorized by this SPEC.

## 9. Approval record (append-only)

- User requested continuation after the Revision 5 Qkk stop.
- Effective status at drafting: **AWAITING EXPLICIT APPROVAL**.
- Required exact implementation token:
  Duyệt SPEC Revision 6 chấp nhận 8 Qkk paths và chạy gauntlet
- No signed refresh, GCC, race, gauntlet, commit, push, deploy, or production action is authorized
  until that exact token is supplied for this exact file.
- 2026-08-24: User supplied the exact token:
  `Duyệt SPEC Revision 6 chấp nhận 8 Qkk paths và chạy gauntlet`.
- Effective status after that token: **APPROVED** for the exact scope and stop rules above.
