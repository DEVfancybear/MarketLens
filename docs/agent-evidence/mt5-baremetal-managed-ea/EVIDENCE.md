# EVIDENCE — Revision 15 bare-metal managed MT5 + EA

## Outcome

- Result: **PASS_WITH_ALLOWED_UNVERIFIED** for the approved non-production Revision 15 scope.
- Old-coder tier: **Tier 3**.
- SPEC: `docs/agent-evidence/mt5-vm-local-image-automation/SPEC.md`.
- Revision 15 approval obtained with the exact phrase
  `Duyet SPEC Revision 15 full bare-metal managed MT5 EA flow` on 2026-08-21.
- Revision 16 approval obtained with the exact phrase
  `Duyet SPEC Revision 16 llvm-tools coverage component` on 2026-08-22.
- Codebase-memory MCP was unavailable in this execution context. The mandated fallback was used:
  `docs/CODEBASE_MEMORY.md`, the trade execution architecture/security runbook, and the execution,
  MT5 VM, and production operation documentation were read before source changes. Current source was
  inspected directly and remained authoritative.

This result means the code, packaging, installer, production scripts, migration, EA artifact, UI,
and local/disposable verification are production-ready at the code level. It does **not** claim that
the production host was migrated, deployed, restarted, connected to a broker, or traded.

## Frozen source state for the final gauntlet

- Git HEAD: `5a61554c2255d18e0162c6dd9b71e8244ec6eb4a`.
- Changed/untracked task files hashed: **96**.
- Task-tree aggregate SHA-256:
  `793ed4bcbd5c8f38159e4633bf628ce67c885c833d8777c71e3a28371f567a48`.
- Manifest: `.artifacts/mt5-baremetal-managed-ea/source-state.json`.
- This EVIDENCE file is intentionally not in that manifest because old-coder requires EVIDENCE to be
  written after the single fresh final run. No implementation or test source was edited after that run.

## Fresh final run

Command, from the repository root:

```powershell
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File .\tools\verify-mt5-baremetal-managed-ea.ps1
```

Observed result:

- Started: `2026-08-23T15:09:16.4914519Z`.
- Completed: `2026-08-23T15:20:14.6355818Z`.
- Persisted layers: **46**.
- PASS: **44**.
- FAIL: **0**.
- UNVERIFIED_ALLOWED: **2** (`go-race`, `R15-9-live-demo`).
- Summary: `.artifacts/mt5-baremetal-managed-ea/summary.json`.
- One log per layer: `.artifacts/mt5-baremetal-managed-ea/logs/`.

The successful layers include source hashing, changed-source diff generation, PowerShell parsing,
deploy self-test, Go format/vet/tests/changed-line coverage and negative control, Go module integrity,
Rust format/check/clippy/tests, agent and stress/property tests, supply-chain lock, LLVM toolchain
attestation, instrumented coverage build/tests/merge/export and negative control, disposable Rust
database integration, Python managed and VM regression suites, migration 0042 positive/down/up and
negative gates, mutation self-test and score, MetaEditor EA compile/release attestation, frontend
typecheck/lint/trade tests, npm production audit, dependency delta audit, backend documentation,
whitespace, secret diff scan, and capability diff audit.

Additional production-build verification observed before the final gauntlet:

```powershell
cargo build --release --locked -p execution-gateway -p mt5-vm-agent
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File .\build-production.ps1 -BackendOnly -StageApi -SkipMT5PythonSetup
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File .\tools\deploy-backend.ps1 -SelfTest
```

- Release build produced both `execution-gateway.exe` and `mt5-vm-agent.exe`.
- The non-cutover production build staged the Go API, Rust gateway, and managed worker successfully.
- Deploy self-test passed **23/23** scenarios. No production service was restarted.

## SPEC behavior mapping

| SPEC behavior | Evidence | Result |
|---|---|---|
| R15-1 authenticated owner and secret lifecycle | Go/Python managed tests, disposable DB tests, M1/M2/M3 mutants, browser password-clear contracts, secret scan | PASS locally/disposable |
| R15-2 bounded bare-metal worker and slots | Rust agent/control/stress tests, installer tests, exact-root/ACL/path controls, capability audit | PASS locally/disposable |
| R15-3 automatic start and stdin-only login | Rust process tests, Python adapter tests, hostile process/path tests, M4/M7 mutants | PASS locally/disposable |
| R15-4 in-memory EA bootstrap | Rust pipe/PID/generation tests, EA compile/attestation, M5 mutant | PASS locally/disposable |
| R15-5 readiness, isolation, uniqueness | Migration 0042 positive/negative gates, Rust DB integration, Go owner contracts, M6 mutant | PASS locally/disposable |
| R15-6 reconnect/disconnect/restart recovery | Rust/Go recovery and stress tests, migration invariants, M7/M8 mutants | PASS locally/disposable |
| R15-7 existing execution safety | Full Go/Rust execution suites, EA release gates, unknown-outcome M8 mutant | PASS locally/disposable |
| R15-8 UI and operations | Frontend typecheck/lint/trade tests, deploy self-test, runner capability audit, runbooks | PASS locally |
| R15-9 two-owner/three-demo end-to-end gate | Requires separate runtime authorization, Vault, interactive worker identity, and disposable broker accounts | UNVERIFIED_ALLOWED |

