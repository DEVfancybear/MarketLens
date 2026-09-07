# Evidence Report — production-worker-host-provision v1 (Tier 3)

- Status: **BLOCKED — production was not started**.
- Spec approval: obtained exactly from the user as
  `APPROVE SPEC: production-worker-host-provision v1` before implementation.
- Approved SPEC:
  `C:\Users\Duong\Downloads\tradingview\docs\agent-evidence\production-worker-host-provision\SPEC.md`.
- Source baseline: `master` at `097bcf7f523b1327b2c970036d24d1542740fd8b`.
- Final verifier run: 2026-08-25T09:24:15.5791356Z through
  2026-08-25T09:55:50.8315400Z.
- Bare-metal report source-state hash before its generated tracked-output drift:
  `a557e5001a731a13fac5561e131823d03dfe9dcf6ed3d14e6ef656e235dcd115`.
- Toolchain observed: Windows PowerShell 5.1.19041.6456, Go 1.26.5 windows/amd64,
  rustc 1.97.1, cargo 1.97.1, Python 3.10.9, Node 20.12.2. `npm --version` could not be
  captured in the sandbox because Node failed to resolve `C:\Users\Duong` with `EPERM`.
- Entry point:
  `powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\verify-production-worker-host-provision.ps1`.
- Independent verification: **not performed** against this failed state.

## Outcome

The verifier correctly selected only:

- identity `DESKTOP-MDC339G\Duong`;
- terminal `C:\Program Files\MetaTrader 5\terminal64.exe`;
- state root
  `C:\Users\Duong\AppData\Roaming\MetaQuotes\Terminal\D0E8209F77C8CF37AD8BF550E51FF075`.

Its known-bad control rejected the FTMO terminal with the exact code
`PROVISIONING_SELECTED_TERMINAL_FORBIDDEN`. The auto-install contract suite passed 8/8.

The complete existing bare-metal gauntlet then returned `FAIL`: 42 layers passed, 16 failed, and
one live three-demo-account layer was `UNVERIFIED_ALLOWED`. The task verifier stopped with
`PROVISIONING_CONTRACT_LAYER_FAILED_BAREMETAL`, before checking or creating WebRequest evidence,
bootstrap material, install input, worker roots, receipt, task, migrations, service restart, or
health gates. This is the required fail-closed outcome; a failing gauntlet blocks production.

An explicit post-run audit found all three approved WebRequest source artifacts absent:

- `C:\ProgramData\MarketLens\slot-inputs\slot-01\chart01.chr`;
- `C:\ProgramData\MarketLens\slot-inputs\slot-01\experts.ini`;
- `C:\ProgramData\MarketLens\slot-inputs\slot-01\webrequest-attestation.json`.

Therefore S2 also remains independently blocked. No `probeSucceeded=true` result was invented.

## SPEC → test mapping

| Scenario / invariant | Evidence | Status |
|---|---|---|
| S1 exact selected slot preflight | verifier real-host preflight plus FTMO known-bad control | **pass** |
| S2 honest WebRequest topology evidence | explicit existence audit: all three required source artifacts absent | **fail / blocked** |
| S3 protected bootstrap material | stopped before mutation; post-run audit found no token file or env token | **unverified** |
| S4 strict one-slot install input | stopped before mutation; post-run audit found no install input | **unverified** |
| S5 hostile/stale dry run | auto-install synthetic contracts 8/8 pass; real installer dry run not reached | **unverified** |
| S6 exact terminal interruption | process-stop stage not reached; selected terminal was not running at post-run audit, attribution unknown | **unverified** |
| S7 canonical production run | canonical runner not invoked | **unverified** |
| S8 failure remains failure | verifier exited nonzero, protected production config stayed absent, no success claimed | **pass** |
| Must not touch FTMO/IC Markets | negative control rejected FTMO; no production install stage reached | **pass within observed scope** |
| Must not expose secrets | secret-diff-scan passed; no new token was generated | **pass within observed scope** |
| Must not use runner recovery switches | canonical runner was not invoked | **pass** |
| Must not commit/push/reset/checkout | none performed | **pass** |

