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

## Revision 15 proposal — full bare-metal managed MT5 + EA lifecycle

- Status: **proposed; no Revision 15 implementation, dependency install, migration, deployment,
  terminal mutation, credentialed account connection, EA publication, commit, push, or production
  trade is authorized until the exact approval phrase below is received**.
- Tier: **Tier 3**, because the change handles broker credentials, multi-tenant ownership, terminal
  process isolation, durable trading commands, restart recovery, and public authenticated APIs.
- User-selected topology: one operator-controlled Windows Server, multiple authenticated web users,
  multiple MT5 accounts, and one isolated terminal runtime per active account. Hyper-V, Windows ISO,
  VHDX publication, VM cloning, and automatic VM allocation are outside this revision.
- User-selected experience: the authenticated API connect flow must reserve capacity, start MT5,
  log in, bootstrap the EA, and report readiness without RDP or manual terminal interaction.
- Credential input: an MT5 user enters login, password, and exact server in the authenticated browser
  dialog over HTTPS. Operator secrets remain local. The coding agent will not inspect or print
  `.env`, product keys, Vault tokens, account passwords, or other secret values.
- Credential default: `session` remains the least-persistence mode and deletes the Vault value after
  one successful worker grant. `managed` remains an explicit user choice for encrypted restart
  recovery. Neither mode permits plaintext persistence in PostgreSQL, arguments, environment,
  terminal bootstrap files, logs, responses, Git, screenshots, or evidence.

### Architecture contract

```text
Authenticated browser
  -> Go MT5 connector API (owner from session; password accepted once and cleared)
  -> Vault + opaque secret_ref
  -> Rust durable placement/control plane
  -> mt5-vm-agent running as one bare-metal Windows worker
  -> one pre-provisioned, attested terminal slot per active account
  -> one-time credential grant over the private worker boundary
  -> Python adapter login through stdin/in-memory values
  -> exact login/server/terminal attestation
  -> one-time EA bootstrap token through an ACL-protected named pipe
  -> preinstalled MarketLensExecutionEA on exactly one chart
  -> existing durable EA poll/event/order path
  -> READY only after agent, terminal, account, and EA liveness all agree
```

The existing `execution_mt5_vm_*` control-plane tables and protocol are retained as the managed
connector contract; the worker advertises an explicit `bare_metal` substrate capability. Table and
protocol names are not silently renamed in this revision. The runtime gains no Hyper-V dependency.

`MarketLensExecutionEA.ex5` is installed, checksum-attested, WebRequest-configured for the loopback
gateway, and attached to one chart while a slot is prepared. An account-connect request never
downloads, compiles, copies, or installs an EA. Connect only assigns an already attested slot and
delivers short-lived runtime material. This is the meaning of automatic EA installation from the
user's perspective: no user action is required, but installation occurs once during operator slot
provisioning, not repeatedly in the credential-bearing API request.

### Failure model

1. A password, pairing token, worker token, Vault token, raw login, or exact server reaches logs,
   process arguments, environment, PostgreSQL, a terminal bootstrap file, Git, or a public response.
2. A client-supplied owner ID controls placement, pairing, read state, reconnect, disconnect, delete,
   copy routing, or order execution for another user.
3. Two accounts receive one terminal/profile/pipe, or one account is active in two slots after a
   retry, worker restart, stale lease, or concurrent connect.
4. A connect request downloads or installs MT5/EA, invokes GUI automation, requires RDP, enables
   Hyper-V, requests UAC, reboots the host, or mutates a VM image.
5. MT5 reports a different login/server, login fails, the terminal process exits, or EA pairing
   fails, but the account is reported `ready`.
6. A stale worker session, lease generation, connection revision, credential grant, or EA bootstrap
   token acts on a newer assignment.
7. A terminal or adapter timeout kills an unrelated process, deletes another slot, corrupts the
   immutable slot template, or advertises freed capacity before cleanup is complete.
8. A restart duplicates or resends a command whose broker outcome is already accepted, filled, or
   unknown; open positions or pending orders are closed/cancelled as a side effect of reconnect.
9. The same broker account is concurrently claimed by different owners without an explicit conflict,
   allowing conflicting controllers on the same live account.
10. Unbounded terminal creation exhausts CPU, memory, handles, disk, or the interactive Windows
    session and degrades existing trading accounts.
11. The shared Windows administrator boundary is represented as equivalent to tenant-isolated VMs.
12. Unit tests pass while the real browser -> API -> worker -> MT5 -> EA path cannot start or recover.

