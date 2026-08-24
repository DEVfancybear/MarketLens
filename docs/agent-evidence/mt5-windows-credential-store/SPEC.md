# SPEC — Managed MT5 Windows Credential Store (Tier 3, Revision 1)

Status: **AWAITING EXPLICIT APPROVAL — NO IMPLEMENTATION AUTHORIZED**

Date: 2026-08-24
Repository: `C:\Users\duong\Downloads\tradingview`
Baseline source: `b0cabaf67b247412dbd5e02a01c61e75ce54349e` on `master`
Approval token: **`Duyệt SPEC Revision 1 bỏ Vault bằng Windows Credential Manager`**

## 1. Objective

Remove the HashiCorp Vault runtime dependency from the managed MT5 credential lifecycle and replace
it with a source-owned adapter over Windows Credential Manager generic credentials. After this
change, a supported Windows production host must not need `vault.exe`, a Vault server, a Vault
namespace, a Vault address, or a Vault API token.

The existing browser -> Go -> Rust -> worker one-time grant boundary remains. Only the credential
store behind Go changes. PostgreSQL continues to hold opaque secret references and grant hashes,
never broker passwords.

## 2. Scope and non-goals

### In scope

- Replace `backend/internal/mt5vault` with a provider-neutral credential domain and a Windows
  Credential Manager implementation based on `CredWriteW`, `CredReadW`, and `CredDeleteW`.
- Use `CRED_TYPE_GENERIC` and `CRED_PERSIST_LOCAL_MACHINE` under the Windows identity running the Go
  API. A target name contains only a fixed MarketLens prefix and the random opaque secret reference.
- Remove `MT5_VAULT_ADDR`, `MT5_VAULT_API_TOKEN_FILE`, and `MT5_VAULT_NAMESPACE` from active runtime
  configuration, production examples, source-derived docs, setup/runbooks, and capability gating.
- Preserve connect, reconnect/credential rotation, session credential consumption, disconnect,
  remove, compensation, owner/revision fencing, redaction, and one-time grant semantics.
- Keep `EXECUTION_MT5_IDENTITY_HMAC_KEY_FILE` as an independent protected-file requirement. It is
  not a Vault dependency and remains shared by Go and Rust for stable tenant-bound identity.
- Add a safe Windows readiness probe that writes, reads, and deletes only a unique synthetic
  canary. Managed MT5 is not advertised when the probe cannot prove exact round-trip and cleanup.
- Update the existing managed-MT5 gauntlet, mutation runner, docs verifier, configuration docs, and
  handoff runbook.

### Explicit non-goals

- No replacement or removal of PostgreSQL, Firebase, SMTP, S3-compatible optional storage, MT5,
  broker services, TLS, DNS, or the reverse proxy.
- No frontend redesign. The existing UI continues to follow the backend capability response.
- No broker password, Vault token, Windows password, OTP, or other real secret may be requested in
  chat, committed, logged, embedded in tests, placed in argv/environment, or written to an
  application-owned plaintext file.
- No automatic import of an existing Vault database. Existing managed accounts whose opaque
  references point only to Vault must fail closed and require an authenticated reconnect with new
  credentials. The current production handoff states that Vault/worker activation was not run, but
  the code must not rely on that historical fact for safety.
- No production deploy, migration execution, worker start, broker login, Demo connection, Live or
  funded account activity.
- No commit or push. Those are separate user-authorized delivery actions after EVIDENCE passes.

## 3. Security and failure model