## Gauntlet — final fresh run

The machine-readable report is
`.artifacts\mt5-baremetal-managed-ea\summary.json`; per-layer output is retained under
`.artifacts\mt5-baremetal-managed-ea\logs`.

| Layer | Result |
|---|---|
| Verifier parser and RED/GREEN control | RED observed against the stub; implemented control then rejected FTMO with the pinned code |
| Selected real-host preflight | pass |
| Auto-install contracts | 8 passed, 0 failed |
| Complete bare-metal gauntlet | 42 pass, 16 fail, 1 allowed-unverified; overall FAIL |
| Go shuffled full tests | pass, 231.476 seconds |
| Go tests / vet / race | pass; race 300.814 seconds |
| Windows credential-store smoke | pass |
| Rust fmt / check / clippy / tests / agent tests | pass |
| Rust stress properties | pass |
| EA MetaEditor compile and release attestation | pass, but generated tracked release drift described below |
| Frontend typecheck / lint | pass |
| npm production audit / dependency delta / secret scan | pass |
| Real production execution | not run because the gauntlet failed |

### Failed layers

1. `go-format` — command emitted output when an empty result was required.
2. `persistent-go-race-environment` — missing Revision 2 preflight snapshot at
   `.artifacts\mt5-windows-credential-store\toolchain-revision-2\preflight.json`.
3. `go-changed-coverage-gate` — exit 1.
4. `rust-coverage-toolchain` — approved `llvm-tools-preview` component is absent.
5. `rust-database-integration` — exit 1.
6. `rust-coverage-merge` — `llvm-profdata` was not attested.
7. `rust-coverage-export` — `llvm-cov` was not attested.
8. `rust-changed-coverage-gate` — exit 1.
9. `python-managed` — exit 1.
10. `postgres-0042-positive` — exit 1.
11. `postgres-0042-negative-control` — failed for an unexpected reason; missing
    `KNOWN_BAD_0042_CHECKER_INPUT`.
12. `mutation-score` — exit 1.
13. `postgres-0042-service-sandbox-absence` — expected at least four fresh reports, got zero.
14. `frontend-trade-tests` — exit 2.
15. `backend-docs` — exit 1.
16. `capability-diff-audit` — reported an unapproved production-runner capability change.

The exact logs named by the summary, not this condensed list, are authoritative for diagnostics.
No failed layer was weakened, skipped, relabeled as pass, or repaired outside the approved scope.

## Layers not run as specified

- **UNAVAILABLE:** Rust changed-line coverage could not complete because the approved
  `llvm-tools-preview` component was missing.
- **UNAVAILABLE:** the PostgreSQL/service-sandbox evidence expected by the frozen prior-task
  gauntlet was absent or failed.
- **UNVERIFIED:** R15-9 live three-demo-account gate; the reused suite explicitly recorded
  `UNVERIFIED_ALLOWED`.
- **UNVERIFIED:** installer real dry run, Scheduled Task, worker heartbeat/capacity, migrations,
  local health, and public health; all were downstream of the blocking gates.
- **N-A:** new application changed-line coverage/property/mutation for this task; no Go/Rust/TS
  application implementation was edited by the task.

## Generated drift and host state

The reused bare-metal gauntlet did not restore three tracked EA release artifacts after its
MetaEditor compile layer:

- `frontend/public/downloads/MarketLensExecutionEA.ex5` changed from 93,366 to 93,522 bytes;
- `frontend/public/downloads/MarketLensExecutionEA.release.json` changed compiler/source/binary
  attestation values from compiler 5.0.0.6122 to 5.0.0.6090;
- `frontend/public/downloads/MarketLensExecutionEA.sha256.txt` changed with the generated binary.

Those changes were absent from `dirty_before`, present in `dirty_after`, and remain unstaged.
They were not adopted as task implementation and were not restored because the approved SPEC
forbids checkout/reset and no separate destructive cleanup approval was obtained.

The post-run host audit found:

