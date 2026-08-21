# SPEC Revision 12 — zero-touch local Hyper-V worker images

- Status: **proposed; no Hyper-V feature change, reboot, unattended install, image mutation,
  service registration, or autoscaling implementation is authorized until the exact approval
  phrase below is received**.
- Tier: **Tier 3**, because this changes authentication-bearing trading-worker provisioning,
  host virtualization, process isolation, and failure recovery.
- Operator input: production runs on local infrastructure fully controlled by the operator.
  The concrete target is native Windows Hyper-V with no cloud-provider dependency.
- Current-host discovery: Windows 11 Pro reports a hypervisor, but the Hyper-V management service,
  Hyper-V PowerShell module, and Packer are not present. This revision uses native Hyper-V
  PowerShell and adds no Packer dependency.
- MetaQuotes documents unattended installation with
  `mt5setup.exe /auto /path:"<distinct directory>"`. Installer use is restricted to image
  build/refresh and is forbidden in account connection.

## Architecture contract

```text
Pinned generalized Windows base VHDX
  -> image-builder VM
  -> unattended signed MT5 slot installation (1..4 distinct paths)
  -> signature/hash/server-catalog/license attestation
  -> sealed golden VHDX + non-secret manifest

User connects an MT5 account
  -> scheduler selects a healthy worker with a free installed slot
  -> existing mt5-vm-agent assigns the slot and receives credentials in memory
  -> if no worker has capacity, the local controller clones the sealed image
  -> the new worker passes health/attestation and registers
  -> scheduler assigns the account
```

One worker VM serves a bounded pool of isolated terminal/adapter pairs. A user account does not
create, download, install, update, or accept a license for MT5. Rebuilding or increasing pool
capacity creates a worker from the same sealed image; it does not require RDP or an operator to
run an installer.

## Failure model

1. Account connection invokes an installer, downloads software, changes Hyper-V, or waits for GUI.
2. An unpinned installer, invalid signer, unexpected hash, stale server catalog, or missing license
   enters the golden image.
3. Slots share a path, or cloned workers share a VM identity, disk, worker ID, runtime root, MAC,
   or writable differencing disk.
4. Capacity races create excess VMs or assign one slot to multiple accounts.
5. A failed build overwrites the last-known-good image or a failed clone advertises capacity.
6. Bootstrap, broker, VM-local, or vault credentials enter arguments, environment, unattend files,
   manifests, logs, Git, or the sealed image.
7. Hyper-V enablement or reboot occurs implicitly or interrupts a trading worker.
8. Scaling has no CPU, RAM, disk, VM-count, timeout, or cooldown ceiling.
9. Exness still returns `-10005`, but the image factory or connector is reported ready.

## Executable acceptance scenarios

### R12-1 — Image build is unattended, pinned, and idempotent

Given an absolute generalized base VHDX, an MT5 installer source, expected SHA-256, expected
MetaQuotes signer, slot count 1..4, and explicit `-AcceptMetaQuotesEula -Execute`, the builder
creates a staging VM and invokes the official installer inside the guest only with `/auto` and a
distinct absolute `/path` per slot. It uses no GUI automation, RDP, account credential, or broker
branch.

Every `terminal64.exe` must have a valid MetaQuotes signature, captured hash, distinct canonical
path/data profile, enrolled server catalog, and terminal license required by the existing agent.
The builder emits a schema-versioned non-secret manifest containing image version, slot paths,
artifact hashes, signer, build/version metadata, and timestamps.

Dry-run is the default and reports planned mutations without changing state. Re-running against a
complete matching image succeeds idempotently. A mismatched or partial target fails closed.

### R12-2 — Golden-image publication is transactional

The builder writes only to a unique staging VM/disk directory. It validates guest shutdown, slot
attestation, absence of reparse escapes/plaintext secrets, and a worker self-test before atomically
publishing a versioned golden VHDX/manifest and moving the `current` pointer.