### R15-1 — Authenticated connect and secret lifecycle

Given an authenticated user submits `platform=mt5`, numeric login, non-empty password, exact server,
safe label, and `persistence=session|managed` to the existing managed MT5 connect surface, the Go API
must derive the owner exclusively from the authenticated session, validate and clear the request
buffer, reserve a new account revision, write the credential only to the configured Vault, and
return HTTP 202 with only account ID, connection status, and revision.

The response, PostgreSQL rows, tracing, metrics, logs, panic output, and audit events contain no raw
password or login. Safe operator diagnostics may contain account ID, worker ID, state, bounded error
code, and a masked login suffix only. Vault failure compensates the reservation and allocates no
slot. Concurrent or retried requests are idempotent at the explicit request key and cannot create
two active connections for one request.

For `session`, the one-time worker grant consumes and deletes the Vault value. Loss of the terminal
or worker then transitions to `credentials_required`. For `managed`, the Vault value remains
available only through a new generation-fenced grant during an authorized reconnect. Browser state
clears the password after request settlement and never persists it to localStorage, IndexedDB, URL,
analytics, or error telemetry.

### R15-2 — Bounded bare-metal worker and terminal slots

The operator prepares one to four slots under explicit absolute roots. Every slot must have a unique
canonical terminal install path, data profile, runtime root, safe slot ID, named-pipe name, and
process identity. Preparation verifies the official terminal Authenticode signer/hash and the
published EA checksum/release manifest, configures only the loopback EA gateway origin, and attests
that exactly one compatible EA is attached to exactly one chart.

The bare-metal worker registers through the existing private authenticated control plane with
`substrate=bare_metal`, capacity no greater than its attested slot count, an exact runtime/EA version,
and an explicit CPU, memory, minimum-free-disk, startup-timeout, and maximum-process policy. It runs
under a dedicated interactive Windows identity with protected slot/runtime ACLs. No public worker,
admin, PostgreSQL, Vault, Python, named-pipe, or loopback gateway port is exposed.

Placement is transactional and generation-fenced. Concurrent connects receive distinct free slots.
No capacity leaves the account queued with a bounded status; it does not create a terminal, clone a
directory, install software, or oversubscribe. A stale/offline/draining worker receives no new work.

### R15-3 — Automatic start and in-memory MT5 login

For a valid `provision_account` command, the agent verifies the exact worker/session/lease generation,
claims one attested free slot, creates only that assignment's writable runtime, starts the exact
terminal executable, and records the exact child PID. It consumes one private credential grant and
sends login/password/server to the existing Python adapter through redirected stdin; none of those
values may enter command arguments, environment, files, or output.

Success requires a bounded initialize/login result whose terminal path, numeric login, exact server,
terminal build, connection state, and trading permissions match the reserved request. A wrong
identity, broker rejection, timeout, process exit, duplicate process, unsupported build, or malformed
adapter result fails closed with a sanitized code. Cleanup closes only the exact child process,
resets only the exact assignment runtime after resolving its absolute root, revokes its grants, and
does not release the slot until cleanup and postconditions pass.

### R15-4 — Preinstalled EA bootstrap without secret files

After exact MT5 login, the agent opens an ACL-protected named-pipe server unique to the slot and lease
generation. The preinstalled EA connects from the assigned terminal process. The server verifies the
named-pipe client PID belongs to that exact terminal process before returning a short-lived, one-time
pairing bootstrap bound to owner, reserved account ID, worker session, slot, lease generation,
connection revision, login fingerprint, and gateway origin.

The EA reads the bootstrap only in memory, never from an input `.set` file, startup INI, clipboard,
environment variable, command line, common-files directory, or persistent terminal file. The gateway
consumes it once, adopts the already-reserved managed account ID, binds the resulting EA session to
the exact normalized MT5 identity and owner, and rejects replay, expiry, wrong PID/slot/generation,
wrong account identity, wrong gateway, or a second live controller.

The normal EA session token may then use the existing protected terminal sandbox behavior. First
connect requires the current production EA compatibility version. A successful bootstrap must be
observable as one healthy EA session and successful poll; the bootstrap token and broker credential
must already be unrecoverable from the pipe and process memory buffers after use.

### R15-5 — Readiness, multi-user isolation, and account uniqueness