- no bootstrap token file;
- no managed-worker install input;
- no worker receipt;
- no `MarketLens MT5 Worker` Scheduled Task;
- no bootstrap token or worker receipt configured in `backend\.env`;
- the selected terminal process was no longer running, although this task did not execute its
  approved exact-process stop stage, so attribution is unknown.

## Structural blind spot

The repository validates the schema/hash of a positive WebRequest attestation but cannot derive an
actual MT5 terminal `WebRequest` success from a missing operator probe. This task therefore cannot
honestly create `probeSucceeded=true` from the current host state. Treating a hand-authored boolean
as proof would violate the approved SPEC and old-coder anti-gaming rules.

## Honest notes

- `codebase-memory-mcp` was unavailable as MCP and CLI; the documented direct-source fallback was
  used and disclosed before approval.
- The user-installed `old-coder` skill and its gauntlet/templates were read before SPEC creation.
- No production completion, health, worker readiness, or successful deployment claim is made.
- A fresh rerun remains blocked until the failed gauntlet layers and real WebRequest evidence are
  resolved. The tracked EA release drift also needs an explicit keep-or-restore decision first.

## SPEC Revision v2 cleanup evidence

Approval was obtained verbatim as:

```text
APPROVE SPEC REVISION: production-worker-host-provision v2
```

The approved cleanup scope was limited to these three tracked EA release artifacts:

- `frontend/public/downloads/MarketLensExecutionEA.ex5`;
- `frontend/public/downloads/MarketLensExecutionEA.release.json`;
- `frontend/public/downloads/MarketLensExecutionEA.sha256.txt`.

The first restore attempt stopped at a PowerShell parser error caused by an empty pipeline before
Git was invoked. It made no filesystem or index change. The second attempt reached Git but failed
to create `.git/index.lock` under the sandbox permission boundary; it also made no restore change.

After explicit elevation approval, this exact approved command completed successfully:

```powershell
git restore --source=097bcf7f523b1327b2c970036d24d1542740fd8b --worktree -- frontend/public/downloads/MarketLensExecutionEA.ex5 frontend/public/downloads/MarketLensExecutionEA.release.json frontend/public/downloads/MarketLensExecutionEA.sha256.txt
```

Post-restore verification matched each working file to the baseline commit:

| Path | Baseline Git blob | Working-file SHA-256 |
|---|---|---|
| `frontend/public/downloads/MarketLensExecutionEA.ex5` | `2116a666369309b12b8dbaf2ef75c856cf508dac` | `fcf60c64764055a6545bfba1287c33e3f34f63fac006f8c04474fd4ad74262e0` |
| `frontend/public/downloads/MarketLensExecutionEA.release.json` | `d9eeaa2630ab68db06ca5156d02506512b8e795b` | `08a7f9257efb9bfdd31a7878aa2580f4546f5180a5ace5a7d740d8a9b6f29c6c` |
| `frontend/public/downloads/MarketLensExecutionEA.sha256.txt` | `7e18c026c73fcca67fc75aea36a82a293f3d27c3` | `e80ac68ca15a2ff53c0e04e315f281943c14fd4813879822537b8693f00dacf1` |

A path-scoped `git status --short -- <three approved paths>` returned no output. The full final
status retained only the task evidence and gauntlet outputs:

```text
?? .artifacts/migration-0042/
?? .artifacts/mt5-baremetal-managed-ea/
?? docs/agent-evidence/production-worker-host-provision/
?? tools/verify-production-worker-host-provision.ps1
```

`SPEC.md`, this `EVIDENCE.md`, the provisioning verifier, and the machine-readable gauntlet summary
remain present. No fourth path was restored, removed, or otherwise cleaned. Revision v2 did not
resume production, run the canonical production runner, or intentionally change production-host
runtime state. The Revision v1 BLOCKED result remains authoritative.

## Revision v40 scope audit and draft - not implementation or completion

User requested reconciling 299eef3 with this task after the scope mismatch was
identified. v40 is appended to SPEC and is awaiting exact revision approval.
The previous `ok làm đi bạn` authorized preparing the corrective work, not a
claim that the subsequently written v40 document had already been reviewed.

Confirmed contract mismatches in 299eef3:

