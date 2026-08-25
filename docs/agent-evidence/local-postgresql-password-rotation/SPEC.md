# SPEC v1 — Local PostgreSQL password rotation

## Status and authorization

- Task: reset the local PostgreSQL administrator password without disclosing it and remove the
  temporary password-bypass rule.
- Old-coder tier: **Tier 3** because an authentication mistake can lock out the database or leave a
  local superuser reachable without a password.
- Approval status: **not yet approved**. No database or PostgreSQL configuration mutation may occur
  until the user explicitly approves this exact file as `local-postgresql-password-rotation v1`.
- Codebase-memory status: MCP tools are unavailable and the documented CLI fallback is not installed
  in `PATH`. Discovery followed `docs/CODEBASE_MEMORY.md` and direct current-state inspection.

## Verified baseline (2026-08-25, Asia/Saigon)

- Windows service `postgresql-x64-17` is running PostgreSQL 17 under
  `NT AUTHORITY\NetworkService` with data directory
  `C:\Program Files\PostgreSQL\17\data`.
- The live cluster accepts connections on `127.0.0.1:5432`; no listener exists on port `55432`.
- The live cluster contains connectable databases `postgres` and `template1`; it does **not** contain
  `smc`.
- Role `postgres` is a login superuser and currently has a SCRAM verifier.
- `C:\Program Files\PostgreSQL\17\data\pg_hba.conf` has one extra first line granting
  `trust` authentication to role `postgres` on `127.0.0.1/32`.
- `pg_hba.conf.bak` differs from the current file by exactly that one `trust` line and otherwise
  matches it.
- `backend\.env` points to `postgres@127.0.0.1:55432/smc`. Its password component is present, is
  32 alphanumeric characters, and will remain secret. This SPEC uses that existing local secret as
  the target password, but it does not change the URL, port, role, or database in the file.

## Failure model

| Failure mode | Preventive or detecting layer |
| --- | --- |
| Resetting the wrong cluster or role | Exact service, data directory, port, current user, and HBA-path preflight; abort on any mismatch |
| Lockout after removing `trust` | Verify the target password over IPv6 `::1`, which already requires SCRAM, before removing IPv4 `trust` |
| Password leaking through chat, argv, environment dumps, logs, or artifacts | Read only the password component into process memory; provide it to `psql` through redirected stdin or a scoped child-process environment; redact errors and scan task-owned artifacts |
| Temporary password bypass left enabled | Byte-for-byte restore from the already-verified backup; live `pg_hba_file_rules` assertion; passwordless and wrong-password negative tests |
| Partial failure between password change and HBA reload | Fail-safe sequence retains IPv4 `trust` until SCRAM authentication succeeds on `::1`; abort before HBA restoration if that check fails |
| Changing or losing application data | No `CREATE`, `DROP`, migration, dump, restore, table DDL/DML, or backend start/restart; compare database inventory before and after |
| Accidentally switching the backend to an empty cluster | Do not edit `backend\.env`; report the existing `55432/smc` mismatch as a separate unresolved issue |
| Damaging concurrent repository work | Add only the task-owned verifier/evidence files; do not edit, stage, commit, reset, clean, or push unrelated paths |

## Executable acceptance scenarios

### Scenario 1 — Preflight selects only the intended cluster

Given the PostgreSQL service is running,
when the rotation entry point runs,
then it must require all of the following before mutation:

- server version major `17`;
- server port `5432`;
- data directory `C:/Program Files/PostgreSQL/17/data`;
- HBA path `C:/Program Files/PostgreSQL/17/data/pg_hba.conf`;
- current role `postgres` with login and superuser attributes;
- current HBA and backup differing by exactly the single known IPv4 `trust` rule;
- a non-empty 32-character target password read from the `DATABASE_URL` in `backend\.env`.

Any mismatch must terminate nonzero before `ALTER ROLE`, file replacement, or configuration reload.

### Scenario 2 — The target password is proven before bypass removal

Given IPv4 `127.0.0.1` currently permits the exact temporary `trust` rule and IPv6 `::1` requires
`scram-sha-256`,
when the role password is reset,
then a new connection to `[::1]:5432` as `postgres` using the target secret must return
`postgres|5432|f` for current user, port, and recovery status before the HBA file is restored.

If this SCRAM connection fails, the operation must stop with the IPv4 recovery rule still present
and must not claim completion.

### Scenario 3 — Temporary trust is removed and SCRAM is live

Given Scenario 2 passed,
when `pg_hba.conf.bak` is restored byte-for-byte and PostgreSQL reloads the configuration,
then:

- current `pg_hba.conf` must equal the backup by SHA-256;
- no active HBA rule may use `trust`;
- loopback host rules must use `scram-sha-256`;
- a fresh authenticated connection to `127.0.0.1:5432` with the target secret must succeed;
- `pg_isready` must report that `127.0.0.1:5432` accepts connections;
- the Windows service must remain `Running`.

