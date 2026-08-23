# Handoff

Verified on 2026-08-24.

## Session startup

1. Work from the repository root and inspect `git status` before changing anything.
2. Follow `AGENTS.md`: select the codebase-memory project whose `root_path` exactly matches this
   worktree, require `index_status=ready`, query the graph, then read current source.
3. Read [Current state](CURRENT_STATE.md), [Known issues](KNOWN_ISSUES.md), and the owning package
   documentation for the task.
4. Check the latest GitHub Actions run for `master` before assuming local green means delivered.

Canonical repository: `https://github.com/DEVfancybear/MarketLens`.

## Verification baselines

Frontend CI baseline from `frontend/`:

```powershell
npm ci
npm run check:replay-client-boundary
npm run test:replay
npm run test:trade
npm run typecheck
npm run build
```

Go backend baseline from `backend/`:

```powershell
go test ./...
go vet ./...
```

Rust baseline from `backend/execution/`:

```powershell
cargo fmt --all -- --check
cargo test --locked --workspace --all-targets
```

Use narrower commands during RED/GREEN, but finish with the owning full baseline. Do not retry a
flaky test as the fix; make the race deterministic and retain a regression test.

## Production entrypoints

- Build/pull/migrate/restart from source: `./run-backend-production.ps1` with no switches in the
  normal case.
- Deploy the checksummed GitHub Actions artifact matching `HEAD`: `./tools/deploy-backend.ps1`.
- Do not call lower-level binaries or skip pull/build/migrations/public health unless the documented
  recovery path or the user explicitly requires it.

See [Operations](OPERATIONS.md), [backend production build](../backend/docs/PRODUCTION_BUILD.md),
and [bare-metal managed MT5 runbook](MT5_BAREMETAL_MANAGED_EA_RUNBOOK.md).

## Execution safety invariants

- The browser never receives reusable broker/MT5 secrets.
- Go/PostgreSQL owns durable account, command, event, audit, and authorization state.
- Rust owns execution/risk/routing decisions; the managed worker/EA path is generation- and
  identity-fenced.
- MT5 terminal/account slots are isolated; a successful send is not proof of fill.
- Production activation stops on stale identity/generation, secret exposure, duplicate controller,
  unknown cleanup state, reconciliation failure, or a failing gauntlet.

## Current continuation point

The repository implementation is ahead of external production evidence. The next operator should:

1. confirm GitHub CI is green for the delivered commit;
2. deploy/build using the correct production entrypoint;
3. execute the managed MT5 activation gates with disposable Demo accounts;
4. record exact commit, toolchain, environment, health, and reconciliation evidence;
5. update all five maintained state pages together if the production boundary changes.

See [Next tasks](NEXT_TASKS.md) for priorities and [Current progress](CURRENT_PROGRESS.md) for the
latest completed boundaries.