| Failure mode | Required defence and evidence |
|---|---|
| Go API runs under a different Windows identity after restart | Store is tied to the current token's credential set; startup probe disables the capability, emits a sanitized error, and never treats missing credentials as empty credentials. Runbook pins a stable dedicated identity. |
| Network logon has no credential set | Map `ERROR_NO_SUCH_LOGON_SESSION` to a sanitized unavailable result; capability stays false; focused injected-error test plus Windows smoke under the actual identity. |
| Credential Manager record exposes tenant, login, server, or password in metadata | Target is exactly `MarketLens:MT5:<opaque-ref>`; username/comment/attributes contain no account data; a fake WinAPI capture test asserts metadata redaction. |
| Oversized or malformed credential blob | Versioned, bounded encoding; encoded length must be `1..2560` bytes; input validation runs before every WinAPI call; hostile/boundary property tests. |
| Wrong credential is read after a target collision | Cryptographically random 128-bit references retain the existing exact format; exact target mapping; concurrent property/stress test; no wildcard enumeration for normal reads. |
| Rotation partially succeeds | Preserve reserve -> write-new -> activate -> delete-old compensation order; every failed stage leaves either the previous usable reference or a safely reconnectable state; integration tests inject each failure. |
| Session credential remains after one-time consumption | Delete before returning the private response, keep `Cache-Control: no-store`, consume Rust grant first, and prove a second read fails. |
| Delete is retried after a crash | `ERROR_NOT_FOUND` is the only idempotent-delete success; other errors fail closed; exact-target negative tests. |
| Process crashes during startup canary | Canary uses a unique test-only target and a deferred delete; the next startup cleanup is restricted to the exact canary prefix and never enumerates/deletes managed account targets. Smoke verifies zero new leftovers. |
| Secret appears in logs, responses, PostgreSQL, env, argv, evidence, or application files | Existing redaction/API tests stay; add provider metadata assertions, repository secret scan, database-column contract, and log capture tests. Credential plaintext exists only in bounded Go memory and the Win32 API input/output buffer, which is explicitly cleared after use. |
| Linux/non-Windows build accidentally advertises Managed MT5 | Build-tagged non-Windows implementation returns a typed unsupported error; capability remains false; Linux compile/test gate. |
| Compromised Go process reads Credential Manager | Declared residual risk: code running as the same Windows identity can access that identity's generic credentials. Mitigation is a dedicated least-privilege API identity, loopback Rust/worker boundaries, exact grants, and host ACL/Application Control. This replacement is single-host, not equivalent to Vault's remote isolation/HA/audit model. |
| Host or service identity is lost | Declared recovery boundary: Credential Manager data is identity/host-bound. Database restore alone does not restore credentials; users must reconnect. No export endpoint or plaintext backup is added. |

## 4. Executable acceptance scenarios

### S1 — Windows credential round-trip

Given a valid random `mt5-<32 lowercase hex>` reference and valid Demo credential, when `Put`,
`Get`, and `Delete` run under a supported Windows logon, then `Get` returns the exact three fields,
`Delete` removes the exact target, and a later `Get` returns a typed not-found error containing no
credential or target value.

### S2 — No Vault runtime dependency

Given no Vault binary, server, address, token file, namespace, or `MT5_VAULT_*` environment value,
when the Windows credential-store probe succeeds and the identity HMAC key is valid, then the Go API
advertises `connectors.mt5Managed=true` and mounts the existing managed connector routes without any
network call to Vault.

### S3 — Legacy Vault variables fail closed

Given any non-empty legacy `MT5_VAULT_ADDR`, `MT5_VAULT_API_TOKEN_FILE`, or
`MT5_VAULT_NAMESPACE`, when production configuration loads, then startup fails with an actionable
message naming only the obsolete variable and never its value. This prevents operators from
believing an old Vault token is still being honored.

### S4 — Stable service identity and unavailable credential set

Given Win32 returns `ERROR_NO_SUCH_LOGON_SESSION`, access denied, malformed data, or an unexpected
error, when readiness runs, then Managed MT5 is not advertised, no managed route accepts a
credential, and logs contain only an error category/correlation ID.

### S5 — Metadata contains no account information

Given a credential containing distinctive login, password, and broker server values, when `Put`
invokes Win32, then only the protected credential blob contains those values; target, username,
comment, and attributes contain none of them.

### S6 — Input and size limits are fail-closed

Given an invalid reference, nonnumeric/oversized login, empty/oversized password, invalid server,
control characters, a malformed version, or an encoded blob over 2560 bytes, when any store method
runs, then it returns a sanitized validation error and makes zero Win32 calls.

### S7 — Exact idempotent deletion

Given an existing target, deleting it twice succeeds; given access denied or any error other than
not-found, deletion fails and does not touch a sibling reference or prefix.

### S8 — Connect keeps secrets out of durable/public state

Given a signed-in owner submits a managed Demo credential, when connect succeeds, then PostgreSQL
and Rust receive only the opaque reference/identity metadata, public responses contain no password
or reference, and Credential Manager receives one record.

