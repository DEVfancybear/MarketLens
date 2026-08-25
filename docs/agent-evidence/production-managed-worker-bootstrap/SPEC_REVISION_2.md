# SPEC Revision 2 - production-managed-worker-bootstrap v2 LIGHTWEIGHT

- Status: proposed; implementation and verification under this revision are forbidden until the
  user approves the exact token
  `APPROVE SPEC: production-managed-worker-bootstrap v2 LIGHTWEIGHT`.
- Tier: old-coder Tier 3 (production startup ordering and managed trading infrastructure).
- Repository: `C:\Users\duong\Downloads\tradingview`.
- Source baseline: `0e42b86` plus the preserved task-owned dirty implementation produced under the
  approved v1 SPEC.
- Revision reason: the v1 full gauntlet completed its parser, checker controls, portable fixture,
  10/10 mutation, frontend tests, typecheck, lint, and frontend production build layers, but the
  workstation became unresponsive before the later Go/Rust layers and had to be restarted. The
  user explicitly requires the resumed verification to remain lightweight.

This append-only revision supersedes only v1's final-gauntlet and evidence plan. Acceptance
behaviors B1-B8, the failure model, negative constraints, implementation boundaries, no-production
side-effect rule, and no-commit/no-push rule remain unchanged.

## Lightweight completion contract

### L1 - one bounded entry point

Add `tools/verify-production-managed-worker-bootstrap.ps1` as the single rerunnable final entry
point. It runs one child process at a time, has finite per-process timeouts, fails closed, writes
fresh logs and a machine-readable summary only below
`.artifacts/production-managed-worker-bootstrap`, and returns nonzero if any selected layer fails.

### L2 - focused behavioral coverage

The entry point invokes the existing
`tools/verify-production-managed-mt5-readiness.ps1 -ReadinessTestsOnly` mode and requires its exact
success marker. That focused suite must cover the runner build/receipt/runtime ordering, strict
receipt resolver cases, source/deploy branch failure codes, forbidden installer/direct-agent
capabilities, and the two-pass operator documentation contract.

### L3 - execution-proven ordering mutant

The entry point temporarily inserts the old receipt-before-build defect immediately before
`$replaceArtifacts = $false`, proves the runner bytes and SHA-256 changed, observes the focused
suite fail through `READINESS_TESTS_FAILED=`, restores the original bytes in `finally`, and proves
the exact original SHA-256 was restored. Zero or multiple mutation target matches, a timeout, an
unexpected failure path, a surviving mutant, or a restore mismatch fails the layer.

### L4 - cheap structural and audit layers

The entry point also performs:

- Windows PowerShell 5.1 parser checks for the runner, the existing readiness verifier, and the
  new lightweight entry point;
- `git diff --check` over only the approved task paths;
- confirmation that no dependency manifest changed from baseline;
- a fail-closed scan of task additions for high-confidence secret assignments;
- a capability check that the runner does not invoke the worker installer, synthesize the receipt,
  launch the agent directly, or start a Scheduled Task;
- task-owned source-state hashing and a JSON summary containing exact layer outcomes.

### L5 - resource ceiling and forbidden commands

The final lightweight run MUST NOT invoke any of the following:

- `run-backend-production.ps1`, `build-production.ps1`, or `deploy-backend.ps1`;
- `npm run build`, any frontend full suite, or parallel frontend workers;
- `go test ./...`, `go vet ./...`, coverage, race, or a Go build;
- `cargo test`, `cargo check`, `cargo clippy`, `cargo build`, or Rust coverage;
- a real database, migration, Scheduled Task, worker, terminal, broker login, health endpoint,
  production process, deploy, commit, or push.

The focused suite may create and remove only its uniquely named temporary receipt fixtures. The
lightweight wrapper may temporarily mutate only `run-backend-production.ps1` and must byte-restore
it even when the child process fails or times out. It must not run child processes concurrently.

### L6 - honest evidence downgrade

The final EVIDENCE status may be `PASS_WITH_DECLARED_UNVERIFIED` only if every lightweight layer
passes. It must state that the interrupted full-run logs are historical diagnostics, not a final
fresh gauntlet. Full frontend, Go, Rust, coverage, complete mutation, real build, and production
execution remain unverified in the final source state. The result must not be described as
production-active or equivalent to the v1 full-gauntlet requirement.

### L7 - fail without escalation

If a focused layer fails, stop and report the exact failure. Do not automatically fall back to a
full build, full test suite, repeated retry loop, dependency installation, production execution, or
host mutation.

## RED -> GREEN -> REFACTOR

1. Add the lightweight wrapper with its fail-closed assertions and resource guards.
2. Prove its checker can fail with the receipt-before-build mutant; a failure outside the expected
   readiness checker does not count as a kill.
3. Run the unmutated focused contract suite and require its success marker.
4. If the preserved product implementation fails an approved behavior, change only the existing v1
   task surface, rerun the focused entry point, and do not weaken assertions.
5. Refactor only with assertions frozen, then run one final fresh lightweight entry point.
6. Write EVIDENCE from that exact fresh run.

## Planned files and generated artifacts

- Preserve the approved v1 task files:
  - `run-backend-production.ps1`
  - `backend/.env.example`
  - `tools/verify-production-managed-mt5-readiness.ps1`
  - `docs/MT5_BAREMETAL_MANAGED_EA_RUNBOOK.md`
  - `docs/OPERATIONS.md`
- Add:
  - `tools/verify-production-managed-worker-bootstrap.ps1`
  - `docs/agent-evidence/production-managed-worker-bootstrap/SPEC_REVISION_2.md`
  - `docs/agent-evidence/production-managed-worker-bootstrap/EVIDENCE.md`
- Generated and ignored:
  - `.artifacts/production-managed-worker-bootstrap/**`
- New dependencies: none.
- Network access: none.
- Git operations: status/diff/hash checks only; no stage, commit, pull, rebase, push, tag, reset, or
  checkout.

## Final command after approval

```powershell
.\tools\verify-production-managed-worker-bootstrap.ps1
```

## Approval

Proceed only after the user sends exactly:

`APPROVE SPEC: production-managed-worker-bootstrap v2 LIGHTWEIGHT`

## Approval record

- Approved exactly by the user on 2026-08-25 with
  `APPROVE SPEC: production-managed-worker-bootstrap v2 LIGHTWEIGHT`.
- Approved SPEC SHA-256 before this append-only approval record:
  `B4AFE3BAE7806774514DBB277CE8F600B5252B2B1DF3E65991108ECBB924097F`.
