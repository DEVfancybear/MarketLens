# EVIDENCE — Local PostgreSQL password rotation (Tier 3)

## Result

**PASS within the approved SPEC v1 scope.** The password for role `postgres` on the exact local
PostgreSQL 17 cluster at `127.0.0.1:5432` was reset to the existing 32-character local secret from
`backend\.env`. The temporary IPv4 `trust` rule was removed, the live HBA configuration uses SCRAM,
correct-password connections work over IPv4 and IPv6, and wrong or absent passwords fail.

This did **not** restore the MarketLens backend. `backend\.env` still targets
`127.0.0.1:55432/smc`; no listener exists on `55432`, and the live `5432` cluster has no `smc`
database.

## Authorization and source state

- Approved SPEC: `docs/agent-evidence/local-postgresql-password-rotation/SPEC.md`
- Spec approval: obtained from the user verbatim on 2026-08-25:
  `APPROVE SPEC: local-postgresql-password-rotation v1`
- Approved SPEC SHA-256:
  `F67E334416FB815EC52AD781DB5278F819AA8E2CB305024F7B974587CD138955`
- Old-coder tier: **Tier 3** (authentication bypass and database lockout risk).
- Git base: `f1a26cf304aaf48b0d64ff0f5a8a68f601abc28c` on `master`, with unrelated
  pre-existing dirty work preserved.
- Task-owned verifier SHA-256:
  `7CECE414C4EB7F0C2A3092FFEEC71D5049091156B4B0A36800A5F88C8090D3A8`
- Git operations performed: read-only status/diff/hash commands only. No stage, commit, push, pull,
  reset, clean, or checkout.
- Codebase-memory: MCP tools were absent and the documented CLI fallback was not installed in
  `PATH`; discovery used `docs/CODEBASE_MEMORY.md`, repository documentation, current files, and
  live PostgreSQL inspection.
- Independent verification: **not performed**. No fresh-context verifier protocol was invoked; this
  is a declared Tier 3 confidence limit, not a passing independent review.

## Toolchain

- Windows PowerShell `5.1.26100.9168` Desktop
- PostgreSQL/psql `17.11` (`server_version_num=170011`)
- Git `2.55.0.windows.2`
- Windows service `postgresql-x64-17`: `Running`, `Auto`, identity
  `NT AUTHORITY\NetworkService`
- New dependencies or installations: **none**

## RED → GREEN evidence

### RED observed before mutation

Command:

```powershell
.\tools\verify-local-postgresql-password-rotation.ps1
```

Result: exit `1`; `TOTAL=19 PASSED=14 FAILED=5`.

The five expected failures were:

1. `pg_hba.conf` did not equal the approved backup;
2. the target secret failed IPv6 SCRAM authentication;
3. a known-wrong password was accepted through IPv4 `trust`;
4. a passwordless connection was accepted through IPv4 `trust`;
5. the live HBA catalog still contained `trust`.

This demonstrates that the checker rejected the unsafe starting state rather than passing
vacuously.

### Minimal state change

The mutation process revalidated the approved hashes, service, cluster identity, database
inventory, target credential shape, HBA delta, and safe statement-logging baseline immediately
before changing state. It then:

1. reset only role `postgres` through `psql` redirected stdin, with no password in argv or retained
   output;
2. required a fresh SCRAM verifier and authenticated over `::1` before touching HBA;
3. held an already-connected recovery session open while replacing `pg_hba.conf` byte-for-byte
   from the approved backup and reloading it;
4. rechecked correct, wrong, and absent passwords, live HBA rules, database inventory, and
   `backend\.env` hash;
5. retained in-memory rollback state until all postconditions passed. Rollback was not needed.

Sanitized mutation result:

```text
PREFLIGHT_OK (secret and verifier redacted)
PASSWORD_ROTATED_AND_IPV6_SCRAM_PROVEN
ROTATION_APPLIED_OK
```

PostgreSQL was reloaded, not stopped or restarted.

### GREEN and final fresh gauntlet

Final rerunnable entry point:

```powershell
.\tools\verify-local-postgresql-password-rotation.ps1
```

The final fresh run was executed after the verifier and this EVIDENCE file were present:

```text
TOTAL=21 PASSED=21 FAILED=0
ROTATION_GAUNTLET_OK
```

## SPEC → verification mapping

