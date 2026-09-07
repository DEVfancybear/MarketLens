# MT5 production repair v1

Status: awaiting explicit approval; implementation has not started.
Risk: old-coder Tier 3 because the final acceptance includes terminal configuration,
managed-worker provisioning, and production startup.

## Baseline and confirmed diagnosis

- Repository: `C:\Users\duong\Downloads\tradingview`.
- User-authorized `git pull --ff-only` completed from `097bcf7` to
  `7bcfeb8` (101 commits); the initial and post-pull worktrees were clean.
- Current host is `DESKTOP-F7SJ82A\duong`. The pulled provisioning verifier pins
  `DESKTOP-MDC339G\Duong`. Target-host confirmation is pending; neither hostname is
  silently substituted for the other.
- Existing focused suite: 68 tests, 67 passed, 1 failed in 53.623 seconds.
  `test_driver_parser_and_contract_controls` reports
  `PROVISIONING_PROBE_CUSTOM_CONFIG_LAUNCH_INVALID`.
- The driver reads its own CRLF source and matches an LF-only launch string.
  Actual source: 841 CRLF lines; raw exact matches: 0; after in-memory CRLF-to-LF
  normalization: 1. `core.autocrlf=true`; Git reports `i/lf w/crlf`.
- `Assert-ApprovedSourceState` compares against `097bcf7` and rejects four paths
  already merged into HEAD: the two `github-cicd-repair` evidence documents,
  `frontend/tests/shims/ky.ts`, and `tools/verify-github-cicd-repair.ps1`.
- The selected local profile has WebRequest enabled and a 140-character hexadecimal
  WebRequestUrl value. The current plaintext-only model rejects it with
  `PROVISIONING_WEBREQUEST_ALLOWLIST_PRIOR_STATE_INVALID`. This does not yet prove
  the cause of the previous production host's 4014 failure. A real terminal probe
  is required; file contents or a synthetic HTTP response cannot prove permission.

## Failure model

1. Valid Windows checkouts fail a source-text gate: execute equivalent LF and CRLF
   fixtures, and reject malformed launch commands in both representations.
2. An obsolete source manifest rejects integrated work, or a broad replacement
   accidentally accepts arbitrary work: explicitly pin the approved integration
   baseline and permitted task delta; test an unrelated changed path as rejected.
3. Writing guessed plaintext over terminal-owned serialized settings corrupts
   configuration or leaves WebRequest disabled: preserve opaque bytes, configure
   through the existing bounded terminal settings interface when required, and
   verify permission through the nonce-bound MQL5 script after reopen.
4. Wrong host, terminal, or listener is mutated: validate the confirmed identity,
   executable signature/path, profile ownership, and exact loopback topology.
5. Partial provisioning or probe failure leaves altered state: capture restricted
   backups, test restoration, preserve recovery material when restoration fails.
6. Process health is mistaken for working production: require both WebRequest
   receipts, all canonical health gates, and managed-worker readiness.

## Executable acceptance criteria

S1: `test_probe_contract_accepts_lf_and_crlf` runs the existing contracts with
identical logical source under LF and CRLF. Both exit 0 and retain the current
contract markers. Re-run the existing failing test unchanged.

S2: `test_probe_contract_rejects_invalid_launch_in_each_line_ending` removes the
config argument, adds a forbidden profile/portable switch, or duplicates the
launch. Each case exits nonzero for the expected launch contract reason. This
change must not normalize or rewrite terminal configuration bytes.

S3: `test_source_guard_accepts_integrated_baseline_and_task_delta` accepts the
exact pulled baseline plus only this SPEC's reviewed paths.
`test_source_guard_rejects_unrelated_change` and
`test_source_guard_rejects_dirty_runtime_checkout` remain nonzero. Git failures
must never be treated as empty successful diffs.

S4: `test_allowlist_preserves_opaque_profile_values` proves that an existing
serialized value is not interpreted as a plaintext URL or replaced by a guessed
serialization. Existing enabled settings are first tested by the real probe.
If configuration is needed, use the existing bounded UI helper, persist/reopen,
and require actual probe success. An unverified opaque value is never accepted
as proof of authorization. Synthetic fixture bytes contain no account data.

S5: `test_probe_and_settings_failure_restore_owned_state` injects launch,
receipt, shutdown, and restoration failures. Only run-owned state is cleaned up;
restoration failure remains authoritative. Wrong terminal and stale receipt
controls fail before success publication. No trading action is introduced.

S6: On the confirmed target host, two successive normal probe/allowlist runs must
produce distinct, fresh nonce receipts for actual HTTP 200 from the repository's
execution gateway. The second run preserves the working settings. Error 4014,
timeout, wrong service, stale nonce, or failed cleanup is failure.

S7: After the code gauntlet passes and the task changes are committed into a clean
checkout, execute exactly `.\run-backend-production.ps1`, without switches.
Require successful build, forward migrations, runtime startup, local/public
health, and managed-worker readiness before reporting production complete.

## Scope, setup, and authorization

Planned implementation/test paths:

- `tools/mt5-baremetal/Invoke-MT5WebRequestProbe.ps1`
- `tools/mt5-baremetal/Set-MT5WebRequestAllowlist.ps1`
- `tools/verify-production-worker-host-provision.ps1`
- `backend/bridge/mt5_vm/Mt5VmTerminalUi.ps1`, only if a reproduced settings-interface
  defect requires repair; preserve unrelated bootstrap behavior
- `backend/bridge/mt5_vm/test_production_webrequest_probe.py`
- `backend/bridge/mt5_vm/test_terminal_python_api_bootstrap.py`
- `tools/verify-mt5-production-repair.ps1` (new rerunnable code gauntlet)
- `docs/agent-evidence/mt5-production-repair/SPEC.md` and `EVIDENCE.md`

No planned dependency installation, downloads of replacement terminals, schema
changes, public API changes, or canonical runner changes. Use existing Windows
PowerShell, Python unittest, Git, Go, Cargo, Node/npm, MetaEditor, and terminal.
Use official MetaQuotes documentation for startup/permission semantics.

Generated outputs: sanitized logs/reports under ignored
`.artifacts/mt5-production-repair/`; disposable synthetic configs; run-owned probe
source/binary/request/receipt and restricted backups using the existing probe
locations. Never log credentials, full terminal config, or secret environment
values. Preserve tracked EA release artifacts.

Git: inspect status/diff; no reset, unrelated restore, or force push. After all
code-gauntlet layers pass, stage only task paths, commit and push to the selected
branch, then verify the exact CI run. A failing code gauntlet blocks commit/push.
Production validation follows from the resulting clean checkout; any runtime
failure blocks completion and must be reported distinctly from code validation.

Host mutations are limited to the separately confirmed target, selected signed
MetaTrader installation/profile, existing exact loopback proxy transaction,
managed-worker setup, and canonical production runner. Preserve other terminals,
accounts, credentials, and services. No trade or account enrollment is authorized.
Do not guess remote access or move this task to a different machine.

## Verification plan

Persist one fail-closed entrypoint:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\verify-mt5-production-repair.ps1
```

It must run the full affected Python suites, PowerShell parser/contracts,
LF/CRLF generated properties, source-manifest negative controls, fault-injection
rollback tests, changed-branch execution mapping, existing relevant mutations
plus at least three real mutations of the repair, diff/secret/capability checks,
and repeat the affected contracts in a different deterministic order. Record all
tool versions and source hashes. Broad application suites remain in the existing
complete provisioning verifier; do not weaken its layers to clear a failure.

Runtime entrypoints after target confirmation and passing code checks:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\mt5-baremetal\Set-MT5WebRequestAllowlist.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\verify-production-worker-host-provision.ps1
```

The latter includes the canonical no-switch production runner and all 13 existing
layers. The actual final run, per-layer results, S1-S7 mapping, and remaining
limitations must be written into EVIDENCE. Numeric PowerShell line coverage may
be unavailable with installed tooling; report that gap explicitly and provide
behavior/branch mapping, without claiming 100 percent measured coverage.
Independent agent verification is not performed unless explicitly requested.

Approval requested for this exact document: `APPROVE mt5-production-repair v1`.
Production target host must also be confirmed before host-dependent execution.

## Approval record

The user approved this exact SPEC in direct response to its approval question:
`Yes, làm đi man`. Implementation is authorized. The opening pending status is
retained as history; target-host confirmation remains outstanding.

## User-directed execution scope update

The user confirmed `DESKTOP-MDC339G` as the server, then stated that no remote
connection is currently available and instructed: `bạn hãy fix hết đi rồi tí nữa
tôi bật máy server test build lại có lỗi báo bạn fix 1 lượt`. Code repair,
gauntlet, commit/push, and CI verification remain authorized. S6/S7 and the
complete server provisioning verifier are deferred to the user's server test;
they are explicitly unverified and do not block delivery of a passing code
gauntlet. No production execution on `DESKTOP-F7SJ82A` is authorized by this update.

## Implementation findings within S4/S5

The receipt producer `tools/mt5-baremetal/MarketLensWebRequestProbe.mq5` used
local wall time while its consumer validates UTC Unix time. Include this source
in the repair delta: use UTC, reject shifted/stale receipts, and compile a fresh
disposable probe with the already installed MetaEditor. No terminal is launched.
This repairs the existing receipt contract without widening the freshness window.

The existing UI helper cannot read owner-drawn URL text after reopen. An explicit
opt-in may return pending verification only for its known enabled/two-empty-row
state; the outer transaction still requires the real probe. Default UI validation
and readable wrong-URL rejection retain their existing tests. Native snapshots
must preserve both bytes and exact ACL, including inherited DACL control flags.

The rerunnable gauntlet registers only `/.artifacts/mt5-production-repair/` in
local `.git/info/exclude` to keep its generated reports out of production source
checks. No dependency or tracked ignore-file change is introduced. Local docs
verification uses `-DocsOnly`; broad application suites remain in CI and the
unchanged server provisioning layers, deferred as directed above.