Any download, install, verification, shutdown, export, or manifest failure leaves the prior image
and pointer untouched. Cleanup may remove only resources carrying the exact staging build ID after
resolving every absolute path; no broad VM, disk, process, or directory deletion is allowed.

### R12-3 — Account connection never installs software

Tests trace `provision_account` from gateway through managed worker and prove it selects only an
attested free `terminal_slots` entry. Gateway, scheduler, worker, adapter, and account API contain
no installer URL, `/auto`, `/path`, package manager, Hyper-V mutation, elevation, or download
capability.

When a worker is full, its existing capacity error remains bounded. The local capacity controller,
not the account handler, coalesces demand into at most one clone for the same capacity generation.
The account stays queued until a new worker passes registration and health.

### R12-4 — Local Hyper-V cloning is bounded and isolated

Given a published manifest and explicit host policy (VM root, virtual switch, minimum free disk,
per-VM CPU/RAM, max workers, startup timeout, cooldown), the controller creates a unique
differencing disk and VM identity, starts it, waits for a signed agent heartbeat and exact image
version, then advertises its bounded slots.

Concurrent identical scale requests create one worker. Timeout, boot failure, wrong version,
missing heartbeat, resource threshold, or max-worker breach fails closed without reducing existing
capacity. Scale-in and automatic VM deletion are outside this revision.

Hyper-V enablement is a separate bootstrap action. It checks that no trading worker is running and
requires both `-EnableHyperV -AllowReboot`; without both it changes nothing and does not reboot.

### R12-5 — Immediate clean Exness discriminator remains read-only

The unattended installer may prepare
`C:\Program Files\MetaTrader 5 Exness Clean` on the disposable validation host after verifying the
already-downloaded installer SHA-256 and MetaQuotes signature. This rehearses image build; it is not
account-connect behavior.

After official server enrollment and the safe Python settings transaction, the operator may enter
only a disposable Exness demo credential through the approved local prompt. The final fresh
gauntlet runs the single/coexisting read-only matrix. Exness must pass alone and with FTMO using
exact path/identity/server/demo attestation. If `-10005` remains, completion stays blocked; no shim
or false readiness claim follows.

## Negative constraints

- No installer, download, UAC, EULA prompt, Hyper-V mutation, or reboot in account API,
  `provision_account`, adapter, or worker runtime paths.
- No funded account or `order_check`, `order_send`, modify, cancel, close, or Phase 5 call.
- No plaintext Windows, VM, MT5, vault, login, server, or password material in arguments,
  environment, manifests, images, logs, tests, screenshots, Git, or evidence.
- No unpinned binary, invalid signature, in-place update, beta installer, portable mode, copied
  terminal executable, profile transplant, GUI automation, or elevation bypass.
- No force-stop of a terminal, broad cleanup, automatic VM deletion, or recursive deletion outside
  an exact staging build root.
- No more than four slots per worker and no scaling beyond explicit resource/worker ceilings.
- No commit, push, pull, deploy, production migration, service cutover, Hyper-V enablement, or host
  reboot except through the approved explicit switches.

## Planned files, operations, dependencies, and verification

- Add broker-neutral native-PowerShell entry points under `tools/mt5-vm-image/` for host discovery,
  unattended slot installation, transactional image build, manifest verification, and bounded
  Hyper-V clone/start. Add no cloud SDK or Packer.
- Add Windows contract tests under `backend/bridge/mt5_vm/` and Rust tests under
  `backend/execution/crates/mt5-vm-agent/` only where installed-slot/capacity behavior changes.
  Tests use fake installers, VHDX paths, Hyper-V boundaries, manifests, and credentials.
- Extend the rerunnable MT5 VM gauntlet with PowerShell parse/dry-run, negative controls,
  secret/process-argument/capability gates, Rust tests, and at least five mutants: remove installer
  hash verification, accept an invalid signer, publish before attestation, allow installer
  capability in account provisioning, and duplicate a concurrent clone.
