# SPEC v1 — Local backend PostgreSQL recovery and secret-file hardening

## Status and authorization

- Task: finish the remaining local PostgreSQL/backend work after the approved password rotation by
  creating a fresh local `smc` database, applying the current schema, reconnecting the backend, and
  narrowing the ignored secret file's ACL.
- Old-coder tier: **Tier 3** because the work changes database state, authentication configuration,
  secret-file access, migrations, and backend availability.
- Approval status: **not yet approved**. The user's request to write a SPEC is not approval of this
  exact document. No database, `backend\.env`, ACL, migration, or verifier mutation may occur until
  the user explicitly approves `local-backend-postgresql-recovery v1`.
- Approval of this SPEC explicitly accepts that the missing `55432/smc` database was a disposable
  development database and authorizes creation of a new empty `smc` database on the live `5432`
  cluster. It does not claim to recover rows from the former database.
- Codebase-memory status: MCP tools are unavailable and the documented CLI fallback is not installed
  in `PATH`. Discovery followed `docs/CODEBASE_MEMORY.md`, repository evidence, current source, Git
  state, and live PostgreSQL inspection.

## Verified baseline (2026-08-25, Asia/Saigon)

- PostgreSQL 17.11 service `postgresql-x64-17` is `Running` and `Auto` at
  `127.0.0.1:5432`, data directory `C:\Program Files\PostgreSQL\17\data`.
- Role `postgres` now authenticates with the approved local secret over IPv4 and IPv6 SCRAM.
  Wrong and absent passwords fail, and live HBA has `trust=0`.
- The live cluster contains connectable databases `postgres` and `template1`; `smc` is absent.
- No process listens on `127.0.0.1:55432`.
- Historical repository evidence says the former `55432/smc` cluster was created specifically for
  local API verification with development-only secrets. No candidate `smc`/MarketLens PostgreSQL
  dump or second data directory was found in the accessible user profile, repository, ProgramData,
  or PostgreSQL installation paths. This is evidence for a fresh-development decision, not proof
  that deleted data is forensically unrecoverable.
- `backend\.env` has SHA-256
  `B8BCC113C41BCC192D5EE91AD6319A9BB8007A3879652BC64BE88B80ACEF3DF0` and contains exactly one
  `DATABASE_URL` targeting `127.0.0.1:55432/smc`.
- Replacing only `127.0.0.1:55432` with `127.0.0.1:5432`, preserving UTF-8 without BOM and LF line
  endings, yields approved SHA-256
  `F27F9E0A0BE721808019E8449ED9B28D2AA05AA5DE8DD076006B99C6816880DF`.
- `backend\.env` is ignored and untracked, but inherited ACL grants read/execute to
  `DESKTOP-F7SJ82A\CodexSandboxUsers`. The intended final ACL disables inheritance and grants only:
  owner `DESKTOP-F7SJ82A\duong` full control, `NT AUTHORITY\SYSTEM` full control, and
  `BUILTIN\Administrators` full control.
- Current migration head is `0042_mt5_managed_ea_bootstrap.up.sql`.
- `go test ./cmd/migrate ./internal/db -count=1 -timeout=60s` passed for both packages (`[no test
  files]`). A baseline `go test ./...` produced no terminal result or package output after roughly
  four minutes and was interrupted; it is not passing evidence and is not a required completion
  layer for this environment-only recovery.
- Existing compiled local API/gateway artifacts date from 2026-08-19. They are suitable only for
  the repository's documented local API wiring check; this SPEC does not call them current
  production artifacts.
- The Git worktree contains unrelated MT5 migration/credential-store work. It must remain untouched.

## Failure model

| Failure mode | Preventive or detecting layer |
| --- | --- |
| Creating over a database that appeared concurrently | Recheck `smc` absence immediately before `CREATE DATABASE`; abort if present instead of dropping or adopting it |
| Pointing at the wrong PostgreSQL cluster | Require exact server version, port, data directory, HBA path, primary state, role, and SCRAM checks |
| Mistaking a fresh database for recovered data | SPEC and EVIDENCE must call it a new empty development database; no recovery claim |
| Migration partially applies | Run current source migrator before editing `.env`; require `schema_migrations=42,false`; never run `down` or force a dirty version |
| Backend switches to an incomplete database | Do not edit `.env` until migrations and schema invariants pass |
| Secret leaks through rewrite, argv, logs, diff, or artifacts | Mechanical in-memory endpoint replacement; no secret in argv/output; child-only environment for migrator; retained-log/artifact/command-line scans |
| ACL hardening locks out the owner or runner | Capture original bytes and ACL in memory, grant exact owner/SYSTEM/Administrators entries, verify owner read and gauntlet execution, restore on failure |
| API is healthy only superficially | Start real compiled API/gateway locally; require database readiness and all documented route probes with no 5xx |
| Old password verifier becomes stale after endpoint change | Update its approved endpoint/hash/database inventory under this SPEC and rerun it inside the new gauntlet |
| Failure after creating `smc` | Restore `.env` bytes and ACL if they were changed; retain the newly created database for diagnosis, never auto-drop or roll migrations back |
| Concurrent repository work is damaged | Add/update only listed task-owned files; no stage/reset/clean/checkout/pull/push |