An account becomes `ready` only when all of the following are current for one matching generation:
worker heartbeat, terminal PID/path, exact login/server attestation, adapter synchronization, EA
version/session, and a completely successful EA poll. A partial path remains `queued`,
`provisioning`, `synchronizing`, `degraded`, `credentials_required`, `blocked`, or `disconnected`.

Every list/read/history/order/copy/reconnect/disconnect/delete route is scoped by the authenticated
owner at Go and rechecked by Rust/PostgreSQL. Cross-owner probes return not-found/forbidden without
revealing whether the account exists and cannot mutate revisions, leases, sessions, commands, Vault
references, or slots.

Managed connections store a keyed, non-reversible fingerprint of normalized server + login, never
the raw identity, and prevent two active owners or slots from controlling the same broker account.
Conflict responses reveal no existing owner or login. The legacy self-managed EA path remains
compatible and unchanged unless an explicitly tested duplicate-account conflict is required to keep
one broker account from acquiring two simultaneous controllers.

### R15-6 — Reconnect, disconnect, delete, and restart recovery

Reconnect, disconnect, and delete require the current connection revision and are idempotent.
Stale revisions or generations cannot act. Session-mode reconnect without a retained credential
returns `credentials_required`; managed mode issues a new one-time grant without exposing the Vault
value to the browser, Rust gateway, logs, or PostgreSQL.

Disconnect revokes new command delivery, fences the EA and worker lease, gracefully stops only the
assigned terminal/adapter, removes the assignment runtime through exact-root cleanup, and releases
the slot only after worker acknowledgement. It must not close positions, cancel pending orders, or
invent broker outcomes. Delete performs the same stop/fence sequence, then deletes active/pending
Vault references and durable connection metadata transactionally; retry after partial failure must
converge without losing the ability to clean up.

After API, gateway, agent, or host restart, durable leases/revisions and terminal identity determine
whether to adopt exactly one healthy runtime, fence a stale runtime, or request credentials. An EA
command with an accepted/filled/cancelled/unknown outcome is never recreated or blindly resent.

### R15-7 — Existing execution safety remains authoritative

Once `ready`, market, pending, modify, cancel, close, copy, reconciliation, risk, idempotency, trade
authorization, audit, and unknown-outcome behavior continue through the existing production EA
gateway. Revision 15 does not create a second order engine or allow the Python login adapter to call
`order_check`, `order_send`, modify, cancel, or close.

The EA remains broker-neutral and uses the terminal's native `OrderCheck`/submission path only for a
durable, owner-authorized command already routed by Rust. Minimum EA version, clock bounds, symbol
mapping, minimum/step/maximum volume, stop distance, risk policy, delivery lease, terminal journal,
and unknown-outcome reconciliation gates remain mandatory.

### R15-8 — UI and operational behavior

The existing managed MT5 dialog remains the user entry point. It reports bounded connection states,
clears password state immediately after submit/reconnect, describes `session` versus `managed`
truthfully for a bare-metal worker, and never asks the user to download an EA, copy a pairing token,
open RDP, or configure WebRequest for this managed path. The manual self-managed EA option remains
available and clearly separate.

The production backend continues to start through `run-backend-production.ps1`; Revision 15 must not
duplicate or bypass its pull, build, migration, restart, MT5 runtime, and health-gate ownership.
Bare-metal worker installation/start is a separate explicit operator action and must have dry-run,
exact-root, identity, ACL, version, and health checks. Hyper-V state is neither read as a readiness
gate nor changed.

### R15-9 — End-to-end completion gate

The disposable production-like gate uses at least two authenticated test owners and three disposable
MT5 demo accounts, with one owner holding two accounts. From clean stopped slots, the browser/API
connect flow must allocate three distinct runtimes, login without manual terminal interaction,
bootstrap three EAs, and reach `ready` concurrently. Tests then prove cross-owner denial, same-owner
multi-account reads, account-specific command routing, disconnect/reconnect fencing, worker restart,
and exact slot reuse only after cleanup.

At least one demo account executes a broker-minimum market lifecycle with protective stop, followed
by modify/close and reconciliation, using the existing trade-authorization path. A deliberate
post-submit timeout must resolve through reconciliation without blind resend. No Live/funded order
is included; any Live canary requires a separate explicit operator authorization after this demo gate.

If the host cannot provide an interactive worker identity, secure Vault, three disposable demo
accounts, exact terminal/EA artifacts, or enough attested slots, EVIDENCE reports the corresponding
gate blocked. Passing unit or synthetic tests must not be reported as end-to-end production success.

