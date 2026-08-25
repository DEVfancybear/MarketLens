# SPEC — Secure local PostgreSQL credential handoff and final gauntlet (Tier 3, Revision 9)

Status: **APPROVED — EXECUTION AUTHORIZED WITHIN THIS REVISION ONLY**

Date: 2026-08-24
Repository: `C:\Users\duong\Downloads\tradingview`
Current HEAD/remote: `f1a26cf304aaf48b0d64ff0f5a8a68f601abc28c` on `master`
Task base: `b0cabaf67b247412dbd5e02a01c61e75ce54349e`
Parent SPEC: `docs/agent-evidence/mt5-windows-credential-store/SPEC_REVISION_8.md`
Parent evidence: `docs/agent-evidence/mt5-windows-credential-store/EVIDENCE.md`, Revision 8
Required approval token: **Duyệt SPEC Revision 9 nhập PostgreSQL credential cục bộ và hoàn tất gauntlet**

## 1. Narrow objective and adopted stop

Adopt the Revision 8 source/checker work and its fail-closed authentication stop. Revision 8 proved
that the only approved credential source, `backend/.env`, does not authenticate role `postgres` to
the already-running PostgreSQL 17 service on `127.0.0.1:5432`. The helper stopped before
`CREATE DATABASE`; reports record `database_created=false` and no service, policy, config, package,
database, production, broker, or Git mutation occurred.

Revision 9 authorizes one secure local credential prompt in a visible Windows PowerShell process,
an ephemeral DPAPI-protected credential handoff, one positive sandbox preflight, and—only after that
preflight passes—one final fresh canonical gauntlet. The PostgreSQL password must never be entered
in chat, command arguments, source, committed config, logs, reports, or plaintext files.

## 2. Tier 3 failure model

| Failure mode | Required defence |
|---|---|
| Password leaks through chat/argv/output | Visible local `Get-Credential`; fixed username; DPAPI CLIXML path only in child environment; redacted errors |
| Plaintext secret remains in memory or disk | `SecureString`, shortest possible BSTR conversion, zero/free in finally, exact encrypted file deletion |
| Another user/process can read the handoff | DPAPI CurrentUser protection, protected ACL for current SID and SYSTEM only, no inheritance/reparse point |
| Credential targets production/remote PostgreSQL | Gate constructs only `postgresql://postgres@127.0.0.1:5432/postgres`; no host/port/database input |
| Wrong credential wastes a full gauntlet | One isolated positive sandbox preflight before the canonical run; authentication failure stops immediately |
| Prompt cancellation is mistaken for pass | Cancel, empty password, wrong username, unreadable file, or import failure exits nonzero before database work |
| Credential file survives | Exact-path finally cleanup and absence assertion on success, failure, cancellation, and child nonzero exit |
| Sandbox mutates existing data | Revision 8 exact random database grammar, absent-before-create, exact drop, and absence check remain frozen |
| Repeated canonical evidence is cherry-picked | Exactly one canonical invocation after preflight; no retry or reused report |
| Committed-source coverage regresses | Revision 8 frozen `b0cabaf` baseline and negative controls remain mandatory |

## 3. Secure wrapper and credential boundary

Add `tools/run-mt5-credential-store-gauntlet.ps1` as the only Revision 9 entry point. It must:

1. verify it is running on Windows under an interactive current user and that no Revision 9
   credential handoff is already active;
2. show one visible local `Get-Credential` prompt with username fixed to `postgres`; username editing,
   cancellation, or empty password stops;
3. create one unique file only below
   `.artifacts\mt5-windows-credential-store\revision-9\credential-<lowercase-hex-guid>.clixml`;
4. export the `PSCredential` with Windows DPAPI CurrentUser protection, then replace inherited ACLs
   with protected allow rules for the current user SID and SYSTEM only;
5. reject reparse points, additional ACEs, wrong owner/scope, plaintext credential markers, or a
   path outside the exact Revision 9 artifact root;
6. pass only the credential-file path through process environment variable
   `MT5_R9_POSTGRES_CREDENTIAL_FILE`; never pass username/password/full URL through argv or output;
7. run one positive service-sandbox preflight; only if it creates, verifies, drops, and proves
   absence of its exact random database may the wrapper invoke the canonical verifier exactly once;
8. restore every prior process environment value, zero/free any plaintext BSTR, delete only the
   exact credential file in `finally`, and prove the file is absent; and
9. propagate the canonical verifier exit code without relabeling failure.

The wrapper may preserve sanitized JSON/test logs but must not preserve the credential object or
encrypted credential file. The encrypted blob is secret material even though DPAPI-protected and
must never be staged or committed.

## 4. Gate credential import

`tools/verify-migration-0042-disposable.ps1 -UseExistingLoopbackService` must stop using
`backend/.env` under Revision 9. It must:

- require the exact `MT5_R9_POSTGRES_CREDENTIAL_FILE` path below the approved artifact root;
- resolve the path exactly, reject missing/non-file/reparse paths, and verify the protected ACL;
- import one DPAPI `PSCredential`, require username exactly `postgres`, and require a nonempty
  `SecureString`;
- convert to plaintext only long enough to URL-escape and construct the in-process loopback admin
  URL, then zero/free the BSTR in `finally`;
- remove the full admin URL from its own process environment after the Go child exits;
- retain all Revision 8 service identity, PostgreSQL 17, role/database/recovery/port, randomized
  database, cleanup, sanitization, Rust, mutation, and absence assertions; and
