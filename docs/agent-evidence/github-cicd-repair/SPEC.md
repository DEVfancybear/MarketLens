# SPEC — GitHub CI/CD repair

- Tier: 2
- Diagnosis baseline:
  - GitHub Actions run `33138134525` for commit `062a610387e7f9ed5c933d14e81ca51ee86240a6` failed only in job `replay-client-boundary`, step `npm run test:trade`.
  - Ubuntu/Node 22 treated `.test-build/tests/trade` as a module path and failed with `MODULE_NOT_FOUND`; the backend, Rust, and backend artifact jobs passed.
- Setup plan:
  - Tools to install: none.
  - Git: remain on `master`; after the complete gauntlet is green, create one checkpoint commit and push it to `origin/master` to trigger a fresh GitHub Actions run. No force push, reset, rebase, or history rewrite.
  - Implementation/config files allowed to change: `frontend/package.json` only, unless RED evidence reveals a directly related defect requiring a visible SPEC revision and renewed approval.
  - Evidence files the gauntlet will add: `tools/verify-github-cicd-repair.ps1` (single rerunnable local entry point) and `docs/agent-evidence/github-cicd-repair/EVIDENCE.md`.
  - New dependencies: none.
  - External operations: read GitHub Actions logs/status; push the green checkpoint to `DEVfancybear/MarketLens`; monitor the resulting Actions run. No deployment and no production-host mutation.
  - Verification commands:
    - `powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\verify-github-cicd-repair.ps1`
    - The entry point runs, from `frontend`: `npm run test:trade`, `npm run check:replay-client-boundary`, `npm run test:replay`, `npm run typecheck`, `npm run lint`, and `npm run build`.
    - After push, all jobs in the fresh GitHub Actions `CI` run for the pushed commit must complete successfully.

## Scenarios

```gherkin
Feature: Cross-platform frontend CI test entry point
  Scenario: Trade tests run as individual test files on Ubuntu Node 22
    Given the TypeScript test build contains the compiled trade test files and the compiled Ky preload shim
    When npm run test:trade executes on the GitHub Ubuntu runner with Node 22
    Then Node discovers and executes every compiled *.test.js file under .test-build/tests/trade
    And the command exits 0 with no MODULE_NOT_FOUND error for the trade directory

  Scenario: Trade tests retain the Ky CommonJS preload bridge
    Given trade tests import Ky-dependent frontend modules
    When npm run test:trade starts the Node test process
    Then .test-build/tests/shims/ky.js is preloaded before the tests
    And the complete trade suite passes without changing application dependency behavior

  Scenario: The complete CI pipeline is green after the repair
    Given the repair commit is pushed to master
    When GitHub Actions runs the CI workflow for that exact commit
    Then replay-client-boundary, backend, execution-rust, and backend-artifact all conclude success
```

## Must NOT

- Do not skip, disable, or mark `test:trade` or any CI job as allowed to fail.
- Do not reduce the set of compiled trade `*.test.js` files executed.
- Do not remove the Ky preload shim or change production application behavior.
- Do not modify deployment logic, secrets, permissions, backend artifacts, or production services.
- Do not commit or push while any required local gauntlet layer is failing.
- Do not claim completion until a fresh GitHub Actions run for the pushed commit is green.

## Gauntlet

- Tests: trade, replay boundary, and replay suites.
- Types: frontend TypeScript typecheck.
- Lint: frontend ESLint.
- Build/real execution: production frontend build plus an actual GitHub-hosted Ubuntu/Node 22 CI run.
- Mutation/negative control: verify the recorded failing directory-form command produces the observed Linux `MODULE_NOT_FOUND`, and verify removing the preload causes the expected Ky-loading failure; both controls are restored before the final run.
- Changed-line coverage: scenario-to-command mapping for the package-script-only change; no application executable lines are added.
- Supply chain/capability diff: assert no dependency or lockfile change and no new network, subprocess, filesystem, secret, or permission capability.
- Suite health: run the repaired trade suite twice locally; GitHub performs the independent Ubuntu execution.

## Revisions

- v1: Initial SPEC from GitHub run `33138134525` and its failed job log.