### S9 — Rotation and compensation

Given an existing managed credential, when reconnect rotates it, then a new random record is written
before activation and the old record is deleted only after activation. Injected write, activation,
and delete failures preserve the existing fencing and compensation contract and never expose either
credential.

### S10 — One-time session grant cleanup

Given a session-persistence credential and a valid worker/session/lease/command-bound grant, when the
grant is consumed, then Rust consumes the grant before Go reads the credential, Go deletes the
record before responding, the private response is `no-store`, and replay cannot read the record.

### S11 — Remove permanently deletes all known versions

Given active and pending references, when authenticated remove succeeds, then both exact Credential
Manager targets are absent before Rust finalization; not-found is accepted, all other deletion errors
block finalization.

### S12 — Existing Vault-only references fail safely

Given PostgreSQL contains an opaque reference with no Windows credential record, when a worker grant
or reconnect flow encounters it, then no empty/default credential is returned. Consumption fails
sanitized; authenticated reconnect may install a new record; no automatic Vault call or plaintext
migration occurs.

### S13 — Cross-platform behaviour

Given a non-Windows build, when the credential provider is initialized, then it returns a typed
unsupported-platform result and never advertises the connector. All non-Windows backend builds and
unrelated APIs continue to compile and test.

### S14 — Real disposable Windows smoke

Given the test process's actual Windows credential set, when the persisted gauntlet creates a unique
synthetic record, reads it, deletes it, and checks absence, then the exact round-trip passes and no
new `MarketLens:MT5:test:` record remains. No broker, production account, or user credential is used.

## 5. Negative invariants

- The worker, Rust gateway, browser, PostgreSQL, logs, public/private error text, command line, and
  environment must not receive a broker password except the existing one-time private credential
  response after grant consumption.
- The worker cannot call Windows Credential Manager directly.
- No generic credential target may contain owner ID, account ID, login, broker server, label, email,
  password, or credential version.
- No wildcard delete, prefix-wide production cleanup, credential enumeration in request paths, or
  best-effort success on unexpected Win32 errors.
- Existing owner/revision/lease/session/command fencing and route authentication may not weaken.
- Existing legacy EA execution and read-only MT5 market-data paths may not change behaviour.
- `EXECUTION_MT5_IDENTITY_HMAC_KEY_FILE`, admin token, worker bootstrap token, auth secret, and broker
  credential remain independent.
- Production runner/deploy entrypoints and loopback listener topology remain canonical.

## 6. Planned implementation surface

Expected task-owned paths (exact names may be narrowed, but expansion requires a SPEC revision):

- Remove/replace `backend/internal/mt5vault/**`.
- Add `backend/internal/mt5credentials/**` with provider-neutral types, bounded encoding, Windows
  implementation, non-Windows fail-closed implementation, unit/property tests, and Windows smoke.
- Update `backend/internal/execution/**` names and tests from Vault-specific to provider-neutral store.
- Update `backend/cmd/api/main.go`, `backend/internal/config/config.go`, and their tests/capability
  wiring.
- Update `backend/go.mod` only to promote the already pinned `golang.org/x/sys v0.46.0` from
  indirect to direct use; no new module or version is authorized.
- Update `.env.example`, `backend/.env.example`, backend README/docs, managed MT5 runbooks,
  security/operations docs, and source-derived configuration checks.
- Update `tools/verify-mt5-baremetal-managed-ea.ps1`, its mutation runner, and narrowly required
  verifier fixtures/scripts.
- Add final `docs/agent-evidence/mt5-windows-credential-store/EVIDENCE.md`.

No SQL migration is planned because opaque references already live in PostgreSQL and credential
material remains outside PostgreSQL. If implementation proves a schema change is necessary, work
stops for a SPEC revision and new approval.

## 7. Dependencies, tools, generated files, and Git operations

- Runtime dependencies: no new third-party service; Windows `Advapi32.dll` Credential Management API.
- Go module: existing pinned `golang.org/x/sys v0.46.0`, promoted to direct use only.
- Existing tools: Go toolchain, Rust toolchain, Python, PowerShell, PostgreSQL disposable test path,
  repository changed-line coverage and mutation scripts.
- Generated files: ignored reports only under `.artifacts/mt5-windows-credential-store` and the
  existing managed-MT5 artifact directory; no secret material in reports.