## RED → GREEN → REFACTOR record

Behavioral failures were observed before each corresponding production fix:

1. Worker launcher used nonexistent `--managed-worker-stdin`; exact CLI test failed, then passed with
   `--managed-worker`.
2. Installer rejected the required one-host loopback HTTP topology; positive boundary test failed,
   then exact parsed loopback HTTP passed while remote HTTP, `localhost`, credentials, query, and
   fragment remained rejected. A throwaway mutant was killed by the negative test.
3. Production runner omitted the identity HMAC key file required by the Rust gateway; source contract
   failed, then exact protected-file validation/export and a runner-capability negative control passed.
4. A running Scheduled Task with Windows result `267009` was marked degraded; parameterized status test
   failed, then accepted only Running plus `0` or `0x00041301`.
5. Scheduled Task registration referenced a potentially transient source agent; integration tests
   failed, then the installer pinned and hash-verified an immutable worker-root copy.
6. CI/build/deploy omitted `mt5-vm-agent.exe`; packaging contracts failed, then both Rust binaries were
   built, checksummed, staged, and required by deploy verification.
7. Environment templates and deploy preflight omitted the identity key boundary; contracts failed,
   then absolute regular non-reparse key-file checks and Vault settings passed.
8. LLVM profiles leaked into the source tree; ignore contract failed, then `*.profraw` was ignored and
   prior profiles were moved recoverably under `.artifacts/legacy-profraw`.
9. Windows Smart App Control returned OS error 4551 for a newly linked default-target Rust test binary.
   The same 22 tests passed in a fresh task-local Cargo target. The gauntlet now rebuilds agent tests in
   a fresh artifact target and still fails closed after bounded retries for the exact 4551 outcome.
10. Mutation score reached M4 then Windows temporarily held a user-mapped source section. A retry
    self-control failed before implementation; bounded retries for only Windows sharing/lock/user-mapped
    codes restored byte-exact source and the fresh score passed **8/8**.
11. Report cleanup encountered the same transient Windows lock on `mutation.lock`; the full gate failed,
    then exact-root cleanup gained the same bounded, code-specific retry and the contract/final run passed.
12. Secret scan flagged the documented `user:pass@localhost` placeholder. The gate failed first; exact
    known localhost placeholders are now sanitized before scanning, while an assembled non-placeholder
    credential URL negative control is still detected. The final secret gate passed.

No assertion was weakened to make a production behavior pass. Negative controls remain fail-closed.

## Dependencies, toolchain, and generated artifacts

- New runtime package dependency: **none**.
- Revision 16's approved `llvm-tools-preview` component for
  `stable-x86_64-pc-windows-msvc` was installed/attested; the final gate records tool paths, versions,
  and hashes.
- The reviewed Node lock delta is only the existing `nanoid` security update from `3.3.16` to `3.3.18`.
- The Rust lock delta is limited to use of the already-present `hmac` workspace package and reviewed
  Windows API feature flags.
- Generated EA `.ex5`, release manifest, and checksum were rebuilt and attested.
- Build/test artifacts remain under `.artifacts/` and are not production deployment evidence.

## Limitations and forbidden claims

- `go-race`: not executed because this Windows host lacks the supported CGO/C compiler configuration;
  recorded as `UNVERIFIED_ALLOWED`, not PASS.
- R15-9: not executed. No production-like two-owner/three-demo-account path, broker-minimum demo order,
  deliberate post-submit timeout, or restart/reconnect live environment was exercised.
- No production migration, artifact deploy, canonical backend restart, worker installation/start,
  Vault token use, broker credential entry, terminal mutation, or production health cutover occurred.
- No Live/funded account or order was used.
- Independent verification round 2 was **not performed**. The existing round-2 note is incomplete and
  must not be described as a pass; confidence is therefore lower than a completed independent Tier 3
  verification.
- No authorized production code-signing identity or signing service was available. The agent is
  checksummed and the local clean-target build/tests pass, but a production host enforcing trusted
  signatures may still block an unsigned artifact. The remedy is a legitimate signed/policy-approved
  artifact, not disabling or bypassing Windows Security.
- No commit, push, tag, release, or deploy was performed.

Production cutover remains a separate explicitly authorized operation. The canonical entrypoints stay
`run-backend-production.ps1` for build-on-host and `tools/deploy-backend.ps1` for a CI-built artifact;
the managed worker lifecycle remains a separate operator action as required by the SPEC.
