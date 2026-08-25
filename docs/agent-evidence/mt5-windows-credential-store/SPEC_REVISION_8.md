# SPEC — Finish the committed-source and PostgreSQL gauntlet (Tier 3, Revision 8)

Status: **APPROVED — EXECUTION AUTHORIZED WITHIN THIS REVISION ONLY**

Date: 2026-08-24
Repository: `C:\Users\duong\Downloads\tradingview`
Current HEAD/remote: `f1a26cf304aaf48b0d64ff0f5a8a68f601abc28c` on `master`
Approved task base: `b0cabaf67b247412dbd5e02a01c61e75ce54349e`
Parent SPEC: `docs/agent-evidence/mt5-windows-credential-store/SPEC_REVISION_7.md`
Parent evidence: `docs/agent-evidence/mt5-windows-credential-store/EVIDENCE.md`, Revision 7
Required approval token: **Duyệt SPEC Revision 8 sửa committed baseline và dùng PostgreSQL service sandbox**

## 1. Objective and inherited state

Finish the managed-MT5 Windows credential-store task without weakening its evidence gates. Revision
7 proved the installed UCRT64 compiler and the focused Go race, then the one fresh canonical
gauntlet stopped at 45 PASS, 10 FAIL, and 1 allowed-unverified result. Revision 8 addresses only the
two demonstrated infrastructure/checker causes:

1. the canonical verifier still derives task scope from the working-tree diff against `HEAD`, even
   though the coherent implementation was already committed in `f1a26cf`; and
2. the current Windows Application Control policy rejects the unsigned PostgreSQL 17 client/server
   executables at Enterprise signing level, while an exact PostgreSQL 17 Windows service that
   started before enforcement remains running locally.

Revision 8 will make every task-diff audit use the explicit approved base `b0cabaf` through the
current source state and will run migration/database checks inside a newly created, uniquely named
database on that already-running loopback service. It will not disable or modify Application
Control, start or restart PostgreSQL, reuse an existing application database, or relax a migration,
coverage, mutation, secret, dependency, or capability assertion.

## 2. Tier 3 failure model

This remains Tier 3 because the checked implementation stores broker credentials and controls trade
execution lifecycle.

| Failure mode | Required defence |
|---|---|
| A clean worktree erases the implementation from coverage | Frozen task base, ancestry checks, exact base-to-source diff, and a HEAD-baseline negative control |
| A caller chooses a smaller diff to inflate coverage | No user-selectable baseline; exact checked-in base constant and contract test |
| Secret/capability/dependency audits inspect only uncommitted text | Every task-diff audit uses the same frozen base and includes current untracked task files |
| The local database credential targets a remote or production server | Require PostgreSQL scheme, loopback host, exact local service/port, role `postgres`, and process-only secret handling |
| Existing database data is altered | Create a random absent database, run only there, and drop that exact database in cleanup |
| Cleanup drops the wrong database | Exact generated-name grammar, recorded run token, current-database rejection, and independent post-drop absence check |
| Application Control is bypassed or host security is weakened | No policy/service/package mutation; use the already-running service and fail closed on blocked Go/Rust execution |
| Migration gate passes without exercising behavior | Preserve up/down/up, dirty recovery, SQL assertions, known-bad control, ignored Rust DB tests, and M6 mutation |
| Infrastructure failure is mislabeled as a mutant kill | Preserve infrastructure classification; all 13 mutants must be real kills |
| Stale results are reported as final | Delete the exact canonical report root and run the canonical entry point once after the last edit |

## 3. Exact source and Git baseline contract

The canonical verifier must define the immutable task base as full SHA
`b0cabaf67b247412dbd5e02a01c61e75ce54349e`. Before any expensive layer it must prove:

- the object exists and is a commit;
- it is an ancestor of `HEAD`;
- `f1a26cf304aaf48b0d64ff0f5a8a68f601abc28c` is present in the base-to-HEAD range;
- the exact committed credential-store implementation and its Go/Rust production paths are in the
  base-to-current diff; and
- no caller parameter or environment variable can replace or narrow the base.

The following must all use the same base-to-current source range, plus current untracked task files
where applicable:

- task source-state manifest and aggregate hash;
- Go and Rust changed-source discovery and zero-context coverage diffs;
- added-text secret scan;
- production-runner capability audit;
- dependency and lockfile delta audit; and
- whitespace checking of task-owned changes.

The separate before/after dirty-worktree preservation check remains based on `git status` and must
not overwrite or stage paths outside this revision. A negative control must prove that substituting
`HEAD` discovers no committed Go/Rust production change and therefore fails; invalid and
non-ancestor bases must also fail.

## 4. Existing PostgreSQL service sandbox contract

The database gate may use the existing service only when every preflight condition passes:

- Windows service name is exactly `postgresql-x64-17`, state is already `Running`, and its process
  and configured data root resolve to the installed PostgreSQL 17 tree;
- the service was running before Revision 8 and Revision 8 performs no start, stop, restart,
  configuration edit, firewall edit, or service-control mutation;
- its configured port is exactly `5432`, the connection target constructed by the gate is exactly
  loopback, and server major version is exactly 17;
- `backend/.env` contains one parseable loopback `DATABASE_URL` with role exactly `postgres` and a
  nonempty password; its current port is not contacted, and only its credential component is reused
  in process memory for `127.0.0.1:5432/postgres`;
- the authenticated session proves `current_user = postgres`, current database is the maintenance
  database, server is not in recovery, and the generated target database does not already exist;
  and
- no URL, password, full connection string, environment value, or server data row is written to a
  command line, log, JSON report, Git, or chat.

The gate creates exactly one database per invocation with grammar
`marketlens_r8_<lowercase-hex-run-token>`. It connects to and mutates only that database. Cleanup
must terminate sessions only for that exact generated name, drop only that database, and verify its
absence from the maintenance connection. An authentication, ownership, version, naming, creation,
test, or cleanup mismatch is a hard failure. No fallback to a remote URL, existing application
database, trust authentication, alternate role, or production database is allowed.

An interrupted process may leave only the exact recorded generated database. The next run must stop
and report it; automatic wildcard cleanup and deletion of an unproven leftover are forbidden.

## 5. Database runner implementation boundary

Add a test-only Go command under `backend/cmd/mt5-migration-gate/` using only Go modules already in
`backend/go.mod`. It must:

- accept the admin credential only through a process environment variable supplied by the
  PowerShell gate, never through argv;
- validate the loopback/admin/name contract again in Go;
- create the unique database, construct its target URL without printing it, and record only
  sanitized state;
- apply migrations through 41, seed the pre-0042 state, apply 0042, run `assert_up.sql`, migrate
  down, run `assert_down.sql`, migrate up again, and run runtime invariants;
- rehearse the existing obstruction/dirty-version/force/recovery sequence exactly;
- in negative-control mode, execute the known-bad SQL and require the exact
  `KNOWN_BAD_0042_CHECKER_INPUT` failure;
- in Rust mode, run the ignored managed-database tests with the target URL only in the child
  environment and require a nonzero executed test count with zero failures; and
- clean up the exact database in a `defer`/finally path and return nonzero if cleanup or the
  independent absence check fails.

`tools/verify-migration-0042-disposable.ps1` remains the public gate. Add an explicit
service-sandbox mode used by the canonical verifier and M6 mutation checker. The legacy isolated
cluster mode remains available and unchanged for hosts where signed PostgreSQL executables run.
The service-sandbox mode must never attempt `postgres.exe`, `initdb.exe`, `pg_ctl.exe`,
`pg_isready.exe`, or `psql.exe`.

Exact OS 4551 retries remain permitted only around the already established Go/Rust child execution
boundary, with the existing bounded retry count and exact error pattern. Exhaustion is BLOCKED, not
a skip or pass.

## 6. Executable acceptance scenarios

### R8-S1 — Adopt exact Revision 7 stop state

Given the Revision 7 reports and current worktree, when preflight runs, then HEAD/remote, successful
CI, 107-package/compiler state, unchanged configs/environment, exact documentation-only dirty paths,
and no package/process lock drift are proven without mutation.

### R8-S2 — Committed task baseline is complete and fail-closed

