# SPEC — Repair the MT5 commit CI build failures

- Tier: old-coder Tier 2 (CI regression fix in TypeScript test configuration and a
  cross-platform Rust test fixture; no production runtime behavior change).
- Starting source state: `fd28f7d4780f3fa16cdc10b849967125e77266a6` on local `master`, equal to
  `origin/master` (`git rev-list --left-right --count HEAD...origin/master` returned `0 0`).
- Affected original commit: `9ec4ba518f184e01c93ea8147289a3207a8d3415`,
  `feat(mt5): add managed worker and phase gate evidence`.
- Failed GitHub run: `32432519781`; the same failures recur in current run `32441641679`.
- Spec approval: obtained from the user on 2026-08-21 with the exact response `Duyệt SPEC`.

## Observed RED evidence

1. GitHub job `replay-client-boundary` fails in `npm run check:replay-client-boundary` with
   `TS5108: Option 'moduleResolution=node10' has been removed` at `frontend/tsconfig.test.json:5`.
   The same command was observed failing locally with exit 1 and the same diagnostic.
2. After probing the intended `moduleResolution=bundler` setting without editing source,
   `npx tsc --noEmit` exposes two additional errors in
   `frontend/tests/api/mt5VmPhase2Operational.spec.ts`: `commandId` and `leaseGeneration` remain
   `unknown` after runtime response checks.
3. GitHub Ubuntu job `execution-rust` fails
   `cargo test --locked --workspace --all-targets`: test
   `managed_worker_loopback_test_mode_still_requires_a_real_token_file` supplies a Windows-only
   `C:\...` path, so Linux correctly classifies it as a relative/invalid path and returns
   `MANAGED_WORKER_TOKEN_PATH_INVALID` before the test's intended missing-file assertion.
4. GitHub `backend` passes both `go test ./...` and `go vet ./...`. Local executions also passed.
5. Local Windows execution of the Rust CLI integration binary is blocked by host Application
   Control (`Os code 4551`); this is an environment gate, not the GitHub Linux failure. The final
   Linux all-target result must therefore come from the GitHub hosted runner.

## Executable acceptance scenarios

### Scenario 1 — TypeScript test-build uses the supported resolver

Given the locked TypeScript 6 compatibility package and the existing CommonJS test emit,
when `npm run check:replay-client-boundary` runs,
then `tsconfig.test.json` uses `moduleResolution: "bundler"`, compilation exits 0, and the replay
client boundary test passes without downgrading TypeScript or changing the dependency lockfile.

### Scenario 2 — Operational API command JSON is type-safe after runtime validation

Given a poll response whose command is initially untrusted JSON,
when the operational harness accepts a single `provision_account` command,
then it explicitly validates `kind`, `accountId`, `commandId`, `leaseGeneration`, and
`credentialGrant` before returning a typed command; `npm run typecheck` exits 0.

Given any of those required fields has the wrong runtime type or value,
when the validator runs,
then a Playwright assertion fails rather than coercing or blindly casting the value.

### Scenario 3 — The Rust missing-token test is platform-native

Given the managed-worker loopback CLI test runs on Windows or Linux,
when it constructs the deliberately missing bootstrap token path,
then that path is native, absolute, confirmed absent without deleting anything, and the process
reaches the intended `MANAGED_WORKER_TOKEN_FILE_INVALID` result.

The production `validate_token_path` function, its parent-component rejection, and its requirement
for a real regular file remain unchanged.

### Scenario 4 — All CI gates remain green

Given the final fix commit is pushed to `origin/master`,
when GitHub Actions runs `.github/workflows/ci.yml`,
then `replay-client-boundary`, `backend`, `execution-rust`, and the dependent Windows
`backend-artifact` job all complete successfully, and the artifact upload does not report missing
files.

## Negative constraints

- Do not weaken or remove the Rust token-path, transport, secret-redaction, or missing-file checks.
- Do not skip, ignore, delete, or filter the failing Rust test.
- Do not exclude the Playwright/API spec from TypeScript checking, suppress diagnostics, add unsafe
  casts without runtime checks, downgrade TypeScript, or pin an older GitHub runner.
- Do not change application/runtime behavior, Go APIs, Rust production code, workflows, dependency
  manifests, or lockfiles unless a new demonstrated blocker requires a visible SPEC revision and
  renewed approval.
- Do not install a WSL distribution, Docker, global package, or new dependency.
- Do not commit generated build output, caches, credentials, tokens, or unrelated files.
- Do not force-push, rebase, reset, checkout, restore, or proceed if `origin/master` changes from
  the approved starting state without a new SPEC revision.
- A failing local applicable layer or failing GitHub job blocks completion.

