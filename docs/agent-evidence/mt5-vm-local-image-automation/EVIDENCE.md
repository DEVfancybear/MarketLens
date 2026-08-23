# EVIDENCE — MT5 local image automation and broker-neutral enrollment

## Outcome

- SPEC Revision 12, Revision 13, and Revision 14 were explicitly approved on 2026-08-21.
- The immediate FTMO/Exness objective is complete on the disposable validation host:
  broker-neutral official UI enrollment passed for the clean signed Exness terminal, its
  settings/bootstrap probe passed, and the final FTMO/Exness single/coexisting read-only matrix
  passed.
- The clean slot passes full installed-slot attestation: signed terminal, terminal hash, refreshed
  server catalog/hash, terminal license/hash, and exact data-profile mapping.
- Local image/clone policy cores and their fail-closed boundaries are implemented and covered.
  A real generalized Hyper-V golden image and cloned worker were not built because this host has
  no Hyper-V management service/module and no operator-supplied base VHDX or virtual switch.
  Those layers remain explicitly skipped, not reported ready.

## Approved source state and toolchain

- Git HEAD before changes: `1ba811a7d4e31c04d20278659b52222fed734a3c`.
- Source state at evidence capture: dirty worktree containing the approved Revision 10–14 changes;
  no commit or push had yet been performed. The user subsequently authorized one normal commit and
  push of this exact task scope with `update docs, commit and push`; the resulting immutable SHA is
  reported in the handoff after publication. No pull, deploy, migration, or service cutover was
  performed.
- Evidence capture: 2026-08-21 UTC on Windows NT 10.0.26200.0.
- Windows PowerShell: 5.1.26100.9168.
- Python: 3.13.15.
- Clean terminal: MetaQuotes Ltd., build 6122, valid Authenticode signature.
- Clean terminal SHA-256:
  `7896c49fdef94b76d8e84281d352643a08f088ca08f2c9713745ba5b515a1506`.
- Clean catalog SHA-256:
  `b3ebb00622a66cf33933e6f7839f7947c341307cb766cd4ddbe5b6e819cf04e2`.
- Clean terminal-license SHA-256:
  `988fe130a973694e94cf40615567b56a71b4c200dcfe3b7c46bad6cb9a13d64b`.
- Host discovery: hypervisor reported present; `vmms` absent; Hyper-V PowerShell module absent.
- `codebase-memory-mcp` tools were unavailable in this agent session. Discovery used the required
  fallback in `docs/CODEBASE_MEMORY.md` plus exact current source reads. No graph result is claimed.

## RED evidence

1. Revision 14 focused RED: four failures because
   `Invoke-MT5VmServerCatalogEnrollmentCore` and the enrollment entry point did not exist.
2. First live UI rehearsal failed closed on the exact control map; the observed delayed enable
   transition reproduced the race before the bounded-wait fix.
3. A live rehearsal failed closed on exact server selection when the broad public search label
   selected the wrong company row. The official full company label then produced one exact match.
4. The Next/Finish control-state variant was reproduced by a failing regression test before adding
   exact IDs 12324 and 12325.
5. The exact-server helper test failed because the helper was absent; it then drove the pure exact
   matcher used by the UI transaction.
6. Real installed-slot attestation reproduced an incorrect data-profile parent mapping
   (`valid=false`, catalog absent). A new resolver regression failed before the fix and passed after
   the resolver returned the directory containing `origin.txt`.
7. The pre-commit sensitive-value gate found that the locally entered disposable login had been
   copied into one enrollment unit fixture. It was replaced with an explicitly synthetic numeric
   fixture; the focused test and the full final gauntlet passed, and the real login is absent from
   the staged source.

No assertion was weakened to obtain GREEN. A PowerShell fixture was corrected separately where
default text encoding could not preserve a Unicode synthetic path.

## Implementation evidence

- `Mt5VmTerminalUi.ps1` now provides exact-PID broker-neutral enrollment using bounded Win32
  messages, exact dialog/control IDs, exact ordinal server matching, official company search,
  ownership-aware graceful cleanup, and refreshed-catalog postconditions.
- `Enroll-MT5VmServerCatalog.ps1` accepts only terminal path, safe alias, public company label,
  optional protected credential path, and timeout. It validates DPAPI file location, owner,
  inheritance, ACL principals, schema, and terminal signature. Login/server/password are decrypted
  only in memory and are absent from result JSON.