- Real state only after GREEN and explicit switches: unattended clean Exness slot; Hyper-V feature
  enablement/reboot only with both dedicated switches; staging/golden resources only under exact
  operator roots. No production cutover is included.
- Existing dependencies only: Windows PowerShell 5.1, native Hyper-V PowerShell when enabled, Git,
  Python/unittest, Cargo/Rust, signed MetaQuotes installer, and existing MT5 Python runtime.
  New repository dependency: **none**.
- Final verification: RED -> GREEN -> REFACTOR; complete Python/applicable Rust suites; PowerShell
  parse; generated path/topology properties; fail-closed negative controls; mutation; secret and
  capability scan; transactional rollback rehearsal; clone coalescing stress; one real unattended
  clean-slot install; and final FTMO/Exness read-only matrix.
- EVIDENCE records exact source state/toolchain/host feature state, every command/result,
  spec-to-test mapping, skipped Hyper-V layers if no generalized base VHDX/vSwitch is supplied, and
  independent verification as not performed unless separately authorized.

## Approval phrase

Approve this exact revision with:

`Duyet SPEC Revision 12 local Hyper-V image automation`

## Approval

- Proposed on 2026-08-21.
- **Obtained.** The user explicitly approved this exact revision with
  `Duyet SPEC Revision 12 local Hyper-V image automation` on 2026-08-21.

## Revision 13 proposal — PowerShell automatic-variable fixture correction

- Status: **proposed; no test edit is authorized until the exact approval phrase below is
  received**.
- The Revision 12 behavioral RED was observed with six `NOT_IMPLEMENTED` failures. After the first
  GREEN implementation, three of seven focused tests pass. The other four PowerShell fixtures set
  `$error = $null`; PowerShell variable names are case-insensitive, so this attempts to overwrite
  the automatic read-only `$Error` variable and exits before reaching the frozen behavioral
  assertions.
- Change only the synthetic fixture variable in
  `backend/bridge/mt5_vm/test_local_image_automation.py` from `$error` to `$caughtError` in the four
  affected commands and corresponding JSON projections.
- Keep every assertion, expected error string, production script, boundary, dependency, negative
  constraint, and Revision 12 acceptance scenario unchanged.
- Run the four corrected tests, then all seven focused tests. This is test-harness wiring only and
  is not a relaxation of any image, installer, rollback, scaling, or reboot contract.

Approve this exact revision with:

`Duyet SPEC Revision 13 PowerShell fixture variable`

### Revision 13 approval

- Proposed on 2026-08-21.
- **Obtained.** The user explicitly approved this exact fixture-only revision with
  `Duyet SPEC Revision 13 PowerShell fixture variable` on 2026-08-21.

## Revision 14 proposal — broker-neutral server-catalog enrollment

- Status: **proposed; no UI-helper, catalog, or live-terminal change is authorized until the exact
  approval phrase below is received**.
- Observed after Revision 12 GREEN: the official unattended installer created a valid signed MT5
  build 6122 executable and terminal license at the clean path. First launch created a distinct
  data profile, but no `servers.dat`; a settled read-only initialize therefore still returns
  `MT5_INITIALIZE_FAILED (-10005)`. The clean slot has not yet met R12-5's required official server
  enrollment precondition.
- Goal: enroll an exact broker server through the official MT5 Open Account/Login UI without
  copying a profile, writing a startup INI, placing server/login/password in arguments or
  environment, or requiring an operator to RDP/click through the wizard.

### R14-1 — Enrollment is exact-PID, broker-neutral, and in-memory

Add a reusable enrollment transaction to `backend/bridge/mt5_vm/Mt5VmTerminalUi.ps1` and one
operator entry point under `tools/mt5-vm-image/`. The command line may contain only terminal path,
safe account alias, and a public company-search label. Reusable code contains no FTMO, Exness,
profile hash, observed PID, login, server, or password literal.

