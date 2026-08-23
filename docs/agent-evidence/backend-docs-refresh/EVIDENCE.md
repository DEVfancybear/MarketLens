# EVIDENCE - Backend documentation refresh

## Outcome

- The approved Tier 3 Revision 1 scope is complete in the verified worktree.
- All eight canonical `backend/docs` documents, package READMEs, and active cross-package backend
  runbooks were reconciled with the managed-MT5 implementation, migration `0042`, registered Go
  routes, Rust listener boundaries, environment examples, and production scripts.
- The fresh combined gauntlet finished `PASS_WITH_ALLOWED_UNVERIFIED`: 44 layers passed, no layer
  failed, and two SPEC-authorized environmental/live layers were not executed.
- No deploy, production restart, real-account login, broker trade, or external service mutation was
  performed.

## Approved source state and discovery

- Base Git HEAD: `5a61554c2255d18e0162c6dd9b71e8244ec6eb4a`.
- Fresh-run task tree SHA-256:
  `793ed4bcbd5c8f38159e4633bf628ce67c885c833d8777c71e3a28371f567a48` (96 task files).
- Fresh run: 2026-08-23 15:09:16Z through 15:20:14Z on Windows.
- `codebase-memory-mcp` was unavailable in this session. Discovery used the repository-mandated
  fallback: `docs/CODEBASE_MEMORY.md`, current source, migrations, route registrars, configuration,
  tests, and production scripts. No graph result is claimed.
- The immutable commit SHA is recorded in the publication handoff after commit; generated
  `.artifacts/**` reports are intentionally excluded from version control.

## RED -> GREEN evidence

The documentation checker was written before the documentation rewrite. Its first genuine run
failed 173 of 5,170 checks, including missing registered routes, configuration variables, migration
head `0042`, and current connector/verifier boundaries. Its embedded known-bad fixture also exited
nonzero. No assertion was weakened after that RED run.

The final checker run was orchestrated as layer 42 of the combined gauntlet:

```text
Backend documentation gauntlet
  negative control: rejected known-bad input (exit 1)
Backend documentation gauntlet PASSED: 2546 checks; 149 Go routes; 75 environment keys; migration head 0042.
```

## Acceptance map

| SPEC criterion | Fresh evidence | Result |
|---|---|---|
| Runtime architecture | Required architecture markers and forbidden-current legacy terms in the docs gate; current Go/Rust/Python managed suites | PASS |
| Production commands | Exact runner/deploy assertions plus deploy self-test and capability audit | PASS |
| API reference | 149 registered Go routes extracted from current registrars and present in the catalog; Rust listener boundaries checked | PASS |
| Configuration reference | All 75 keys from `backend/.env.example` documented; source config tests passed | PASS |
| Database reference | Dynamic migration head `0042`; positive disposable PostgreSQL gate passed and known-bad negative control failed as required | PASS |
| Auth and security | Go/Rust security suites, mutation score 8/8, secret negative control and task-diff scan | PASS |
| Navigation/history | Active-document inventory and relative Markdown links checked; historical plans labeled rather than rewritten as current | PASS |
| Fail-closed rerunnable gate | Embedded bad fixture rejected; clean source produced the counted PASS above | PASS |

## Final gauntlet

Single rerunnable entry point:

```powershell
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `
  .\tools\verify-mt5-baremetal-managed-ea.ps1
```

Key results from the fresh report:

- Overall: `PASS_WITH_ALLOWED_UNVERIFIED`; failed layers: none.
- Go: format, vet, tests, module integrity, and changed-line coverage `200/200` passed.
- Rust: fmt, check, clippy, tests, agent tests, stress properties, locked supply chain, disposable
  database integration, and changed-line coverage `6897/6897` passed.
- Python: managed suite 54/54 and VM regression suite passed.
- Migration `0042`: positive disposable PostgreSQL test passed; negative control exited 1 as
  required.
- Mutation: 8/8 mutants killed.
- EA: MetaEditor compile and release attestation passed; published SHA-256
  `516D54DDDC1EC4651C4D3E90F66F45B705E1E9FED1062BB66CDE78F6AD2B86AC`.
- Frontend: typecheck, lint, and 83 trade tests passed; production dependency audit found zero
  vulnerabilities.
- Documentation: 2,546 checks, 149 routes, 75 environment keys, migration head `0042`.
- Hygiene/security: whitespace, secret scan, dependency-delta, and capability-diff audits passed.

## Allowed unverified layers and limitations

- `go-race`: not supported by this Windows host because the required CGO/C compiler path is not
  available. The approved SPEC explicitly allows this environmental limitation when recorded.
- `R15-9-live-demo`: not attempted because separate execution-time confirmation, secure Vault,
  interactive worker identity, and three disposable demo accounts were not supplied. No live broker
  or production claim is made.
- Independent-verifier rounds predated this final documentation state; no independent-verifier
  verdict is claimed for the final source tree.

## Negative constraints

- No dependency or package was added for this documentation work.
- No real secret value was written to docs or reports; placeholder and known-bad controls passed.
- Recovery switches are described only as recovery/deploy delegation, not normal operation.
- Generated reports, coverage objects, local PostgreSQL runtimes, and caches remain under ignored
  `.artifacts/**` paths and are not commit candidates.
