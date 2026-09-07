# MT5 production repair evidence

SPEC approval obtained: the user answered `Yes, làm đi man` to the exact v1 SPEC.
Server: `DESKTOP-MDC339G`. The user explicitly deferred server execution because
remote access is unavailable. Code delivery is authorized; S6/S7 remain unverified.
No production-active claim is made.

## Source and rerunnable verification

Pulled master cleanly with `git pull --ff-only`, from `097bcf7` to
`7bcfeb891c6b76048c471af8c8dd0738177b2b56` (101 commits). Repair source is that
baseline plus the task delta in the commit containing this document. The canonical
runner, dependency manifests, secrets and tracked EA release artifacts are unchanged.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\verify-mt5-production-repair.ps1
```

Final fresh result: **PASS**, exit 0, completed `2026-09-07T03:33:38.1297727Z`.
Single authoritative run directory:
`.artifacts/mt5-production-repair/74bff1a33e9448f3afee95793971d5c9/`.

| Layer | Fresh result |
|---|---|
| Affected Python suites | 103/103 passed in 91.698 seconds |
| Restored source, reversed order | 24/24 passed in 26.957 seconds |
| Existing mutations | Allowlist 9/9, probe 3/3, UI 18/18 killed |
| Repair mutations | 9/9 killed by expected unittest assertion failure; exact bytes restored |
| MQL compile | Fresh EX5, compiler exit 1 (documented success), 0 errors and 0 warnings |
| PowerShell contracts/parser | All passed; known-bad receipt and secret control each exited 1 for expected reason |
| Backend docs, DocsOnly | 2562 checks; 151 Go routes; 74 environment keys; migration head 0042; negative control rejected |
| Dependency and secret checks | Zero changed manifests; four configured local secret values absent from repair source |
| Source integrity | All eight code/test source hashes identical after final restoration; diff check passed |

PowerShell in this run: `5.1.26100.9168`. Logs and `report.json` are local ignored
artifacts; the command above reproduces them on a suitably provisioned Windows host.

Recorded SHA-256 hashes are exact working-file bytes (Git may normalize CRLF on checkout):

| Source | SHA-256 |
|---|---|
| backend/bridge/mt5_vm/Mt5VmTerminalUi.ps1 | E9ECB89943D1E8C67CF7532CECB5570100A983494245741BD0E8B571A3E55856 |
| backend/bridge/mt5_vm/test_production_webrequest_probe.py | A89A2EB45A3FDD1BC80D86DC22672CAAEBD608AC84A9EC810A63AF87C76A9E2F |
| backend/bridge/mt5_vm/test_terminal_python_api_bootstrap.py | 4E70070532336A15BB8DC9178EA58F5CBECC0BC89EBE14DA238D32694578C24E |
| tools/mt5-baremetal/Invoke-MT5WebRequestProbe.ps1 | CA41F5896EE08322DAA21A3C1D00BA78CD972AB9FADE1AE642E3694BFE80669F |
| tools/mt5-baremetal/Set-MT5WebRequestAllowlist.ps1 | 25013B2FE700C0288898AA80C8BDF31C8879FC99D8BC63D5EB289FF9B4770F0A |
| tools/mt5-baremetal/MarketLensWebRequestProbe.mq5 | FAAC77B9493CD08003F21FD142E0BBBC94FEA6D1EF6A33E1EFFEB43A28319AF0 |
| tools/verify-production-worker-host-provision.ps1 | A362F41D0B40DB86D4D5412723882879FAAEA0F1D505F968DEB399F2007E6B76 |
| tools/verify-mt5-production-repair.ps1 | C7086CBBCE3116BA51BEA5FFF2E1BD2DE7E3A1FD0F4DB674F190A6064C845E2E |

The entrypoint creates unique ignored logs, records source SHA-256, and requires
identical source after all mutations are restored. Its report records exits,
mutation hashes and toolchain. MetaEditor compiles a disposable probe outside
terminal profiles; that probe is not executed locally.

Toolchain: Windows PowerShell 5.1; managed Python 3.14.6 for affected suites and
new mutations; existing UI mutation runner uses PATH Python 3.13.15; Git
2.55.0.windows.2; MetaEditor 5.0.0.6122. PSScriptAnalyzer is not installed: parsing,
contracts and diff whitespace checks are the local PowerShell syntax/style layer.

## Behavior and invariant mapping

| SPEC | Executed contract or deferred boundary |
|---|---|
| S1 | LF and CRLF contract executions pass; original driver-parser test remains unchanged. Only in-memory source matching is normalized. |
| S2 | Missing config, portable/profile switches and duplicate launch fail under both line endings. Existing probe mutations remain required. |
| S3 | Integrated baseline/task delta accepted; unrelated path, dirty checkout and four Git-error cases rejected by real guard functions with synthetic Git responses. Runtime still requires clean source and ancestry. |
| S4 | Four opaque-value lengths preserve bytes and SDDL, require initial probe, and preserve custom-config prefix. Disabled or validated permission-failure state alone permits applying settings. Both inherited-DACL forms are covered. |
| S4 UI | Known enabled/two-unreadable-row state returns APPLIED_PENDING_PROBE with probe_verified=false only with explicit opt-in. Existing default persistence failure and readable wrong URL still fail and restore. Real UI remains unverified. |
| S5 | Launch/receipt/probe-false/settings/shutdown/drift injections require exact bytes and SDDL restored. Unsafe quiescence retains backup and authoritative rollback failure. Commit/rollback trace requires probe and restores prior state. |
| S5 receipt | Stale nonce cannot authorize settings changes. UTC receipt passes; UTC+7 and UTC-5 fail without widening freshness bounds. MQL uses TimeGMT and compiles cleanly. Existing no-trade test retained. |
| S5 identity | Existing process/PID, signer, UI handle, click, editor, cursor and worker-install controls remain intact. Synthetic controls do not prove live server identity or UI. |
| S6 | USER-DEFERRED: two real terminal WebRequests with fresh distinct receipts and idempotent second run have not executed. |
| S7 | USER-DEFERRED: server build, migration, worker registration and local/public health have not executed. Canonical runner and thirteen server-verifier layers retained. |

Tests also reject duplicate keys, unsupported encoding, oversized/NUL native
values, invalid switches and existing recovery files before terminal actions.
Known-bad receipt/secret fixtures, mutation groups, reverse test order, dependency
delta and local configured-secret scan run from the same entrypoint. No secret
values are printed. Full named tests and command results are retained in logs.

## Reproduction and repair history

Pre-fix: 68 tests, 67 passed, one failed with
PROVISIONING_PROBE_CUSTOM_CONFIG_LAUNCH_INVALID. CRLF source had zero exact LF
launch matches; normalization produced one. Added line-ending tests reproduced
failure before implementation changed. The obsolete source gate rejected four
already integrated CI paths. Local opaque WebRequest bytes failed the old
plaintext model; no local profile was written or its contents logged.

Disposable NTFS tests reproduced DACL control-flag drift from Set-Acl and
File.Replace. Secure file creation plus conditional ACL application handles both
inherited descriptor forms; same-directory MoveFileEx restores the snapshot ACL.
No package installation is needed. Native settings remain terminal-owned; no
guessed serialization or file-only permission attestation is introduced.

Earlier gauntlets caught ACL regressions and a missing legacy trace marker; both
were repaired without weakening assertions. A later run passed tests but correctly
failed final hash validation after another UI fix changed source; that run is
superseded. The UI change required anchoring one existing mutant match to its
readback assignment and opt-in branch; mutation behavior, test and count remain. UTC regression
failed before the MQL fix. The new opt-in mutant initially survived because its
selected persistence test covered Python API settings, not WebRequest. A dedicated
opaque-row/default-rejection test was added; no existing assertions were weakened.
Historical logs remain under the repair artifact root;
do not mix those results with the final run. A diagnostic full backend-docs run
also passed its targeted Go checks. Final local docs run uses -DocsOnly; broader
application validation remains in existing CI and the server verifier.

## Delivery and limitations

After final local PASS: commit only task paths, push master and inspect the exact
commit's GitHub Actions terminal conclusion. Existing CI covers frontend build,
Go tests/vet, Rust tests/format and Windows agent tests/backend artifact builds.
It does not execute this PowerShell/Python repair gauntlet. Thus CI is broad build
and regression evidence, not independent proof of UI/probe behavior. Delivery SHA
and CI result are recorded after commit in ignored delivery.json and user handoff.

On DESKTOP-MDC339G the normal build entrypoint remains:

```powershell
.\run-backend-production.ps1
```

The runner pulls source but does not call standalone WebRequest repair. If initial
worker provisioning is still incomplete, the approved full verifier performs
allowlist repair, two probes, host-input preparation and the canonical runner:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\verify-production-worker-host-provision.ps1
```

Use an updated clean checkout on the selected server with the documented existing
gateway/profile prerequisites. No skip switches or fake receipts were introduced.
Unknown configuration shapes outside the bounded UI contract still fail safely.

No measured numeric PowerShell coverage or independent agent verification is
claimed. The table maps executable contracts; real UI, WebRequest, server ACL/policy
and production startup remain unverified. codebase-memory-mcp was unavailable in
MCP/PATH; discovery used the documented runbook, architecture docs and exact source
fallback. The installed old-coder Tier 3 workflow governs this repair.

Official semantics: [TimeGMT](https://www.mql5.com/en/docs/dateandtime/timegmt),
[TimeLocal](https://www.mql5.com/en/docs/dateandtime/timelocal), and
[MoveFileExW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-movefileexw).

## Authoritative task correction (2026-09-07)

The 299eef3 component results above are historical. They did not complete the
selected-host provisioning/installer/worker/health chain. Current corrective work
and its source-specific results belong to
`../production-worker-host-provision/EVIDENCE.md` under revision v40. Production
validation remains deferred to the user on DESKTOP-MDC339G.
