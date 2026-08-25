# SPEC revision v2 — Application-Control-safe local API verification

## Status and relationship to v1

- Parent SPEC: `local-backend-postgresql-recovery v1`, SHA-256
  `468A2B09F3D611CBFDE5BE98DEB34BD0C7827C786BDD54D80F7BE85E1D031776`.
- Old-coder tier remains **Tier 3**.
- Approval status: **not yet approved**. The database creation, forward migration, exact `.env`
  endpoint substitution, ACL hardening, and password-verifier update already completed under v1.
  No source-runner implementation may begin until this exact revision is approved.
- Required approval token: `APPROVE SPEC: local-backend-postgresql-recovery v2`.
- This revision supersedes only v1 Scenario 6 and the corresponding verifier/tool-file list. Every
  other v1 acceptance criterion, negative constraint, hash, and completion boundary remains in
  force.

## Observed v1 blocker

- The post-recovery gauntlet reached `18/21`: database inventory, owner, migration `42,false`, nine
  required tables, endpoint, ACL, HBA/password `21/21`, targeted Go test/vet, secret scans, and
  unrelated-worktree hashes all passed.
- `tools\verify-backend-local.ps1` failed before opening a listener when Windows Application
  Control refused `backend\bin\execution-gateway.exe`.
- Code Integrity Operational events `3077` and `3033` identify enforced policy
  `{0283ac0f-fff1-49ae-ada1-8a933130cad6}` and state that the executable did not meet Enterprise
  signing requirements.
- `backend\bin\execution-gateway.exe`, `api.exe`, and `migrate.exe` are unsigned. None has a
  `Zone.Identifier` alternate stream, so this is not a Mark-of-the-Web condition that
  `Unblock-File` could legitimately repair.
- No valid code-signing certificate exists in `Cert:\CurrentUser\My` or
  `Cert:\LocalMachine\My`. `CiTool --list-policies` is access-denied in this session.
- The Go and Rust toolchains are installed and already used by approved checks. Current-source
  `go run ./cmd/migrate up` completed successfully under the same host policy. The repository has
  an ignored Cargo target cache and all locked Rust dependencies needed for an offline attempt.

This is a host artifact-signing blocker, not a PostgreSQL, schema, password, HBA, or API behavior
failure. A passing result must not be invented or inferred from readiness alone.

## Revised Scenario 6 — Real local backend readiness from current source

Given database `smc` is clean at migration 42 and `.env` targets `5432/smc`,
when the recovery gauntlet invokes the documented local backend verifier in explicit source mode,
then that verifier must start:

- the Rust execution gateway through
  `cargo run --locked --offline --release -p execution-gateway` from `backend\execution`; and
- the Go API through `go run ./cmd/api` from `backend` with module network access disabled.

The same existing 12 probes and configured-mode expectations must pass, including database-backed
readiness, Rust gateway health, protected-route boundaries, EA relay/poll boundaries, unknown-route
404, and zero 5xx responses. The verifier must prove all wrapper processes and their descendants
were stopped afterward.

This is current-source local verification only. It is not a CI-artifact test, signed-artifact test,
production build, deployment, activation, public health check, or proof that the unsigned
`backend\bin` artifacts can run under the enterprise policy.

## Authorized implementation

### `tools\verify-backend-local.ps1`

- Add an explicit `-RunFromSource` switch whose default is false.
- Preserve the existing no-argument compiled-artifact behavior exactly.
- In source mode only:
  - select installed `cargo.exe` and `go.exe` wrappers instead of `backend\bin\*.exe`;
  - set `CARGO_NET_OFFLINE=true`, use `--locked --offline`, set `GOPROXY=off` and
    `GOSUMDB=off`, and make no network request;
  - use the existing ignored `backend\execution\target` Cargo cache. Cargo may update only this
    ignored generated cache; no compiled output may be copied into `backend\bin` or Git paths;
  - redirect output to the existing `.runtime-logs` directory without printing URL userinfo or
    secrets;
  - allow a longer readiness timeout for offline current-source compilation;
  - terminate only the exact process trees it started, including Go/Cargo wrapper descendants.
- Add a clear output marker stating `execution mode: current source (offline)` so the final
  gauntlet cannot mistake source execution for compiled-artifact verification.

### `tools\verify-local-backend-postgresql-recovery.ps1`

- Bind the approved revision by exact SHA-256 and approval token.
- Invoke `tools\verify-backend-local.ps1 -RunFromSource -ReadyTimeoutSeconds 600` with a bounded
  15-minute process timeout.
- Require the source-mode marker, `All 12 API probes passed.`, no failed probe, no 5xx, and no
  remaining listeners on ports 8080, 8790, or 8791.
- Add source-runner negative/static controls that reject a missing offline/locked command,
  accidental default-source mode, missing process-tree cleanup, or any production runner/deployer
  reference.
- Include this revision in syntax, whitespace, task status, and retained-secret checks.

### Evidence

- Add final `EVIDENCE.md` only after the source-mode check is green.
- Record the v1 RED (`13/21`, eight expected pre-mutation failures), the post-mutation run
  (`18/21`, Application Control plus absent evidence), Code Integrity events, the exact source-mode
  result, and one fresh final entry-point run after EVIDENCE exists.
- State both unverified boundaries explicitly: full `go test ./...` did not complete in the
  baseline observation, and unsigned/CI-built Windows artifact execution remains blocked and is
  not production verification.

## RED → GREEN → REFACTOR amendment

1. Retain the observed v1 live RED from the blocked unsigned gateway and the Code Integrity event
   evidence.
2. Add source mode without changing default compiled behavior; parse both scripts before execution.
3. Run the source mode offline. If Application Control also blocks a toolchain-generated child,
   stop and report the exact event; do not disable policy, copy binaries, change execution paths,
   or weaken the 12-probe requirement.
4. Kill mutants/static fixtures for online dependency access, unlocked Cargo execution, implicit
   source default, missing tree cleanup, and production-command substitution.
5. Write EVIDENCE, then run one fresh recovery entry point. No task-file edit may occur afterward.

## Additional negative constraints

The task must **not**:

- disable, edit, bypass, audit-relax, or add an exception to Windows Application Control/WDAC;
- create/import a signing certificate or sign, unblock, copy, replace, or modify any executable;
- run a downloaded CI artifact, `run-backend-production.ps1`, `deploy-backend.ps1`, or
  `build-production.ps1`;
- fetch Go/Rust modules, update `go.mod`, `go.sum`, `Cargo.toml`, or `Cargo.lock`;
- change application Go/Rust source, migrations, API behavior, authentication, trading logic, or
  production runner behavior;
- leave Go/Cargo/API/gateway processes, listeners, runtime secrets, or task-owned build output;
- relabel source-mode verification as compiled-artifact, signed-artifact, CI, or production proof.

## Revised planned files, generated state, and verification

- Update only after approval:
  - `tools\verify-backend-local.ps1`;
  - `tools\verify-local-backend-postgresql-recovery.ps1`;
  - `docs\agent-evidence\local-backend-postgresql-recovery\EVIDENCE.md`.
- Add no dependency or service. Allow only ignored Cargo cache updates under
  `backend\execution\target`, standard Go build-cache updates outside the repository, and local
  `.runtime-logs` produced by the verifier.
- No Git stage, commit, push, pull, reset, clean, or checkout.
- Final entry point remains:

```powershell
.\tools\verify-local-backend-postgresql-recovery.ps1
```

- A failing source-mode API check still blocks completion. Policy relaxation is not an authorized
  fallback.