The entry point validates the exact canonical terminal path, MetaQuotes Authenticode signature,
same interactive Windows session, and exactly zero or one exact-path process. It decrypts the
existing DPAPI demo payload only in memory, validates positive login/non-empty exact server and
password, and never emits those values. UI text is set by Win32 messages directly from memory;
SendKeys, clipboard, screenshots, keystroke logging, temporary config files, and process arguments
are forbidden.

### R14-2 — Official wizard controls and server result are attested

The transaction discovers exactly one enabled official Open Account/Login dialog owned by the
verified PID and requires one exact control map. It searches the supplied public company label,
waits with a bounded timeout for the official server list, selects the entry whose server text
matches the decrypted exact server, chooses existing-account login, fills login/password in memory,
and submits once. Multiple dialogs, missing/duplicate controls, no exact server, disabled controls,
unexpected wizard state, timeout, or login rejection fails closed.

Success requires a newly refreshed `servers.dat` under the data profile mapped by `origin.txt`, an
exact server entry in the official UI result, and no other terminal/profile mutation. The tool
closes only a process it started and does so gracefully; a pre-existing terminal remains running.
It never creates an account, selects a live/funded mode, changes trading settings, or sends an
order.

### R14-3 — Enrollment is image-build/certification capability only

The account API, gateway, scheduler, Rust worker, and Python adapter gain no UI automation or
catalog-enrollment capability. Production user-connect continues to consume only an already
enrolled, attested slot from the golden image. The enrollment tool is allowed only during image
build/certification and the current disposable clean-slot rehearsal.

### R14-4 — Tests and live completion

RED tests must cover exact control/PID selection, duplicate/missing dialog failure, exact server
selection, no secret in arguments/output, timeout, login rejection, refreshed catalog
postcondition, and ownership-aware graceful cleanup. Synthetic fixtures use fake values only.
At least three new mutants must be killed: select a partial server match, accept a stale catalog,
and leak server into process arguments.

After GREEN/REFACTOR, run the enrollment once for the disposable `exness-mt5-demo` alias and clean
signed path, then rerun the existing safe settings bootstrap, single/coexisting read-only matrix,
and complete final gauntlet. If exact enrollment succeeds but initialize still returns `-10005`,
record the stable broker/MetaQuotes IPC blocker and stop; no profile copy, registry edit, portable
mode, downgrade, unsupported shim, or false readiness claim is authorized.

### Revision 14 constraints and planned files

- Planned changes: `backend/bridge/mt5_vm/Mt5VmTerminalUi.ps1`, its existing PowerShell contract
  test, a new broker-neutral entry point under `tools/mt5-vm-image/`, the Revision 12 focused test,
  gauntlet, mutation runner, EVIDENCE, and status docs after final results.
- Existing dependencies only: Windows PowerShell 5.1 Win32 interop, DPAPI, existing process/UI
  helpers, Python/unittest, and official signed MT5. New dependency: **none**.
- No assertion and implementation edit in one step; no secret fixture; no commit/push/deploy;
  no Hyper-V enablement or reboot in this revision.

Approve this exact revision with:

`Duyet SPEC Revision 14 broker-neutral server enrollment`

### Revision 14 approval

- Proposed on 2026-08-21.
- **Obtained.** The user explicitly approved this exact revision with
  `Duyet SPEC Revision 14 broker-neutral server enrollment` on 2026-08-21.

## Publication authorization — documentation, commit, and push

- Authorized on 2026-08-21 by the user's direct instruction: `update docs, commit and push`.
- Update the authoritative status, runbook, handoff, changelog, and sanitized evidence for the
  approved Revision 10–14 result.
- Stage only the audited task files, create one normal commit on the current `master` branch, and
  push it to `origin/master` only after the fresh gauntlet, diff hygiene, and secret gates pass.
- This authorization does not include force-push, history rewrite, tag/release creation, deployment,
  production migration, Hyper-V enablement/reboot, Phase 5 work, or committing credentials,
  account identifiers, exact servers, raw broker logs, or unrelated worktree changes.