## Executable acceptance scenarios

### Scenario 1 — Preflight selects the exact secure local cluster

Given PostgreSQL is running at `5432`,
when the recovery entry point performs preflight,
then it must require PostgreSQL major 17, role `postgres`, primary mode, the exact approved data/HBA
paths, active SCRAM on both loopback families, no `trust`, rejection of wrong/no password, no
listener at `55432`, and no `smc` database.

Any mismatch must terminate nonzero before database creation, migration, `.env`, or ACL mutation.

### Scenario 2 — Create one fresh development database without destructive fallback

Given `smc` is absent immediately before mutation,
when recovery creates the database,
then exactly one database named `smc`, owned by `postgres`, must exist on port `5432`.

If `smc` appears before creation, the operation must refuse. It must never drop, rename, overwrite,
restore over, or run `DROP DATABASE` against any database.

### Scenario 3 — Apply the complete current schema before switching the backend

Given the fresh `smc` database exists,
when the current source migrator runs with a child-process-only `DATABASE_URL`,
then `go run ./cmd/migrate up` must exit zero and a direct catalog query must return migration
version `42`, `dirty=false`.

Representative required tables must resolve in the `public` schema, including `users`,
`user_settings`, `sessions`, `alerts`, `execution_accounts`, `execution_commands`,
`execution_mt5_vm_workers`, `execution_mt5_vm_accounts`, and
`execution_mt5_vm_credential_grants`.

No `migrate down`, forced version, schema reset, or migration-file edit is allowed.

### Scenario 4 — Change only the local database endpoint and harden ACL

Given migrations are clean at version 42,
when `backend\.env` is updated,
then exactly one byte-level text substitution changes `127.0.0.1:55432` to
`127.0.0.1:5432`; every other decoded character remains identical; final SHA-256 must be
`F27F9E0A0BE721808019E8449ED9B28D2AA05AA5DE8DD076006B99C6816880DF`.

The password, role, database name, query parameters, and all non-database settings must remain
unchanged and must never be printed.

After ACL hardening, inheritance must be disabled and only owner `duong`, SYSTEM, and Administrators
may have allow entries; `CodexSandboxUsers` and all other identities must have no access entry. The
owner must still be able to read the file and execute the gauntlet.

### Scenario 5 — Password security remains valid after reconnecting the backend

Given the endpoint now targets `5432/smc`,
when the password-rotation verifier is revised under this approved SPEC and rerun,
then correct IPv4/IPv6 authentication must pass, wrong/no password must fail, static/live HBA must
have `trust=0`, database inventory must be exactly `postgres`, `smc`, `template1`, and task/log/
command-line secret scans must remain clean.

The prior password-rotation EVIDENCE remains a historical state-specific report; the new EVIDENCE
must record the revised verifier hash and superseding final state.

### Scenario 6 — Real local backend readiness and API wiring pass

Given the migrated database and hardened `.env`,
when `tools\verify-backend-local.ps1` starts the existing compiled API and execution gateway,
then all 12 documented local probes must match their configured-mode expectations, including
`GET /health=200`, `GET /health/ready=200`, gateway health, protected-route auth boundaries, EA
relay boundary, and unknown-route `404`; no endpoint may return 5xx.

The verifier must stop only the processes it started. It must not start MT5, deploy, pull, build a
production artifact, call the public production URL, or leave local API/gateway listeners running.

### Scenario 7 — Secret and repository boundaries remain clean

Given all state changes are complete,
when the final gauntlet runs,
then the database secret must not occur in task files, PostgreSQL logs, repository runtime logs, or
live process command lines; `backend\.env` must remain ignored/untracked; unrelated Git changes must
remain present and untouched; and task diffs must contain no secret or whitespace error.

## Negative constraints

The task must **not**:

- claim to recover data from the missing `55432/smc` database;
- drop/rename/overwrite any database, run a down migration, force migration state, or edit migration
  SQL;
- print or persist the PostgreSQL password, URL userinfo, or SCRAM verifier outside the ignored
  `backend\.env` source already in use;