- fail closed without trying `backend/.env`, another file, trust auth, a remote URL, another role,
  a password reset, service restart, or policy change.

## 5. Executable acceptance scenarios

### R9-S1 — Credential checker negative controls

Known-bad fixtures for outside-root path, missing file, reparse point, inherited/broad ACL, wrong
username, empty credential, malformed CLIXML, and a plaintext marker each exit nonzero. A synthetic
DPAPI credential for a disposable fake password passes structural import but is never sent to the
database; its file is deleted and the known-bad controls prove the checker failure paths.

### R9-S2 — Secure local prompt and handoff

Given exact approval, when the visible prompt appears, then the user enters the local PostgreSQL
administrator password only in that prompt. The wrapper writes one DPAPI/ACL-protected file, passes
only its path, never logs the secret, and removes the file in every closure path.

### R9-S3 — Credential preflight and isolated database

Given the protected handoff, when positive preflight runs, then the exact loopback PostgreSQL 17
identity authenticates, one random `marketlens_r8_*` database is created, the migration behavior
gate passes, the database is dropped, and its absence is independently recorded. Authentication or
cleanup failure stops before the canonical gauntlet; there is no credential retry in this revision.

### R9-S4 — One final canonical gauntlet

Given R9-S3 PASS, the wrapper invokes exactly once:

```powershell
powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File .\tools\verify-mt5-baremetal-managed-ea.ps1
```

Every required layer must PASS, committed-source Go/Rust changed-line coverage and negative controls
must execute, mutation must kill 13/13, every sandbox database must be absent, and only
`R15-9-live-demo` may remain `UNVERIFIED_ALLOWED`.

### R9-S5 — Secret, host, and source closure

After success or stop, the credential file is absent; no credential/full URL exists in tracked or
untracked source, reports, process environment, or command lines; PostgreSQL service PID/state,
policy/config hashes, package map, and unrelated Git paths remain unchanged.

### R9-S6 — Evidence, commit, push, and CI

After and only after R9-S1 through R9-S5 PASS, append final EVIDENCE, stage only the approved task
paths, audit the staged diff/secret scan, commit, push fast-forward to `origin/master`, verify remote
SHA, and wait for the associated GitHub Actions run to terminal success.

## 6. RED → GREEN → REFACTOR

Before changing the Revision 8 credential path:

1. add source/behavior contracts for the secure wrapper, exact artifact root, DPAPI export/import,
   protected ACL, fixed username, process-only path, exact cleanup, preflight-before-canonical order,
   and forbidden `backend/.env` fallback;
2. run them and observe failure because the wrapper and Revision 9 import boundary do not exist;
3. add checker self-tests for the known-bad credential fixtures and observe RED; and
4. preserve all existing Revision 8 assertions unchanged.

GREEN implements the minimum wrapper/import changes. REFACTOR may deduplicate ACL/path validation
with assertions frozen and must rerun targeted tests after each refactor.

## 7. Verification gauntlet

Before the interactive final entry point:

- PowerShell parse for every changed script;
- Python source contracts and Go test-only helper tests;
- credential checker self-test/negative controls using only a synthetic fake password;
- wrapper cancellation/child-failure cleanup tests that prove the encrypted file is absent;
- secret scan of source, Git diff, and sanitized artifacts without printing candidate values; and
- service/package/config/environment/Git preflight.

The one interactive wrapper invocation then owns the positive credential preflight and the single
fresh canonical gauntlet. Final evidence numbers come only from that run.

Independent agent verification remains not authorized and not performed.

## 8. Dependencies, files, and environment changes

New packages/dependencies: **none**. Use Windows PowerShell, DPAPI-backed `Export-Clixml`/
`Import-Clixml`, .NET ACL APIs, and existing repository tools.

Revision 9 adds this task-owned path:

- `tools/run-mt5-credential-store-gauntlet.ps1`

It may update the already approved Revision 8 task paths, plus:

- `docs/agent-evidence/mt5-windows-credential-store/SPEC_REVISION_9.md`
- `docs/agent-evidence/mt5-windows-credential-store/EVIDENCE.md`

Generated encrypted credential material and reports remain ignored under the exact artifact roots.
The encrypted credential file is always deleted; test/build caches may refresh. No package install,
service/policy/config change, password reset, production/deploy action, broker login, account
connection, or order is authorized.

## 9. Git and completion rule

After the final wrapper/gauntlet succeeds, use the Revision 8 fast-forward staging, commit, push, and
terminal-CI plan. Include SPEC Revision 4 through Revision 9 and the complete EVIDENCE history.
Never stage generated credential material or unrelated changes.

Any prompt cancellation, authentication failure, cleanup failure, leaked secret, failed required
layer, remote divergence, push failure, or failed CI leaves Revision 9 BLOCKED and prohibits a done
claim.

## 10. Approval record (append-only)

- Effective status at drafting: **AWAITING EXPLICIT APPROVAL**.
- Required exact token:
  `Duyệt SPEC Revision 9 nhập PostgreSQL credential cục bộ và hoàn tất gauntlet`
- No prompt, credential file, database action, Revision 9 test/code change, canonical gauntlet,
  commit, push, deploy, broker action, or order is authorized until that exact token is supplied for
  this exact file.
- 2026-08-24: User supplied the exact implementation token:
  `Duyệt SPEC Revision 9 nhập PostgreSQL credential cục bộ và hoàn tất gauntlet`.
- Effective status after that token: **APPROVED** for the exact prompt, DPAPI handoff, test,
  sandbox, gauntlet, commit, push, and stop rules above.