### Negative constraints

- No Hyper-V enablement, Windows ISO/VHDX, VM build/clone, UAC bypass, reboot, cloud VM SDK, Docker/Wine
  MT5 workaround, or claim of VM-grade tenant isolation.
- No MT5 or EA download/install/compile, GUI wizard automation, RDP, clipboard, SendKeys, startup INI,
  `.set` secret, or profile transplant in an account-connect/reconnect request.
- No raw broker credential, product key, operator token, Vault payload, pairing/bootstrap/session token,
  exact live account, or exact broker server in chat, command arguments, environment, PostgreSQL,
  logs, metrics, screenshots, Git, fixtures, reports, or public responses.
- No client-supplied owner trust, account-ID-only lookup, unfenced worker/slot operation, reusable
  credential grant, reusable bootstrap token, shared runtime directory, or broad process/path cleanup.
- No test weakening, assertion and implementation edit in one step, invented RED/result, skipped
  applicable layer without an EVIDENCE reason, or completion while any gauntlet layer fails.
- No modification of `run-backend-production.ps1` merely to launch the worker, and no use of its
  recovery switches during a normal production run.
- No automatic broker trade during connect/readiness, no funded/Live credential in validation, and no
  Python-side order mutation. Demo trading occurs only in the explicit R15-9 gauntlet step.
- No commit, push, pull outside the canonical production runner, deploy, production migration, terminal
  mutation, worker installation, or service cutover before the approved SPEC permits the exact action.

### Planned source, test, documentation, and generated files

- PostgreSQL: add the next forward/down migration only for fields/constraints required to bind a
  managed reservation to an EA bootstrap/session, enforce active managed-account identity conflict,
  and identify the worker substrate. Raw identity and credentials remain forbidden.
- Rust gateway: extend the existing `execution-gateway` managed-worker control, placement, pairing,
  EA-session, revision/fencing, and recovery modules. Prefer a focused new bare-metal/EA bootstrap
  module over adding more unrelated logic to `main.rs`.
- Rust agent: extend `backend/execution/crates/mt5-vm-agent/src/{managed,process,protocol,worker}.rs`
  and focused tests for bare-metal slot claims, exact-PID lifecycle, credential stdin handoff,
  named-pipe bootstrap, cleanup, restart adoption, limits, and stale-generation rejection.
- Python adapter: change `backend/bridge/mt5_vm/phase1_adapter.py` only where exact login/identity and
  zero-order-capability behavior need the production bootstrap contract; extend its focused tests.
- EA: extend `backend/bridge/mt5_ea/MarketLensExecutionEA.mq5` for in-memory named-pipe bootstrap while
  preserving the manual `PairingToken` compatibility path; publish a new compatible `.ex5`, checksum,
  and release manifest only after MetaEditor reports zero errors and zero warnings.
- Go API/Vault: preserve the current strict connect/reconnect secret boundary in
  `backend/internal/execution/mt5_connector_handler.go`; add only the DTO/client/internal calls needed
  for the bound EA bootstrap and sanitized status. Extend handler and client tests first.
- Frontend: update the existing `Mt5ManagedConnectionDialog`, execution API/types, status copy, and
  trade tests only as needed for the automatic bare-metal path. Manual EA setup stays separate.
- Windows operator tooling: add a dry-run-first bare-metal slot/worker installer under
  `tools/mt5-baremetal/`, reusing the existing attestation helpers rather than duplicating them. It
  may create only explicit slot/runtime roots and an explicitly named scheduled task/service identity.
- Verification: add one persisted fail-closed entry point
  `tools/verify-mt5-baremetal-managed-ea.ps1`, plus a persisted mutation runner. Fresh reports go only
  under `.artifacts/` (gitignored) and sanitized EVIDENCE under
  `docs/agent-evidence/mt5-baremetal-managed-ea/`.
- Documentation after verified results: update the authoritative connector plan, local image/bare-metal
  runbook, production security runbook, operations, current state/progress, next tasks, handoff,
  known issues, changelog, and the new EVIDENCE. Do not claim VM-pool completion.
- Exact file names may narrow after RED discovery, but adding a new runtime, migration, dependency,
  secret store, public route, network listener, or capability outside these categories requires a
  visible append-only SPEC revision and new approval.

Generated local state may include Cargo/Go/Next/Python build caches, `backend/bin`, the managed Python
venv, compiled EA staging output, disposable PostgreSQL/Vault data, worker runtime directories under
an explicit operator root, `.runtime-logs`, and `.artifacts`. None is committed. Cleanup is limited to
exact task-created disposable roots after absolute-path verification.