Given the frozen `b0cabaf` base, when source discovery runs, then every committed and current
task-owned path is manifested, Go and Rust production diffs contain real hunks, and the coverage
checker receives those diffs. Given HEAD, an invalid object, or a non-ancestor as a synthetic base,
the checker exits nonzero for the expected reason.

### R8-S3 — All task-diff audits share the baseline

Given the same base, when dependency, lockfile, secret, capability, and whitespace audits run, then
they inspect the full task delta and pass only the already approved dependency/capability changes.
Known-bad extra dependency, secret-shaped added text, and extra runner capability fixtures are each
rejected.

### R8-S4 — Loopback PostgreSQL sandbox is isolated

Given the already-running exact service and valid local credential source, when the database gate
runs, then it proves server identity, creates one absent random database, never changes service or
policy state, and removes that exact database with a verified absence result. Remote URLs, wrong
roles, wrong ports, existing names, malformed names, and cleanup-name substitution are rejected.

### R8-S5 — Migration and Rust database behavior pass

Given the isolated database, when the positive gate runs, then up/down/up, runtime invariants,
dirty obstruction, force/recovery, and ignored Rust managed-database tests all execute and pass.
When the negative-control gate runs in a separate sandbox, it exits nonzero with the exact
known-bad marker and still removes its database.

### R8-S6 — Mutation remains meaningful

Given the same service-sandbox path, when the persisted mutation runner executes, then its self-test
passes and all 13/13 mutants, including M6, are killed by expected behavioral failures; zero mutant
is classified as infrastructure failure or survivor.

### R8-S7 — One fresh canonical gauntlet passes

Given all RED tests were observed and the implementation is green, when the unchanged public entry
point runs once after the last edit:

```powershell
powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File .\tools\verify-mt5-baremetal-managed-ea.ps1
```

then every required layer is PASS, both changed-line gates and their negative controls execute,
mutation is 13/13, database sandboxes are absent afterward, and only `R15-9-live-demo` may remain
`UNVERIFIED_ALLOWED`.

### R8-S8 — Evidence, commit, push, and CI closure

Given R8-S1 through R8-S7 pass, when closure runs, then EVIDENCE maps every scenario and invariant
to the final fresh reports, only task-owned paths are staged, the staged diff is audited, one
fast-forward commit is pushed to `origin/master`, and the resulting GitHub Actions run reaches a
successful terminal conclusion. A failed gauntlet, cleanup failure, remote divergence, or failed CI
blocks completion and push/finish claims.

## 7. Negative invariants

- No Windows Application Control, WDAC/AppLocker, signing, certificate, firewall, service, registry,
  PostgreSQL configuration, persistent environment, package, CA, mirror, compiler, or PATH mutation.
- No start, stop, restart, reinstall, repair, or upgrade of PostgreSQL.
- No access to a remote database and no mutation of an existing database or schema.
- No secret or full connection string in argv, output, reports, source, Git, or chat.
- No weakening, skip, retry-by-edit, threshold change, timeout inflation, assertion removal, or
  relabeling of coverage, mutation, migration, Rust, secret, dependency, or capability failures.
- No production/deploy activation, broker login, account connection, live demo, or order.
- No staging, commit, overwrite, cleanup, or restore of unrelated user work.
- No commit or push until the one final fresh gauntlet passes completely under this revision.

## 8. RED → GREEN → REFACTOR

RED is mandatory before implementation:

1. add contract tests that require the frozen baseline across source-state, coverage, dependency,
   secret, capability, and whitespace logic; run them against the current verifier and observe the
   expected failures;
2. add Go unit tests for loopback/admin URL validation, generated database naming, exact cleanup
   targeting, sanitized reporting, and failure-path cleanup; observe them fail before the helper
   exists;
3. add/update the PowerShell source contract for explicit service-sandbox invocation and forbidden
   PostgreSQL executable use; observe it fail against the current gate; and
4. retain the Revision 7 canonical failure as the integration RED: 10 failed layers with exact logs.

GREEN implements only enough verifier/helper code to pass the frozen assertions. REFACTOR may
deduplicate baseline Git calls and database validation while behavioral assertions remain frozen;
targeted tests rerun after every refactor.

## 9. Verification gauntlet

Before the final canonical run, execute and record:

- PowerShell parse of all changed `.ps1` files;
- targeted Python contract tests for the canonical verifier, mutation runner, and migration gate;
- targeted Go unit tests for `cmd/mt5-migration-gate`;
- checker negative controls for bad baselines, bad dependency/capability/secret input, remote/wrong
  database URLs, unsafe names, and cleanup substitution;
- one positive service-sandbox migration/Rust run and one known-bad negative-control run;
- exact database-absence, service-state, config-hash, environment-hash, package-map, and Git-state
  checks after each real database run; and
- the single final canonical entry point in R8-S7 after the last edit.

All final counts must come from that final fresh canonical run. Changed-line coverage remains 100%
for executable Go/Rust lines in the full base-to-current task delta. Mutation remains 13/13. No
layer may be reported from Revision 7 as if it were fresh Revision 8 evidence.

Independent agent verification is not authorized or performed; it is not a substitute for an
executable layer.

## 10. Dependencies, generated files, and environment changes

New packages/dependencies: **none**. Use only the existing Go PostgreSQL/migration modules,
PowerShell, Git, Python, Go, Rust/Cargo, LLVM coverage tools, and repository scripts.

Expected task-owned source paths:

- `tools/verify-mt5-baremetal-managed-ea.ps1`
- `tools/verify-mt5-baremetal-managed-ea-mutants.ps1`
- `tools/verify-migration-0042-disposable.ps1`
- `backend/cmd/mt5-migration-gate/main.go`
- `backend/cmd/mt5-migration-gate/main_test.go`
- `backend/bridge/mt5_vm/test_managed_gauntlet.py`
- `backend/migrations/test_0042_disposable_gate.py`
- `docs/agent-evidence/mt5-windows-credential-store/SPEC_REVISION_4.md` through
  `SPEC_REVISION_8.md`
- `docs/agent-evidence/mt5-windows-credential-store/EVIDENCE.md`

If implementation proves another test-only path is necessary, stop and append a visible revision;
do not silently expand this list.

Generated reports remain ignored below the existing exact `.artifacts/` roots. Test/build caches may
refresh. The only database mutation is creation and deletion of exact Revision 8 sandbox databases
on the existing local service. `backend/.env` is read locally and not modified.

## 11. Git, push, and CI plan

After and only after R8-S7 passes:

1. fetch and prove `origin/master` is still a fast-forward ancestor/target without rebasing,
   stashing, resetting, or force-pushing;
2. stage only the task-owned paths in Section 10;
3. inspect `git diff --cached --check`, the staged path allowlist, secret scan, and staged diff;
4. commit the verifier repair, Revision 4–8 SPEC records, and final EVIDENCE together;
5. push normally to `origin/master`; and
6. verify remote SHA and the associated GitHub Actions workflow to terminal success.

If remote divergence or CI failure occurs, stop with exact evidence. No deploy or production run is
authorized.

## 12. Evidence deliverable and completion rule

Append Revision 8 to
`C:\Users\duong\Downloads\tradingview\docs\agent-evidence\mt5-windows-credential-store\EVIDENCE.md`.
It must record the approval token, RED observations, exact commands/results/counts/hashes, baseline
range, database sandbox creation/absence proofs without secrets, all skipped/blocked layers, staged
path audit, commit/remote SHA, and terminal CI result.

Completion requires R8-S1 through R8-S8 PASS. Any failed canonical layer, database cleanup failure,
secret exposure, unauthorized host mutation, commit-scope drift, push failure, or CI failure leaves
the task BLOCKED and prohibits a done claim.

## 13. Approval record (append-only)

- Effective status at drafting: **AWAITING EXPLICIT APPROVAL**.
- Required exact token:
  `Duyệt SPEC Revision 8 sửa committed baseline và dùng PostgreSQL service sandbox`
- No test, verifier, helper, application, database, service, policy, commit, push, deploy, broker, or
  order action is authorized by Revision 8 until that exact token is supplied for this exact file.
- 2026-08-24: User supplied the exact implementation token:
  `Duyệt SPEC Revision 8 sửa committed baseline và dùng PostgreSQL service sandbox`.
- Effective status after that token: **APPROVED** for the exact scope, mutations, verification,
  commit, push, and stop rules above.