- Git: preserve unrelated work; inspect status before every checkpoint; no commit, push, branch
  rewrite, reset, production deploy, or remote mutation under this Revision 1 approval.

## 8. RED -> GREEN -> REFACTOR sequence

1. Record the exact pre-change baseline and any environmental blocker.
2. Add provider-neutral input/encoding tests and Windows API fake tests; run and observe each new
   behaviour fail before implementation.
3. Add Windows real-smoke and unsupported-platform tests; observe RED.
4. Implement the minimum provider-neutral store and Win32 adapter; run focused then full Go tests.
5. Freeze assertions; refactor names/wiring away from Vault; rerun after each refactor.
6. Add config/capability tests showing no Vault values and legacy-variable rejection; observe RED,
   then update config/API wiring.
7. Run existing connect/rotate/grant/remove tests unchanged first; rename structural identifiers in
   a separate test-only refactor only where required, without changing assertions.
8. Update docs/verifiers and prove every new home-grown gate with a known-bad negative control.
9. Run the one-command fresh gauntlet and write EVIDENCE from that run only.

## 9. Required gauntlet

One persisted PowerShell entry point must fail closed and produce the final fresh report. It must
include:

1. `gofmt` check, `go vet ./...`, `go test ./...`, focused store/execution/config tests, and Windows
   real-smoke with nonzero executed counts.
2. `go test -race` for the credential and execution packages. A compiler/Application Control/CGO
   blocker is not a pass and blocks completion unless the user explicitly accepts it after seeing
   the exact failure.
3. Linux cross-build/compile gate for the non-Windows provider and the repository's Windows CI
   contract test.
4. Changed-line coverage: 100% of executable changed Go lines, fail-closed, plus a known-bad
   uncovered-line negative control.
5. Property tests using standard-library `testing/quick`: at least 10,000 valid round-trips and
   hostile/boundary cases for references, target mapping, encoding, and length limits.
6. Mutation: existing managed-MT5 mutants remain killed, plus at least five new executed mutants
   covering target mapping, size bound, not-found deletion, capability gating, and buffer cleanup.
   The mutation self-test must prove a mutant actually ran.
7. Existing Rust workspace fmt/check/clippy/tests and managed-agent serial tests, because one-time
   grant and execution boundaries must not drift.
8. Existing Python managed/VM regressions, disposable PostgreSQL/migration checks, docs verifier,
   PowerShell parse checks, and frontend type/lint/trade tests for capability compatibility.
9. Real Windows Credential Manager disposable create/read/delete/absence smoke, repeated once to
   detect leaked state; enumerate only the test prefix for cleanup assertion.
10. Secret and capability audit: diff scan, no plaintext fixtures, no Vault network/API imports,
    no legacy active `MT5_VAULT_*` config, no unexpected new network/filesystem/subprocess access,
    and `git diff --check`.
11. Adversarial pass: malformed blobs, maximum sizes, Unicode/control characters, concurrent
    references, injected Win32 errors, crash/retry ordering, stale Vault-only reference, and a
    changed Windows identity simulation through the injected boundary.

Independent agent verification is **not authorized/performed** in Revision 1. The final EVIDENCE
must declare that downgrade. A later explicit user request may authorize the repository's Tier 3
independent-verifier protocol.

## 10. Completion and stop rules

- Any failing gauntlet layer blocks completion, EVIDENCE success, commit, and push.
- Any need for a SQL migration, plaintext/export path, additional external dependency, frontend
  redesign, production mutation, real broker credential, or relaxation of an invariant stops work
  for a revised SPEC and fresh approval.
- Completion means implementation and docs exist in the worktree, the final fresh gauntlet passes,
  and EVIDENCE maps every scenario/invariant to exact results. It does not mean deployed or
  production-active.

## 11. Approval record (append-only)

- Approved by the user on 2026-08-24 with the exact token:
  `Duyệt SPEC Revision 1 bỏ Vault bằng Windows Credential Manager`.
- Effective status after this record: **APPROVED FOR IMPLEMENTATION**.
- Authorization remains limited by Sections 2, 6, 7, 9, and 10; in particular, no commit, push,
  production deployment, real credential use, or live broker activity is authorized.