### Dependencies, tools, git, and production operations

- New runtime dependency: **none planned**. Use the existing Go, Rust, Python, PostgreSQL, Vault,
  PowerShell, Win32 named-pipe, MT5 Python, MetaEditor, and EA/runtime dependencies already present.
- If implementation proves a new package is necessary, stop and append its exact version, license,
  purpose, capability, and audit plan to this SPEC for approval before installation.
- Tools used: Git, PowerShell 5.1+, Go 1.26.5+, pinned Rust/Cargo lockfile, Python/unittest, Node/npm
  only for touched frontend tests, disposable PostgreSQL and Vault harnesses, official signed MT5,
  and MetaEditor for the EA release build.
- Git plan after approval: record the starting SHA and dirty state; do not overwrite unrelated work.
  Use local checkpoint commits only if needed to keep the canonical production runner's clean-tree
  gate, stage only audited task files, and do not push, tag, release, deploy, or rewrite history
  without a later explicit instruction.
- Production operations after GREEN and the full synthetic/disposable gauntlet require separate
  execution-time confirmation: forward-only production migration, worker install/start, canonical
  backend restart, and any demo-account connection. Approval of this SPEC authorizes implementation
  and non-production disposable verification, not an unannounced production cutover.

### RED -> GREEN -> REFACTOR and gauntlet

1. Record fresh Go, Rust, Python, frontend, PowerShell parse, migration, and relevant existing EA
   baselines before implementation.
2. Add failing tests first for each R15 behavior. Observe behavioral assertion failures, not only
   missing-file/import failures. If behavior already exists, prove the test with a throwaway mutant.
3. Implement one behavior at a time; never edit its assertion and implementation in the same step.
   Run the focused suite at every GREEN and the affected full suite after each REFACTOR.
4. Migration gate: apply 0042-equivalent up on disposable PostgreSQL, assert constraints and data,
   migrate down one step, migrate up, verify `dirty=false`, and rehearse forward-only failure recovery.
5. Rust: format, check, clippy with warnings denied, all execution-gateway/agent tests, concurrency/
   restart stress, property tests for generations/state transitions, changed-line coverage, and
   `cargo-mutants` or the persisted fail-closed mutation runner.
6. Go: `go vet`, race-enabled tests where supported, full tests, owner/secret/API contract properties,
   changed-line coverage, and manual mutations for secret clearing/compensation/owner injection.
7. Python/PowerShell: full relevant unittests, parser checks, hostile path/PID/ACL cases, randomized
   ordering, exact-root cleanup negative controls, and mutants for identity, timeout, and secret leak.
8. EA/frontend: MetaEditor zero-error/zero-warning compile, EA compatibility/pipe/parser mutants,
   frontend typecheck/lint/unit tests, browser connect/password-clear/cross-owner tests, and no secret
   retained in browser persistence or traces.
9. Supply chain/capability/secret gate: audits for every touched ecosystem, license review if deps
   change, gitleaks/diff scan, generated-artifact checksum verification, public-listener audit, and an
   explicit capability diff for filesystem, subprocess, IPC, Vault, and network changes.
10. Real execution: disposable PostgreSQL + Vault + API + Rust gateway + bare-metal agent + three
    clean demo slots, then execute R15-9. Secrets are entered locally and sanitized output only is
    retained. Live/funded accounts remain forbidden.
11. Adversarial pass: race connect/disconnect/reconnect, replay grants/bootstrap tokens, spoof owner,
    spoof pipe client PID, crash each component between state transitions, exhaust capacity, kill a
    terminal mid-command, and verify fail-closed recovery/no blind resend.
12. Run one final fresh `tools/verify-mt5-baremetal-managed-ea.ps1` after the last source edit. It
    deletes stale reports first and fails on any skipped item unless that skip is explicitly allowed
    by this SPEC and reported unverified. Write EVIDENCE from that single run.

At least eight meaningful mutants must be killed: bypass authenticated owner; retain/expose password;
reuse a credential grant; ignore worker or lease generation; accept the wrong named-pipe PID; report
ready before EA poll; release/reuse a dirty slot; and resend an unknown broker outcome. Home-grown
checker and mutation code must first fail against known-bad controls and prove every mutant executed.