- Image tooling provides pinned signer/hash unattended slot installation, distinct 1–4 slot paths,
  exact data-profile/catalog/license attestation, schema validation, transactional publication,
  bounded/coalesced clone policy, and explicit Hyper-V bootstrap opt-in.
- Account runtime files contain no installer, Hyper-V enablement, or clone capability.
- The live-matrix gauntlet temporarily isolates the legacy Exness terminal with graceful close and
  restores it in `finally`; the final host topology returned to exactly three expected paths.

## SPEC-to-evidence map

| Scenario | Evidence | Result |
|---|---|---|
| R12-1 pinned unattended slots | Hash/signer negative controls, `/auto` and distinct-path tests, idempotent/full-attestation tests, real signed clean slot attestation | pass for clean slot and synthetic 1–4 slot core |
| R12-2 transactional publication | Stage/provision/attest/self-test/publish ordering and exact cleanup regression; publish-before-attestation mutant killed | pass synthetic; real VHDX build skipped |
| R12-3 account path never installs | Runtime capability scan across Rust worker/gateway and Python adapter; installer-capability mutant killed | pass |
| R12-4 bounded isolated cloning | Mutex/coalescing/resource/health-before-register tests; duplicate-clone mutant killed | pass synthetic; real Hyper-V clone skipped |
| R12-5 clean discriminator | Clean signed build 6122, exact profile/catalog/license attestation, bootstrap PASS, matrix PASS | pass |
| R14-1 exact PID and in-memory credential | Ownership tests, signature/path validation, source gate, secret/process-argument gates, sanitized live output | pass |
| R14-2 official exact enrollment | Exact control-map tests, partial/duplicate rejection, stale/fresh catalog fixture, live exact server/catalog PASS | pass |
| R14-3 image-only capability | Runtime capability scan and mutant | pass |
| R14-4 final completion | Focused RED/GREEN, mutation score, live bootstrap, final matrix | pass |

## Fresh final gauntlet

Single rerunnable entry point:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
  .\tools\run-mt5-vm-powershell-regression-gauntlet.ps1 `
  -IncludeRealExnessProbe -IncludeRealReadonlyMatrix
```

Fresh result after the final profile-resolver fix and synthetic-fixture cleanup:

- Python unit/contract tests: **96/96 PASS**.
- PowerShell parser: **14/14 PASS**.
- Mutation score: **26/26 killed**.
- `git diff --check`: PASS; only Git line-ending conversion warnings were emitted.
- Secret gate: `SECRET_GATE_OK=task-files`.
- Process-argument gate: `PROCESS_ARGUMENT_GATE_OK=runtime-files`.
- Clean Exness live bootstrap: `REAL_TERMINAL_BOOTSTRAP_OK=exit-0`.
- FTMO/clean-Exness live matrix:
  `REAL_READONLY_MATRIX_OK=2-single+2-coexisting`.
- Overall: `MT5_VM_POWERSHELL_GAUNTLET=PASS`.

The enrollment rehearsal immediately before the final gauntlet returned only:

```json
{"status":"PASS","server_exact":true,"catalog_refreshed":true,"process_was_started":false}
```

The safe settings/bootstrap rehearsal returned PhaseStatus `PASS`, ExitCode `0`,
TerminalRestarted `true`, SettingsRetained `true`, RolledBack `false`, and LastErrorCode `1`.
The final matrix returned PASS for both single-account rows and both coexisting rows. No credential
value is retained in this evidence.

## Negative controls and non-actions

- Killed mutants cover BOM transport, process helper bypass, ACL weakening, wrong terminal path,
  persistence/rollback/restart failures, force-close, missing credential-bearing initialize,
  timeout weakening, topology restore, installer hash/signer bypass, premature image publication,
  account-runtime installer capability, duplicate clone, partial server match, stale catalog, and
  server leakage to child arguments.
- No SendKeys, clipboard, screenshot automation, startup INI, portable profile copy, process
  credential argument, environment credential, plaintext repository credential, or force-stop was
  used.
- No funded account, account creation, `order_check`, `order_send`, order modify/cancel/close, or
  other trade mutation call was used.
- Hyper-V was not enabled and the host was not rebooted.
- Independent verification was not performed.

