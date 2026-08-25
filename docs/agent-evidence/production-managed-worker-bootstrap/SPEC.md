# SPEC - production-managed-worker-bootstrap v1

- Status: proposed; implementation is forbidden until the user approves the exact token
  `APPROVE SPEC: production-managed-worker-bootstrap v1`.
- Tier: old-coder Tier 3 (production startup ordering and managed trading infrastructure).
- Repository: `C:\Users\duong\Downloads\tradingview`
- Source baseline: `0e42b86`
- Requested outcome: a first normal `run-backend-production.ps1` invocation may build the backend
  and managed-worker binary before it requires an installer-produced managed-worker receipt. It
  must still stop nonzero before migrations, process replacement, or runtime readiness until a
  valid installed-worker receipt is configured.

## Root cause and safety boundary

The canonical runner currently validates `EXECUTION_MT5_MANAGED_WORKER_RECEIPT_FILE` before its
source-build step. On a first production installation this creates a bootstrap loop: the explicit
worker installer needs the `mt5-vm-agent.exe` artifact produced by the build, but the runner refuses
to perform that build until the installer receipt already exists.

The receipt is attestation of an explicitly installed Scheduled Task, dedicated Windows identity,
ACL-protected files, pinned hashes, and terminal slots. The runner cannot safely synthesize that
attestation and must not invoke the installer implicitly.

## Executable acceptance scenarios

### B1 - first source build completes before the install-required gate

Given `EXECUTION_MT5_MANAGED_WORKER_RECEIPT_FILE` is unset or names a missing file and the normal
source-build path is selected, when the canonical runner executes, then pull/provision/build and
staged artifact verification may complete first. Only after the build has produced and verified the
API, gateway, and managed-worker artifacts does the runner exit nonzero with the stable sanitized
code `MANAGED_MT5_WORKER_INSTALL_REQUIRED_AFTER_BUILD` and actionable instructions to run the
explicit worker installer, configure its returned `receipt_path`, and rerun the canonical runner.

### B2 - the bootstrap stop has no runtime side effects

Given B1 reaches the install-required gate, the runner does not import the managed Python module,
run database migrations, provision or launch a market-data terminal, stop or replace running
services, start the gateway/API, start a Scheduled Task, launch `mt5-vm-agent.exe` or
`terminal64.exe`, perform local/public health checks, or print `Backend production is ready.`

### B3 - valid receipt preserves the full production path

Given an absolute, existing, regular, non-reparse receipt whose size is within the existing bounds,
when the source build and artifact checks succeed, then the runner normalizes and exports the
receipt path and continues through the existing managed Python, migration, restart, worker
readiness, API, and health gates without weakening their ordering.

### B4 - malformed receipt remains fail-closed

Given a relative, directory, reparse-point, unreadable, empty, or oversized configured receipt,
when the runner reaches the post-build receipt gate, then it exits nonzero with sanitized output
before every action forbidden by B2. It never creates, overwrites, repairs, or substitutes a
receipt.

### B5 - artifact/deploy mode remains fail-closed

Given `-SkipBuild` is selected by the documented deploy/recovery path, when the configured receipt
is missing or invalid, then the runner performs no source build and exits nonzero before managed
Python import, migrations, process replacement, or runtime startup. Its message must not falsely
claim that this invocation built artifacts.

### B6 - installer ownership remains explicit

Given any runner mode, the source contains no invocation of
`Install-MT5BareMetalWorker.ps1`, no receipt-generation fallback, no invented terminal-slot
configuration, and no direct managed agent or account-terminal launch. The one-time installer
continues to own Scheduled Task creation and the receipt.

### B7 - the first-install runbook is unambiguous

The example environment file and production documentation state the two-pass first-install flow:

1. run the canonical runner once to build artifacts and intentionally stop at the install-required
   gate;
2. invoke the existing worker installer explicitly with the required production identity, task,
   bootstrap-token file, and attested slot descriptors;
3. copy only the returned non-secret absolute `receipt_path` into
   `EXECUTION_MT5_MANAGED_WORKER_RECEIPT_FILE`;
4. rerun the canonical runner to perform migrations, restart, and health/readiness gates.

Documentation must not ask the operator to paste a broker password, admin token, bootstrap token,
or Windows credential into chat, logs, command arguments, or the receipt.

### B8 - verifier fails closed

The persisted gauntlet proves the build/receipt/runtime source ordering, the normal and `-SkipBuild`
branches, forbidden side-effect ordering, stable failure code, no automatic installer invocation,
and no production-ready banner on the missing-receipt path. An execution-proven mutant that moves
receipt validation back before build must be killed. Parser errors, skipped checks, surviving
mutants, or missing fixtures fail the gauntlet.

## Failure model and catching layers