- v36/v39's non-UI production contract was replaced by an automatic UI call.
- The offline CommitRollbackTrace began executing real proxy/probe actions.
- Component verification and delivery were recorded in a separate task directory,
  without an explicit supersession map to this task's provisioning acceptance.
- The selected-host worker/receipt/heartbeat/health acceptance remains unverified.
  The user's explicit server-test deferral persists; no local production run is
  authorized or represented as a replacement.

Additional source audit of the actual preparation chain found byte/ownership
violations, reproduced using disposable fixtures only:

- Set-DotEnvValues did not preserve UTF-8 BOM or CRLF on the replaced line.
  Exact ACL remained equal in that fixture.
- Write-ProvenTopologyInputs did not reject a conflicting existing attestation;
  it overwrote the fixture. This tests publication ownership, not an allegation
  that the production caller bypasses its preceding live receipt validation.

Diagnostic source: `299eef3e5897c1bc723c1afeb05dff0feac1aafb`.
PowerShell: `5.1.26100.9168`.
Command: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .artifacts/production-worker-host-provision/v40-audit/discovery.ps1`.
Retained local report:
`.artifacts/production-worker-host-provision/v40-audit/541aefff5bf64d4396313f214d220fc4/report.json`.
The diagnostic command is an ignored discovery fixture, not the persisted v40
acceptance gauntlet; after approval these reproductions must become tracked tests
observed RED before the implementation changes. No production file, profile,
secret, task, service, installer or runner was executed or changed by this audit.

The new SPEC distinguishes the explicit one-time UI exception, offline trace,
provenance/cardinality, protected bundle creation and complete installer/runner
chain. This is a proposal, not retroactive approval of 299eef3. No v40 code tests,
mutations, fresh final gauntlet, commit/push or production validation have run.
Overall task remains incomplete. Codebase-memory MCP was unavailable; discovery
used docs/CODEBASE_MEMORY.md, the current production/managed-worker runbooks and
exact verifier/probe/installer/runner/UI source as the authorized fallback.


## Revision v40 final code evidence

Status: **CODE_VALIDATED_SERVER_PENDING**. Overall provisioning remains incomplete
until the selected-host full verifier passes. This section supersedes the earlier
v40 draft status for code delivery only; it does not rewrite historical results.

Spec approval: natural-language go-ahead to the displayed v40. The user's exact
reply was `tôi muốn bạn làm one-shot chức không muốn kéo dài nữa`; the assistant
acknowledged proceeding through v40 implementation, checks and delivery before
editing code. The suggested literal revision token was not sent. Server execution
on DESKTOP-MDC339G remains explicitly deferred by the user.

Tier: old-coder 3. No independent agent verification was performed. Codebase-memory
MCP and CLI were unavailable; discovery used docs/CODEBASE_MEMORY.md, the managed
EA runbook, original task revisions and current verifier/probe/installer/UI source.

### Delivered behavior and failure model

- Default native allowlist verification cannot invoke setup UI. Explicit
  `-ConfigureNativeAllowlist` accepts only the known disabled/empty initial state.
  Native byte/ACL snapshots remain until fresh proof and provenance publication
  succeed; publication failure restores the original config. Offline
  `-CommitRollbackTrace` does not launch a terminal, UI, HTTP request or portproxy.
- Protected provenance binds the exact terminal/config/source hashes and original
  receipt. Normal reuse requires that retained receipt hash plus fresh verification.
  Two distinct fresh receipt/nonce hashes against unchanged state precede topology
  publication. HTTP success alone never proves the absence of other allowed URLs.
- A shared file helper preserves dotenv BOM, line endings, literal replacement
  characters and ACLs; restricts newly created payloads before writing; rejects
  conflicting or partial existing input bundles; and records protected recovery
  snapshots. Rollback checks owned-file hashes/ACLs and preserves unrelated files.
- The full verifier checks selected host, terminal identity, gateway listener and
  source before protected preparation. It accepts the existing installer's valid
  ADOPTED result (`installed=false`, meaning this invocation did not install),
  calls the unchanged canonical runner without switches, rejects source changes
  during its pull, and retains fresh per-attempt reports. Pre-handoff rollback
  removes only the portproxy this run created. After handoff, failure retains
  attributable recovery state rather than undoing active worker state/migrations.
- The original verifier now owns `-CodeTestsOnly`. The old repair command is a
  compatibility delegate, and its SPEC/EVIDENCE are labeled historical component
  evidence. No runner, Go/Rust runtime, migration, frontend, generic UI helper,
  published EA, CI configuration, dependency or machine policy was changed.

### SPEC mapping

PASS below means local code/disposable contracts, not selected-host acceptance.
Tests without a module prefix are in
`backend.bridge.mt5_vm.test_production_host_provision.ProductionHostProvisionTests`.

| SPEC | Verification | Status |
|---|---|---|
| V40-S1 | test_default_allowlist_never_calls_ui; retained opaque-profile regression with an explicit provenance boundary | PASS (local) |
| V40-S2 | test_explicit_configuration_requires_empty_prior_and_live_proof; test_provenance_publication_failure_restores_native_settings; retained UI safety/probe-failure tests | PASS (local); actual UI UNVERIFIED |
| V40-S3 | test_configuration_provenance_rejects_unknown_or_stale_state; test_historical_receipt_hash_requires_retained_actual_receipt | PASS (local) |
| V40-S4 | test_commit_rollback_trace_is_offline; corrected legacy offline trace test; native recovery/ACL regressions | PASS (disposable NTFS) |
| V40-S5 | test_two_probe_receipts_bind_same_profile_before_publication; test_successful_probes_record_owned_proxy_for_later_rollback | PASS (process/network boundaries simulated) |
| V40-S6 | test_dotenv_update_preserves_bytes_and_acl (24 BOM/newline/trailing-newline/value combinations); malformed/duplicate/encoding controls; test_receipt_persistence_preserves_bom_crlf_and_literals | PASS (disposable NTFS) |
| V40-S7 | test_restricted_writes_protect_payload_from_creation; test_journal_restores_owned_bytes_acl_and_preserves_unknown_files; native rollback-failure regression | PASS (covered contracts); exhaustive I/O fault and crash/power-loss behavior UNVERIFIED |
| V40-S8 | test_host_input_bundle_refuses_conflicts_and_adopts_exact_state; test_bundle_round_trip_and_partial_failure_rollback; journal ownership regression | PASS (adoption/conflict/journal); mid-publication I/O fault matrix and multi-process contention UNVERIFIED |
| V40-S9 | test_actual_prepared_input_is_single_slot_and_strictly_parsed; test_preparation_dry_run_and_adoption_preserve_installer_contract; existing bare-metal installer suite | PASS (local); actual install/task adoption UNVERIFIED |
| V40-S10 | test_full_flow_stops_at_each_failed_boundary; journal and proxy ownership rollback tests | PASS (boundary simulation) |
| V40-S11 | test_attempt_report_cannot_reuse_old_pass; test_full_server_negative_controls_use_actual_error_codes | PASS (local); not a certification of every report failure mode |
| V40-S12 | source guard regressions for Git errors/dirty/unrelated paths; test_source_gate_precedes_host_mutation; test_selected_host_gateway_preflight_rejects_foreign_listener | PASS (local); actual runner pull/runtime UNVERIFIED |
| V40-S13 | full retained probe/UI/installer suites, existing mutations, MQL compile and reversed restored suite | PASS (local) |
| V40-S14 | all thirteen full-server layers, real MT5 permission, installer/receipt/task, PostgreSQL, fresh heartbeat/capacity and public health | UNVERIFIED: user deferred server execution |
| Original S1 / V3-S4 | host/source/gateway code boundaries above | PASS (local); selected host UNVERIFIED |
| Original S2 | native permission/provenance/two-receipt contracts above | PASS (local); actual permission UNVERIFIED |
| Original S3-S5 / V3-S5 | byte/ACL/one-slot/parser/adoption contracts above | PASS (local); host outputs and installer UNVERIFIED |
| Original S6/S8 / V3-S7 | exact process boundaries and owned rollback/failure ordering | PASS (local); actual process/installer recovery UNVERIFIED |
| Original S7 / V3-S6 | unchanged no-switch runner and actual production postconditions | UNVERIFIED: selected server not executed |
| V3-S1 through V3-S3 | source/static/contract/code gauntlet portions covered below; retained Go/Rust/frontend/full-server gates | PARTIAL: full thirteen-layer run is deferred |

### One fresh final code run

Entry point, from repository root:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\verify-production-worker-host-provision.ps1 -CodeTestsOnly
```