Independent verification is planned after the final source state because this is Tier 3. It must use
the `old-coder` verifier protocol in a fresh context and fix nothing itself. If no independent verifier
is available, EVIDENCE records `not performed` and the confidence downgrade; it is not called passed.

### Approval phrase

Approve this exact revision with:

`Duyet SPEC Revision 15 full bare-metal managed MT5 EA flow`

### Revision 15 approval

- Proposed on 2026-08-21 after the user selected full API-driven start, login, and automatic EA
  bootstrap on one Windows Server without Hyper-V.
- **Obtained.** The user explicitly approved this exact revision with
  `Duyet SPEC Revision 15 full bare-metal managed MT5 EA flow` on 2026-08-21.

### Revision 15 independent-verification round 1 grading

- Round 1 independently verified the frozen source state at commit
  `5a61554c2255d18e0162c6dd9b71e8244ec6eb4a` with task-tree aggregate SHA-256
  `17d356b47458180d6609675631b962b93ed39a0033a2ff89a99ceca926f1bd47` and returned
  `FAIL - Grade F`.
- The eight material findings were: disconnect fencing/idempotency, post-handoff credential
  retention, reservation crash recovery, worker-consume authentication, managed pairing
  slot/PID/gateway binding, unattended EA topology installation/attestation, raw short-login
  persistence, and fail-open changed-line coverage/mutation evidence.
- **Human grading obtained.** On 2026-08-22 the user explicitly classified all eight findings as
  behavioral blockers and approved fixing them followed by independent-verification round 2.
- These fixes implement already-approved R15 requirements and negative constraints; they do not
  expand the task contract, dependencies, production authority, or R15-9 authorization.

### Revision 16 proposal: bundled LLVM changed-line coverage tooling

- **Status: proposed; approval not yet obtained.** No package installation or toolchain mutation is
  authorized by Revision 15, so implementation remains paused before this environment change.
- Package/component: Rust-distributed `llvm-tools-preview` for the exact active toolchain
  `stable-x86_64-pc-windows-msvc`, `rustc 1.97.1 (8bab26f4f68e0e26f0bb7960be334d5b520ea452,
  2026-07-14)`, LLVM `22.1.6`. The exact installation command is:
  `rustup component add llvm-tools-preview --toolchain stable-x86_64-pc-windows-msvc`.
- License: LLVM tooling is `Apache-2.0 WITH LLVM-exception`; authoritative license and tool guidance
  are https://llvm.org/docs/DeveloperPolicy.html and
  https://doc.rust-lang.org/rustc/instrument-coverage.html.
- Purpose: supply the toolchain-matched `llvm-profdata` and `llvm-cov` executables needed to merge
  Rust instrumentation profiles and export a machine-checked LCOV report. No runtime application
  dependency is added.
- Capability: installation permits `rustup` to download the signed component from its configured
  Rust distribution server and write it only into the selected local Rust toolchain. During the
  gauntlet, the tools may read task-built instrumented test binaries, `.profraw` profiles, and local
  source files, and may write coverage reports only under the task `.artifacts` root. They receive no
  broker credentials, Vault token, account data, production access, listener, service, or deploy
  authority.
- Repository impact: no `Cargo.toml`, `Cargo.lock`, Go module, npm lockfile, runtime image, migration,
  production script, or checked-in binary changes. The existing Go coverage tooling and the planned
  fail-closed changed-line parser require no new package.
- Audit and rollback: before and after installation, record `rustc -Vv`, the active toolchain, and
  `rustup component list --installed`; resolve the installed executable paths, record SHA-256 hashes
  and `--version` output, verify no dependency-manifest diff, and use only the persisted gauntlet
  entry point. If rollback is required, remove exactly this component with
  `rustup component remove llvm-tools-preview --toolchain stable-x86_64-pc-windows-msvc`.
- The coverage gate remains fail closed: missing/malformed/empty reports, zero coverable changed
  lines, any uncovered changed executable line, tool-version mismatch, or a failed negative control
  blocks completion. Approval does not authorize production operations or relax R15-9.

Approve only this environment change with:

`Duyet SPEC Revision 16 llvm-tools coverage component`

### Revision 16 approval

- Proposed on 2026-08-22 after independent-verification round 1 identified fail-open Rust
  changed-line coverage evidence and the exact toolchain lacked bundled LLVM coverage tools.
- **Obtained.** The user explicitly approved this exact environment-only revision with
  `Duyet SPEC Revision 16 llvm-tools coverage component` on 2026-08-22.