## Planned files, dependencies, tools, and generated output

Planned edits are limited to:

- `frontend/tsconfig.test.json`
- `frontend/tests/api/mt5VmPhase2Operational.spec.ts`
- `backend/execution/crates/mt5-vm-agent/tests/managed_worker_cli.rs`
- `tools/verify-ci-build-fix.ps1` (single rerunnable local gauntlet entry point)
- `docs/agent-evidence/ci-build-fix/SPEC.md`
- `docs/agent-evidence/ci-build-fix/EVIDENCE.md`

New dependencies: none. Existing Node/npm, Go, Rust/Cargo, PowerShell, Git, and authenticated GitHub
CLI will be used. Existing commands may regenerate ignored `.test-build/`, `.next/`, Cargo
`target/`, npm cache, and Go caches; none will be staged. No database, Vault, MT5 terminal, broker
account, deploy, migration, production command, or secret is used.

## RED → GREEN → REFACTOR plan

1. Preserve the observed frontend and GitHub RED outputs above.
2. GREEN A: change only `tsconfig.test.json` from the removed `node` resolver back to `bundler`,
   rerun the focused frontend command, and retain the resulting typed-JSON RED until the harness
   is fixed separately.
3. GREEN B: add an assertion-based `ProvisionCommand` runtime narrowing helper without weakening
   existing assertions; rerun focused compile/test and full typecheck.
4. GREEN C: change only the Rust test fixture to construct a platform-native absolute nonexistent
   path; keep the expected stable error and production validation unchanged.
5. REFACTOR only under green assertions, then run the complete gauntlet.

## Gauntlet and delivery plan

`tools/verify-ci-build-fix.ps1` will fail closed and run:

1. Frontend locked install and exact CI sequence:
   `npm ci`, `npm run check:replay-client-boundary`, `npm run test:replay`,
   `npm run test:trade`, `npm run typecheck`, and `npm run build`.
2. Go CI sequence: `go test ./...` and `go vet ./...`.
3. Rust format and lint: `cargo fmt --all -- --check` and
   `cargo clippy --locked --workspace --all-targets -- -D warnings`.
4. On non-Windows, the exact Rust CI command
   `cargo test --locked --workspace --all-targets`. On this Windows host, run all workspace targets
   except the Application-Control-blocked agent executable plus the agent library,
   `managed_commands`, and `managed_control` tests explicitly; record the CLI integration layer as
   awaiting the mandatory GitHub Ubuntu run rather than falsely passing it locally.
5. `git diff --check` and an exact intended-file allowlist.

Coverage, property generation, and mutation are not added: the changed surfaces are existing
test/configuration harnesses, the three regressions are already executable negative controls, and
no production implementation line changes. Supply-chain audit is not applicable because no
dependency or lockfile changes.

After the local gauntlet passes:

1. Fetch `origin/master` and require it still equals
   `fd28f7d4780f3fa16cdc10b849967125e77266a6`.
2. Stage only the six planned paths, require cached diff/whitespace/allowlist checks to pass, and
   commit once with `fix(ci): restore cross-platform build gates`.
3. Push normally with `git push origin HEAD:master`.
4. Monitor the new GitHub Actions run to terminal state. Completion requires all four jobs to
   succeed, local/remote SHA equality, and a clean working tree. Do not rerun or weaken failed jobs;
   diagnose any new failure under an appended SPEC revision.

## Approval requested

Approval authorizes exactly the six-file implementation, existing-tool/cache use, local gauntlet,
one commit, normal push to `origin/master`, and read-only GitHub Actions monitoring described above.

## Approval record

- Approved by the user on 2026-08-21 with the exact response: `Duyệt SPEC`.
- No acceptance scenario, negative constraint, file scope, command, commit message, branch, remote,
  or delivery operation changed after approval.

## Execution deviation accepted for delivery

- The final Windows run demonstrated that Application Control also blocks Cargo's generated
  `aws-lc-sys` clippy build script with OS error 4551. The rerunnable entry point therefore records
  Windows clippy as unverified and makes the exact Ubuntu clippy plus all-targets jobs mandatory on
  GitHub; it does not suppress either command on CI.
- During the final allowlist check, the unrelated untracked file
  `docs/agent-evidence/mt5-vm-local-prerequisites/SPEC.md` appeared. It is excluded from this change
  and must not be modified, deleted, or staged. The intended cached commit allowlist remains the six
  files declared above.
- After both limitations were disclosed, the user explicitly directed on 2026-08-21:
  `bạn commit and push lên github luôn rồi check build cicd thực tế`. This is recorded as acceptance
  to proceed with the isolated commit and to use the actual GitHub Ubuntu result as the mandatory
  Rust lint/runtime gate.