- change any `.env` character other than the approved port substitution;
- modify PostgreSQL password/HBA again except read-only verification;
- change production source, API behavior, auth logic, trading logic, frontend, canonical production
  runners, or compiled binaries;
- install a service, second PostgreSQL cluster, proxy, Docker component, dependency, or package;
- use `run-backend-production.ps1`, `deploy-backend.ps1`, `build-production.ps1`, or claim production
  activation;
- stage, commit, push, pull, reset, clean, checkout, or alter unrelated dirty paths.

## RED → GREEN → REFACTOR plan

1. Add `tools\verify-local-backend-postgresql-recovery.ps1` with fail-closed pure/config controls
   and live checks. Run it before mutation and observe RED for absent `smc`, old endpoint, broad ACL,
   missing migration state, and backend readiness.
2. Revalidate preconditions, create only the absent `smc` database, and apply current migrations.
   Verify `42,false` and required tables before any configuration edit.
3. In one guarded PowerShell process, capture original `.env` bytes/ACL in memory, perform the exact
   endpoint substitution without echoing contents, harden ACL, and restore bytes/ACL if a later
   configuration postcondition fails.
4. Update the existing password-rotation verifier only for the newly approved endpoint/hash/database
   inventory, run both verifiers, and freeze behavioral assertions once GREEN.
5. Run the real local API verifier, adversarial controls, and extended secret scan. Refactor verifier
   structure only under green, then run one final fresh entry point after EVIDENCE is present.

## Gauntlet and evidence

Single final entry point:

```powershell
.\tools\verify-local-backend-postgresql-recovery.ps1
```

It must fail closed and run:

1. PowerShell parsing for both task verifiers and `tools\verify-backend-local.ps1`;
2. approved SPEC and final `.env` hash/endpoint/encoding invariants;
3. ACL identity/inheritance checks and `.env` Git ignore/untracked checks;
4. HBA/password positive and negative checks by invoking the revised password-rotation verifier;
5. exact database inventory, owner, migration `42,false`, required-table catalog checks, and old-port
   rejection;
6. `go test ./cmd/migrate ./internal/db -count=1 -timeout=60s` and
   `go vet ./cmd/migrate ./internal/db`;
7. real local API/gateway execution through `tools\verify-backend-local.ps1` with 12/12 probes and
   zero 5xx;
8. checker negative controls for old endpoint, absent database, dirty migration fixture, extra ACL
   identity, `trust`/wrong/no password, secret injection, missing/unreadable input, and wrong port;
9. task/PostgreSQL/runtime-log and live-command-line secret scans using shared-read fail-closed logic;
10. task-owned diff/status checks and explicit preservation of unrelated dirty paths.

The baseline full `go test ./...` is an explicitly unverified layer because it did not return a
terminal result within the observed four-minute run and this task changes no application source.
It must not be reported as passing. Targeted migrator/database compilation, live migration, and the
real 12-endpoint API execution are the risk-matched substitute approved by this SPEC.

Coverage, application property testing, and application mutation tooling are not applicable because
no production implementation or migration SQL changes. The configuration mutants listed above are
mandatory and must all be killed. EVIDENCE will map every scenario, retain the RED and final fresh
results, record exact hashes/toolchain/source state, and list every limitation honestly.

## Planned files, tools, state changes, and Git operations

- Add after approval:
  - `tools\verify-local-backend-postgresql-recovery.ps1`
  - `docs\agent-evidence\local-backend-postgresql-recovery\EVIDENCE.md`
- Update after approval:
  - `tools\verify-local-postgresql-password-rotation.ps1` only for the approved endpoint, `.env`
    hash, and final database inventory expectations.
- Local ignored/config state after approval:
  - mechanically edit only the `DATABASE_URL` port inside `backend\.env`;
  - replace inherited ACL with exact owner/SYSTEM/Administrators full-control entries.
- PostgreSQL state after approval:
  - create fresh database `smc` owned by `postgres` on the existing `5432` service;
  - apply forward migrations through version 42.
- Existing tools only: PowerShell 5.1, PostgreSQL 17 `psql`/`createdb`/`pg_isready`, Go 1.26.5,
  current Go migrator source, Git read-only inspection, existing compiled local API/gateway, and
  existing repository verification scripts.
- New dependencies/installations/services/proxies/generated credential files: **none**.
- Git operations: read-only status, diff, ignore, and hash commands. No stage/commit/push/pull.

## Completion boundary

Completion means a fresh local `smc` database at migration 42, hardened secret-file ACL, backend
configuration pointing to `5432/smc`, password/HBA guarantees preserved, and the real local 12-probe
API gauntlet passing. It does **not** mean production build, deploy, activation, public health, data
recovery, or current-HEAD binary provenance.