Run: `.artifacts/production-worker-host-provision/v40/code-7d9aaadcf7ed487b8803c7b25ce0cfb5/report.json`.
Finished: `2026-09-07T05:02:31.7533470Z`. Result: **PASS**, 78 recorded results, zero failed.

| Layer | Exact result from this run |
|---|---|
| Full affected Python suites | 125 tests, 0 failures/errors/skips; 124.691 seconds |
| Restored suite, reversed deterministic order | 46 tests, 0 failures; 59.391 seconds |
| Existing manual mutants | 9 allowlist + 3 probe + 18 UI = 30/30 killed |
| Retained repair mutants | 9/9 killed |
| New v40 mutants | 11/11 killed; each also killed in a separate run of the invariant module (11 additional executions) |
| Total distinct manual mutants | 50/50 killed; source match-count, changed hash, named failing test and exact restoration checked |
| PowerShell parsing / types | every .ps1 in the source hash manifest parsed; typed arguments exercised by runtime contracts; no separate static type checker |
| Known-bad/custom-gate controls | malformed launch/receipt/allowlist, unreadable input, occupied port, mouse/cursor boundaries and entrypoint secret control rejected; five full-server allowlist controls executed locally |
| Real local execution | Windows PowerShell CLI + actual NTFS byte/ACL transactions and MetaEditor compilation; no terminal startup |
| MQL compile | MetaEditor 5.0.0.6122, native success exit 1, generated EX5, 0 errors and 0 warnings |
| Backend docs | -DocsOnly: 2562 checks, 151 Go routes, 74 environment keys, migration head 0042 |
| Diff/dependencies/capabilities | diff check passed; dependency manifest delta 0; no package install; no live credentials read for local testing |
| Secret check | synthetic known-bad control and source diff check passed; this is not a comprehensive credential scanner |
| Coverage/property confidence | deterministic byte/ACL round trips and hostile inputs, mutation plus invariant reruns; numeric PowerShell changed-line/branch coverage unavailable and NOT claimed |