## Remaining operator prerequisites for real VM-pool publication

The code intentionally fails closed at the real guest provisioner and worker health/registration
boundaries until the local host has Hyper-V management enabled and the operator supplies a
generalized Windows base VHDX, virtual switch, VM/image roots, and explicit resource policy. These
are infrastructure inputs, not per-user MT5 installation steps. Once supplied, image publication
and worker cloning must be rerun through the same gauntlet; this evidence does not claim that a
golden VHDX or production worker VM already exists.

---

# Revision 15-16 evidence - bare-metal managed MT5 + EA lifecycle

## Outcome and source state

- Revisions 15 and 16 were explicitly approved on 2026-08-21; the backend-docs Revision 1 commit
  expansion was explicitly approved on 2026-08-23.
- Fresh combined gauntlet result: `PASS_WITH_ALLOWED_UNVERIFIED`, with 44 passed layers, no failed
  layer, and two recorded SPEC-authorized unverified layers.
- Base HEAD: `5a61554c2255d18e0162c6dd9b71e8244ec6eb4a`.
- Verified task tree SHA-256:
  `793ed4bcbd5c8f38159e4633bf628ce67c885c833d8777c71e3a28371f567a48` (96 files).
- Run window: 2026-08-23 15:09:16Z through 15:20:14Z on Windows.
- No production deploy/restart, real-account connection, live broker request, or trade mutation was
  performed.

## R15 acceptance map

| Scenario | Fresh evidence | Result |
|---|---|---|
| R15-1 authenticated connect and secret lifecycle | Go/Rust auth tests, disposable database integration, secret scan, mutants M1-M3 | PASS |
| R15-2 bounded worker and terminal slots | Rust agent/managed tests, Python managed/safety contracts, dirty-slot mutant M7 | PASS |
| R15-3 automatic start and in-memory login | Agent process/control tests, disposable migration/Rust integration, capability audit | PASS |
| R15-4 preinstalled EA bootstrap without secret files | Common EA MetaEditor compile/release attestation, exact named-pipe PID mutant M5, secret scan | PASS |
| R15-5 readiness, isolation, and uniqueness | Migration `0042` positive/negative gates, lease-generation mutant M4, freshness mutant M6 | PASS |
| R15-6 lifecycle and restart recovery | Rust agent tests, Python VM regressions, dirty-slot and unknown-outcome mutants M7-M8 | PASS |
| R15-7 execution safety | Full Go/Rust test suites, changed-line coverage gates, stress/property tests, all eight mutants killed | PASS |
| R15-8 UI and operations | Frontend typecheck/lint and 83 trade tests; 2,546 backend-doc checks | PASS |
| R15-9 live end-to-end demo | Required runtime confirmation, secure Vault/worker identity, and three disposable demo accounts were not supplied | UNVERIFIED_ALLOWED |

## Fresh final gauntlet

Rerunnable entry point:

```powershell
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `
  .\tools\verify-mt5-baremetal-managed-ea.ps1
```

Exact high-level results:

- Go format/vet/tests/module integrity: PASS; changed-line coverage `200/200`.
- Go race: `UNVERIFIED_ALLOWED` because this Windows host lacks the supported CGO/C compiler path.
- Rust fmt/check/clippy/tests/agent/stress/supply-chain/database: PASS; changed-line coverage
  `6897/6897` using the approved bundled LLVM tools.
- Python managed: 54/54 PASS; VM regression: PASS.
- Disposable PostgreSQL migration `0042`: positive PASS; known-bad negative control rejected.
- Mutation score: `8/8`; M1 through M8 were killed.
- Common EA: compiled and attested SHA-256
  `516D54DDDC1EC4651C4D3E90F66F45B705E1E9FED1062BB66CDE78F6AD2B86AC`.
- Frontend: typecheck/lint PASS; trade tests 83/83 PASS; production audit found zero
  vulnerabilities.
- Backend docs: 2,546 checks PASS, including 149 Go routes, 75 environment keys, and migration
  head `0042`.
- Diff whitespace, secret controls/scan, dependency delta, and capability boundary: PASS.

The persisted generated report is `.artifacts/mt5-baremetal-managed-ea/summary.json`; generated
artifacts are intentionally excluded from the commit. Independent-verifier rounds did not cover
this final documentation state, so no final independent-verifier verdict is claimed.