| SPEC scenario / invariant | Verifier evidence | Status |
| --- | --- | --- |
| 1. Select exact PostgreSQL 17 cluster and role | Approved hashes; Windows service; server and role identity; HBA backup identity | **pass** |
| 2. Prove target password before bypass removal | Mutation marker `PASSWORD_ROTATED_AND_IPV6_SCRAM_PROVEN`; final IPv6 SCRAM check | **pass** |
| 3. Restore HBA and make SCRAM live | Final HBA hash; static rules; live HBA catalog; IPv4/IPv6 auth; readiness; service state | **pass** |
| 4. Reject invalid and absent passwords | Known-wrong password exit `2`; passwordless `-w` exit `2` | **pass** |
| 5. Preserve data and repository scope | Database inventory remained `postgres, template1`; `backend\.env` hash unchanged; unrelated Git state untouched | **pass** |
| 6. Do not disclose the secret | In-memory injected-secret negative control; task-artifact scan; PostgreSQL/runtime-log scan; live command-line scan | **pass** |
| Must not create/drop/migrate data | Exact database inventory before and after; no migration/application command executed | **pass** |
| Must not edit backend configuration | `backend\.env` SHA-256 remained `B8BCC113C41BCC192D5EE91AD6319A9BB8007A3879652BC64BE88B80ACEF3DF0` | **pass** |
| Must not leave `trust` active | Static HBA `trust=0`; live HBA `trust=0`, `parse_errors=0`, `loopback_scram=4` | **pass** |
| Must not restart PostgreSQL | Service remained `Running`; only `pg_reload_conf()` was used | **pass** |

## Gauntlet layers

| Layer | Exact result |
| --- | --- |
| PowerShell parse | `0` parser errors |
| Approved artifact identity | SPEC, `.env`, and HBA-backup hashes matched their approved baselines |
| Checker negative controls | `trust`, `md5`, missing-HBA, wrong-endpoint, wrong-role, and injected-secret fixtures all rejected |
| Positive authentication | IPv4 and IPv6 both returned `postgres\|5432\|f` with the target secret |
| Negative authentication | Wrong password rejected, exit `2`; no password rejected non-interactively, exit `2` |
| Role/server contract | PostgreSQL 17 primary; exact data/HBA paths; `postgres` login+superuser; SCRAM verifier present |
| HBA contract | Current HBA SHA-256 equals backup: `EF22BB9557EB84F3DBEDBB3219120EE95028FC7ADA5F1D2FCC16D7F05D41EABF`; six active static rules; live `trust=0` |
| Data invariant | Connectable databases exactly `postgres` and `template1`; `smc` remains absent |
| Real execution | `pg_isready`: `127.0.0.1:5432 accepting connections` |
| Adversarial pass | Port `55432` and an unapproved role both rejected |
| Git/secret boundary | `backend\.env` is untracked and matched exactly one `.gitignore` rule |
| Secret scan | Three task artifacts clean; 59 task/PostgreSQL/runtime file surfaces clean; live command-line hits `0` |
| Supply chain | No dependency, package, binary, schema, or migration changes |

## Skipped or non-applicable layers

- Full application tests, types, lint, and changed-line code coverage: **not applicable** to the
  external role/HBA state change; no Go, Rust, Python, TypeScript, SQL migration, or production
  application implementation changed. The persisted PowerShell verifier was parser-checked and
  executed against the real service.
- Property-based application testing: **not applicable** because no parser/serialization/math
  behavior was added. Endpoint, role, HBA, and secret fixtures cover the bounded configuration
  inputs changed here.
- Application mutation tooling: **not applicable** because no application implementation changed.
  Configuration mutants (`trust`, `md5`, wrong endpoint/role, missing file, wrong/absent password,
  and injected secret) were all killed by the verifier.
- PostgreSQL restart test: deliberately not run because the approved SPEC forbids stopping or
  restarting the service. A live reload plus fresh IPv4/IPv6 connections verifies the active HBA
  state without expanding scope.
- Independent verifier: not performed, as disclosed above.

## Honest notes and limitations

- A preliminary attempt to automate `psql \password` with redirected stdin used only a dummy role
  and dummy password; `psql` waited for an interactive console, timed out, and was killed. No role
  changed. The actual rotation therefore used fixed SQL through redirected stdin, local session
  logging was forced off for that transaction, output was sanitized, and the verifier scanned
  retained logs afterward.
- The first supplemental logfile scan failed closed because the active PostgreSQL logfile denied
  `ReadAllText` sharing. The persisted verifier was strengthened to use shared read access for
  service-owned logs, then rerun successfully. The initial checker error was never counted as a
  pass.
- The existing ignored `backend\.env` ACL grants read access to the local
  `DESKTOP-F7SJ82A\CodexSandboxUsers` group in addition to the owner, administrators, and SYSTEM.
  This ACL was not changed because SPEC v1 explicitly forbids editing `backend\.env`; hardening it
  requires separate authorization.
- This is a local PostgreSQL credential rotation only. It is not production deployment evidence,
  and it does not prove or restore backend readiness while `DATABASE_URL` targets the stopped
  `55432/smc` endpoint.
- No credential, password, or SCRAM verifier is included in this report.