### Scenario 4 — Invalid and absent passwords fail closed

Given the final SCRAM configuration is live,
when a fresh non-interactive connection is attempted as `postgres` with a known-wrong password,
then `psql` must exit nonzero with authentication failure.

When a fresh non-interactive connection is attempted with no password,
then `psql -w` must exit nonzero without prompting or hanging.

The checker must treat unexpected exit codes, timeouts, unreadable inputs, or unparseable output as
failures, never passes.

### Scenario 5 — Database and repository scope do not drift

Given the baseline database inventory and dirty Git worktree,
when rotation completes,
then the connectable database names must remain exactly `postgres` and `template1`, no schema
migration or data mutation may run, `backend\.env` must remain byte-for-byte unchanged, and all
pre-existing unrelated Git changes must remain untouched.

### Scenario 6 — Secret handling remains non-disclosing

Given the target secret exists only in ignored local configuration and process memory,
when rotation and verification run,
then the secret must not appear in command-line arguments, console output, task-owned scripts,
SPEC/EVIDENCE, or retained gauntlet output. A task-artifact secret scan must fail if a known-bad
fixture contains the target value and pass after that fixture is removed.

## Negative constraints

The task must **not**:

- display, return, log, commit, or transmit the current, target, or stored SCRAM verifier;
- edit `backend\.env`, `postgresql.conf`, application source, migrations, or production scripts;
- create `smc`, point the backend from `55432` to `5432`, or claim the backend is restored;
- restart or stop PostgreSQL unless a later SPEC revision explicitly authorizes it;
- create/drop roles or databases, execute migrations, or mutate application rows;
- stage, commit, push, pull, clean, reset, or overwrite unrelated worktree changes;
- claim production deployment or production readiness.

## RED → GREEN → REFACTOR plan

1. Add a task-owned PowerShell verifier/gauntlet entry point. Its live check must initially fail
   because the target secret cannot authenticate over the existing IPv6 SCRAM rule and because the
   IPv4 `trust` rule is present. Record that observed RED without printing the secret.
2. Execute the minimal state change: reset only role `postgres` to the existing local target secret,
   prove SCRAM on `::1`, restore the verified HBA backup, and reload configuration.
3. Run the complete verifier and obtain GREEN for positive auth, both negative auth controls,
   HBA equality/live rules, service health, unchanged database inventory, unchanged `backend\.env`,
   and secret absence.
4. Refactor only the verifier if necessary; behavioral assertions remain frozen and the verifier is
   rerun after any refactor.

## Gauntlet and evidence

The persisted entry point will be:

```powershell
.\tools\verify-local-postgresql-password-rotation.ps1
```

It will run, fail closed, and record sanitized results for:

1. PowerShell syntax parsing of the verifier;
2. checker negative controls for a `trust` HBA fixture, an unreadable/missing input, an incorrect
   endpoint, and an injected-secret artifact;
3. live PostgreSQL service/identity/path/version assertions;
4. positive SCRAM authentication over IPv4 and IPv6;
5. wrong-password and absent-password connection failures;
6. role verifier type (`SCRAM` boolean only, never verifier contents);
7. live HBA rule inspection and byte equality with the approved backup;
8. database inventory and `backend\.env` hash invariants;
9. task-owned diff and secret scan;
10. adversarial attempts against the wrong port, wrong role, and a reintroduced `trust` fixture.

Coverage, language type-checking, property-based tests, and application mutation testing are
not applicable because no application implementation, dependency, schema, or query is changed.
The configuration checker's explicit hostile fixtures serve as its negative controls. The final
fresh run will be written to EVIDENCE with exact command results and any skipped layer stated.

## Planned files, tools, dependencies, and Git operations

- Add after approval:
  - `tools\verify-local-postgresql-password-rotation.ps1`
  - `docs\agent-evidence\local-postgresql-password-rotation\EVIDENCE.md`
- Modify outside the repository after approval:
  - PostgreSQL catalog state for role `postgres` password only;
  - `C:\Program Files\PostgreSQL\17\data\pg_hba.conf`, restored exactly from its existing backup;
  - PostgreSQL in-memory HBA configuration via reload.
- Existing tools only: Windows PowerShell, PostgreSQL 17 `psql.exe`/`pg_isready.exe`, SQL catalog
  queries, Git read-only status/diff commands, and SHA-256 hashing.
- New dependencies/installations/generated credential files: **none**.
- Git operations: read-only `status`, `diff`, and hashes only. No stage/commit/push/pull.

## Separate unresolved issue

This rotation does not restore the MarketLens backend. `backend\.env` still targets
`127.0.0.1:55432/smc`, while no listener exists there and the live `5432` cluster has no `smc`
database. Recovering that old cluster or intentionally creating/migrating a new `smc` database has
a different data-loss and application blast radius and requires a separate approved SPEC.