Toolchain: PowerShell 5.1.26100.9168; managed Python 3.14.6; Git
2.55.0.windows.2; MetaEditor 5.0.0.6122. Initial HEAD and remote master were
299eef3e5897c1bc723c1afeb05dff0feac1aafb (fetch confirmed no upstream delta).
The following hashes identify the tested working source before the corrective
commit; the final delivery receipt records the resulting commit and CI run.

| Source | SHA-256 |
|---|---|
| `backend/bridge/mt5_vm/Mt5VmTerminalUi.ps1` | `E9ECB89943D1E8C67CF7532CECB5570100A983494245741BD0E8B571A3E55856` |
| `backend/bridge/mt5_vm/test_production_host_provision.py` | `3097DC69CB11A16F0F5249AAEE34A7C15ADA9324368D6FC1EC537279020C6656` |
| `backend/bridge/mt5_vm/test_production_webrequest_probe.py` | `B1C160E99A39DD7F3F165E8F7C5F5252A4695D75209A6F1A2CCE85FF8315CF1B` |
| `backend/bridge/mt5_vm/test_terminal_python_api_bootstrap.py` | `4E70070532336A15BB8DC9178EA58F5CBECC0BC89EBE14DA238D32694578C24E` |
| `tools/Install-ProductionManagedWorker.ps1` | `B940E95A7E25F6969AA8ABA8609475B2AF2C6B5109167A45EFE7C757C4FBD143` |
| `tools/mt5-baremetal/Invoke-MT5WebRequestProbe.ps1` | `358E46E5A8E9C376C6B3931A1B1968D61371FF6F0F8762EC26B1C1D4E18D8128` |
| `tools/mt5-baremetal/MT5ProvisioningState.ps1` | `6E933F88064C0BE7B752150299141AFCB4B417C4E5FF18F6CB09DC3743761020` |
| `tools/mt5-baremetal/MarketLensWebRequestProbe.mq5` | `FAAC77B9493CD08003F21FD142E0BBBC94FEA6D1EF6A33E1EFFEB43A28319AF0` |
| `tools/mt5-baremetal/Set-MT5WebRequestAllowlist.ps1` | `1DD59F8AC85F7EE910183232D8F40103D998F71976DFB2D48D2EBCAFD59B08D9` |
| `tools/verify-mt5-production-repair.ps1` | `64FA8B469871A6FC4D55E7173554FA6FF3F4A478E594A14D47FCF6333AFBABEE` |
| `tools/verify-production-worker-host-provision.ps1` | `B7903E9A5BC951264CCE9B8183A9360D7B0D715B0F55DBACFB8324ABA57E9815` |