| Failure mode | Harm | Required detector |
| --- | --- | --- |
| Receipt is still checked before build | first install remains impossible | runner source-order contract and killed ordering mutant |
| Runner exits zero after building without receipt | automation can misclassify an incomplete deployment as production-ready | nonzero bootstrap negative control and forbidden-ready-output check |
| Runtime/migration begins before receipt validation | partial deployment or service interruption without an attested worker | ordering assertions and forbidden-side-effect matrix |
| Runner creates or installs its own receipt/task | attestation and dedicated-identity boundaries are bypassed | capability/source scan and installer-invocation negative control |
| Relative/link/oversized receipt becomes accepted | path confusion or tampered installation evidence | retained receipt validation scenarios |
| `-SkipBuild` silently bypasses the gate | CI artifact deployment can start without worker attestation | explicit `-SkipBuild` scenario |
| Build failure is misreported as install-required | real compiler/artifact failure is hidden | gate ordered only after successful build/artifact verification |
| Error output leaks receipt contents or secrets | production credential disclosure | sanitized-output and diff secret scan |
| Documentation implies receipt is generated by build | operator cannot complete the secure install | documentation contract test/review |

## Negative constraints

- MUST NOT auto-generate a receipt, invoke the worker installer, create/change a Scheduled Task,
  create a Windows credential, invent terminal slots, or log into a broker.
- MUST NOT convert a missing/invalid receipt into a successful runner exit or print a production
  ready banner.
- MUST NOT weaken existing absolute-path, regular-file, reparse-point, readability, or size checks.
- MUST NOT move the receipt gate after Python import, migrations, terminal provisioning, process
  stop/replacement, gateway/API startup, worker readiness, or health checks.
- MUST NOT change the documented division between `run-backend-production.ps1` and
  `tools\deploy-backend.ps1`.
- MUST NOT expose receipt contents, credentials, tokens, HMAC material, or sensitive request data.
- MUST NOT modify the PostgreSQL credential-store Revision 9 flow or any unrelated dirty path.
- MUST NOT deploy, install/start a real worker, mutate production credentials, commit, or push
  under this SPEC without a separate explicit user request after the gauntlet passes.

## Planned implementation surface

Adding an implementation path requires an append-only SPEC revision and new approval.

- `run-backend-production.ps1`
- `backend/.env.example`
- `tools/verify-production-managed-mt5-readiness.ps1`
- `docs/MT5_BAREMETAL_MANAGED_EA_RUNBOOK.md`
- `docs/OPERATIONS.md`
- `docs/agent-evidence/production-managed-worker-bootstrap/SPEC.md`
- `docs/agent-evidence/production-managed-worker-bootstrap/EVIDENCE.md` (only after a fresh passing
  final gauntlet)

## RED -> GREEN -> REFACTOR order

1. Extend the readiness verifier with frozen assertions for B1-B8 and an ordering mutant.
2. Run the focused readiness layer against the current runner and retain the expected RED result
   showing that receipt validation precedes build.
3. Make the smallest runner change that defers receipt validation/export until after successful
   build and artifact verification but before all runtime side effects.
4. Update the first-install documentation and example environment comment.
5. Run the focused tests GREEN, then refactor only while assertions remain unchanged.
6. Run one fresh full gauntlet and write EVIDENCE from that exact run.

## Gauntlet and evidence plan

The single rerunnable entry point remains:

```powershell
.\tools\verify-production-managed-mt5-readiness.ps1
```

The final fresh run must include:

- Windows PowerShell 5.1 parser checks for every touched PowerShell file;
- focused deterministic source/fixture scenarios for B1-B8, including both build modes and every
  forbidden runtime marker;
- an execution-proven ordering mutant that restores the pre-fix receipt-before-build defect, plus
  all existing readiness mutants and negative controls;
- the existing realistic readiness fixture execution against fake scheduler/registry boundaries;
- the verifier's existing frontend test/type/lint/build, shuffled Go test/vet, and locked Rust
  workspace layers because this change affects the shared production runner contract;
- changed-line behavior mapping for the runner and documentation contracts; host orchestration
  that cannot be instrumented is mapped to deterministic contract tests and disclosed rather than
  assigned invented coverage;
- dependency diff, capability review, secret scan, source-state recording, and unrelated-dirty-path
  preservation;
- a clear statement that real production compilation, Scheduled Task installation, Credential
  Manager access under the production identity, broker login, and deployment remain unverified
  unless they are actually performed separately on the production host.

A failing or incomplete gauntlet blocks completion, commit, and push unless the user explicitly
accepts the reported blocker.

## Dependencies, tools, generated files, and git operations

- New dependencies: none.
- Existing tools only: PowerShell 5.1, Git, Node/npm, Go, Cargo/Rust, and repository scripts.
- Network during implementation verification: no new external service; local deterministic fakes
  remain the only worker/scheduler/registry boundary.
- Generated/task-owned artifacts: verifier logs/reports only under the task evidence directory and
  the final EVIDENCE file after a passing gauntlet.
- Host mutation during implementation/verification: none. No real task install/start, terminal
  launch, broker login, order, production migration, process restart, or deployment.
- Git: read-only status/diff/source-state checks only. No stage, commit, pull, rebase, push, tag, or
  force operation is authorized by this SPEC.
- Working-tree rule: preserve every unrelated user/concurrent change byte-for-byte and never stage
  it as task work.

## Approval

Implementation may begin only after the user sends exactly:

`APPROVE SPEC: production-managed-worker-bootstrap v1`

## Approval record

- Approved exactly by the user on 2026-08-25 with
  `APPROVE SPEC: production-managed-worker-bootstrap v1`.
- Approved SPEC SHA-256 before this append-only approval record:
  `95221BE59AD3CAADBBA42AB4649652CCE6A00EBADC9176A37BD31880611723FE`.
