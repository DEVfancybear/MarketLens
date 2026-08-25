# Evidence Report - production-managed-worker-autoinstall v1 (Tier 3)

- Status: **PASS_WITH_DECLARED_UNVERIFIED**.
- Spec approval: obtained exactly from the user as
  `APPROVE SPEC: production-managed-worker-autoinstall v1`.
- Delivery authorization: after the lightweight gauntlet passed, the user separately requested a
  task-owned commit and push so they can run the canonical one-command build on the server. This
  does not authorize deployment or production execution from this workstation.
- Baseline: `8dcc38f4d70161042853768abbbb6403ae979633`.
- Final fresh entry point: `.\tools\verify-production-managed-worker-autoinstall.ps1`.
- Final run: 2026-08-25T08:48:07.1354751Z through 2026-08-25T08:48:13.1156941Z.
- Executable source state before this EVIDENCE file was written: task tree SHA-256
  `4c65b211d4095a829d41a06f3ccbb651fc3bc1dac931d2430811312818c24629`.
- Machine-readable summary:
  `.artifacts/production-managed-worker-autoinstall/summary.json`.
- Independent verification: not performed.

## Outcome

On a prepared source-build host, a missing receipt now causes the canonical runner to invoke the
fail-closed auto-install helper after artifact verification. The helper consumes the protected
install input, derives trusted repository artifact paths/hashes, dry-runs and executes the existing
installer, validates or adopts the exact receipt, atomically persists only the receipt setting in
`backend\.env`, and returns it so the same runner invocation continues. `-SkipBuild` remains
non-mutating and requires an existing receipt.

This does not invent or provision the dedicated Windows identity, bootstrap-token file, terminal
slots, broker credential, or attestation. Those prepared-host inputs remain prerequisites.

## SPEC to test mapping

| Scenario | Executable evidence | Status |
| --- | --- | --- |
| A1 one invocation installs and continues | runner source-order contract; core dry-run + execute fixture | PASS |
| A2 valid receipt stays idempotent | existing receipt branch remains before helper; existing readiness contracts | PASS |
| A3 completed install is adopted | adoption fixture proves installer call count remains zero | PASS |
| A4 invalid/missing input fails closed | strict path/schema, duplicate/unknown JSON, slot-count and protected-input boundaries | PASS for portable fixtures; real host ACL UNVERIFIED |
| A5 installer failure stops before persistence | invalid execution fixture requires exact failure and zero persistence calls | PASS |
| A6 exact atomic `.env` persistence | byte-preservation, duplicate-key rejection, hash-preservation, ACL/replace postconditions | PASS for temporary NTFS fixture |
| A7 `-SkipBuild` unchanged | source contract and killed `skipbuild-autoinstall-enabled` mutant | PASS |
| A8 no credential/attestation invention | capability/secret audit; runner has no direct installer, identity creation, or agent launch | PASS |
| A9 verifier fails closed | parser, existing readiness suite, five execution-proven mutants with byte restoration | PASS |

## Final lightweight gauntlet

| Layer | Result |
| --- | --- |
| Auto-install contract tests | 8 passed, 0 failed |
| Existing managed-worker readiness | 19 passed, 0 failed |
| PowerShell parser | 4 files parsed, 0 errors |
| Mutation | 5/5 killed and exact bytes restored |
| Diff check | task paths clean |
| Capability/secret audit | no direct installer/identity/agent capability in runner; no high-confidence secret assignment |

Killed mutants:

1. installer invocation before artifact verification;
2. auto-install enabled under `-SkipBuild`;
3. invalid installer execution accepted;
4. receipt persisted before validation;
5. duplicate `.env` receipt key accepted.

## RED, corrections, and honest notes

The baseline RED run reported three expected failures: missing helper, missing runner integration,
and missing one-command documentation. Assertions were written before implementation.

During GREEN and gauntlet work:

- the initial source-order test used the helper filename declaration instead of its invocation; it
  was corrected to assert the exact invocation marker, which made the ordering check narrower and
  executable rather than weaker;
- Windows PowerShell native stderr promotion initially obscured the duplicate-JSON stable code;
  the checker now captures the Python standard-library parser exit without exposing its stderr;
- legacy readiness documentation assertions were updated from the obsolete two-pass contract to
  the approved protected-input/same-invocation contract;
- the first mutation run stopped because one mutant assumed CRLF while the source used LF; its
  exact byte target was corrected and the final fresh run killed all five mutants;
- review found that `$LASTEXITCODE` is stale after an in-process PowerShell script call; the runner
  no longer reads it and the contract suite now rejects that regression.

No test assertion was weakened to accept broken product behavior. No dependency was added.

## Declared unverified production boundaries

- A real backend build and real canonical production-runner execution were not run.
- Real protected-input ACLs, worker identity translation, bootstrap-token ACL, Scheduled Task
  creation/adoption, and `.env` ACL preservation on the production host were not run.
- Worker heartbeat/lease, account terminal, broker onboarding, deployment, and activation were not
  run.
- Frontend, Go, Rust, coverage, race, and heavy full-suite layers were intentionally not run under
  the approved lightweight resource ceiling.
- No commit or push occurred during the gauntlet; task-owned commit/push was authorized separately
  after verification.

The correct claim is portable local `PASS_WITH_DECLARED_UNVERIFIED`, not production-active.