### RED, corrections and limits

Retained local RED logs: `.artifacts/production-worker-host-provision/v40-red.log`
and `v40-red2.log` through `v40-red7.log` in the same directory. They show the
original byte/ACL loss, unintended UI/probe actions, conflicting publication,
missing guards, stale negative-control codes, provenance publication boundary and
lost parent-level portproxy ownership. New API guards initially failed through
explicit missing-function/parameter assertions where applicable; these are weaker
RED evidence than the reproduced behavioral failures. Immediately passing
preserved behaviors received targeted mutants (receipt writer, strict installer
schema and gateway owner among them).

Windows descriptor handling needed an additional correction: protected new files
can gain/lose the auto-inheritance bookkeeping flag. The helper now verifies the
exact descriptor before payload write and explicitly reapplies it when necessary;
it does not treat a mismatched ACL as a pass. A first exploratory gauntlet reached
the final source check but failed because the synthetic secret marker matched its
own literal in the checker. Splitting construction of that controlled value fixed
the checker; the known-bad rejection remains active. No real secret leak was found
or claimed by that failure. The final run above supersedes all intermediate runs.

The old test requiring a live probe in CommitRollbackTrace was corrected to the
approved offline contract. Native-setup tests now opt in explicitly and start
empty/disabled; opaque reuse tests supply a provenance boundary that is separately
validated by the v40 suite. The source-guard fixture moved to the disclosed 299eef3
baseline. No no-trade, wrong-receipt, wrong-source, unsafe UI or ownership assertion
was removed to obtain a pass.

Real server execution, terminal UI/native serialization, signature/profile checks
against the selected installation, real receipt/task/worker readiness, PostgreSQL,
Go race/Rust clippy/frontend lint on that host, migration and public health remain
UNVERIFIED. The full verifier retains its thirteen required layers and fails on a
missing tool or failed layer. CI does not replace them. No independent review,
power-loss recovery experiment or multi-process stress test was performed. Recovery
journals support attributable manual recovery; unattended crash-resume is not
claimed. No production, broker onboarding or live/funded activation occurred.

### Delivery and selected-host handoff

Stage only the v40 task paths and deliver one corrective commit after the code
PASS. Verify remote SHA and the CI terminal conclusion for that SHA. The generated
`.artifacts/production-worker-host-provision/v40/delivery.json` is the post-push
receipt (commit, remote SHA, CI URL/result and the code-run reference); retain it
alongside this report. The final user response names that exact commit and CI run.

On DESKTOP-MDC339G, after updating the checkout, the one-time explicit native setup
and complete original provisioning validation are:

```powershell
.\tools\verify-production-worker-host-provision.ps1 -ConfigureNativeAllowlist
```

This mode requires an interactive selected identity and the known empty/disabled
prior state. With valid existing provenance, run the verifier without that switch.
An unknown existing allowlist is rejected rather than silently reset. The verifier
invokes `.\run-backend-production.ps1` without switches. Subsequent ordinary source
builds keep using that canonical runner directly. Server results must be appended
separately; do not promote this local code PASS to production acceptance.
