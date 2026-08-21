# MT5 VM local image automation

- Status: **repository automation and local broker-enrollment proof PASS; real Hyper-V image
  publication and worker registration pending host prerequisites**
- Updated: 21 August 2026
- Scope: the MarketLens-owned Windows worker pool, not an end user's computer

MarketLens users enter an MT5 login, master password, and exact server in the web product. They do
not install MT5 and the account-connect path must never run an installer, enable Hyper-V, build an
image, or clone a VM. Those are bounded operator actions performed when a worker image is built or
refreshed. A provisioned worker consumes one of at most four separately installed and attested MT5
terminal slots.

## What is implemented

- `Install-MT5VmTerminalSlots.ps1` verifies the installer SHA-256 and Authenticode signer before
  using MetaQuotes unattended `/auto` and `/path` arguments. It supports one to four distinct slots,
  requires explicit EULA acceptance, and attests each terminal, data profile, server catalog, and
  terminal license. Dry-run is the default.
- `Enroll-MT5VmServerCatalog.ps1` uses a protected current-user DPAPI credential only in memory and
  drives the official MT5 account UI by exact process and control identity. It requires an exact
  server match, verifies that the catalog was refreshed, and emits no login, password, or server.
- `Test-MT5VmImageManifest.ps1` rejects malformed hashes, paths, profiles, duplicate slots, and
  manifests outside the one-to-four-slot contract.
- `New-MT5VmGoldenImage.ps1`, `New-MT5VmHyperVWorker.ps1`, and `Enable-MT5VmHyperV.ps1` provide the
  transactional publication, bounded/coalesced clone, and explicit host-bootstrap policy cores.
  They fail closed while guest provisioning, image self-test, worker health, and private worker
  registration are not connected.

The disposable local proof used a clean MetaQuotes-signed terminal. Official broker-neutral server
enrollment, the safe Python/API bootstrap, and the FTMO plus Exness single/coexisting read-only
matrix passed. The older Exness `-10005` result remains useful RED history but is not the current
clean-slot verdict.

## Image-build workflow

Run these commands only on the image builder, never from a user account-connect request.

1. Pin the already-downloaded official installer by SHA-256 and signer. Review the dry run:

   ```powershell
   .\tools\mt5-vm-image\Install-MT5VmTerminalSlots.ps1 `
     -InstallerPath 'C:\path\to\mt5setup.exe' `
     -ExpectedInstallerSha256 '<64 hex characters>' `
     -ExpectedSignerPattern 'MetaQuotes' `
     -SlotRoot 'C:\MarketLens\MT5Slots' `
     -SlotCount 4 `
     -AcceptMetaQuotesEula
   ```

2. After reviewing the plan, repeat with `-Execute`. The command is idempotent only when every
   existing slot passes full attestation; a partial or untrusted slot fails closed.
3. Save each disposable bootstrap credential with
   `backend\bridge\mt5_vm\Save-MT5VmPhase0Credential.ps1`, using the local secure password prompt.
   Do not put a password in a command argument, environment variable, repository file, or image
   manifest.
4. Enroll each exact broker server through the official terminal UI:

   ```powershell
   .\tools\mt5-vm-image\Enroll-MT5VmServerCatalog.ps1 `
     -TerminalPath 'C:\MarketLens\MT5Slots\slot-01\terminal64.exe' `
     -AccountAlias '<safe-local-alias>' `
     -CompanySearchLabel '<official company label>'
   ```

5. Run the safe terminal bootstrap and the regression gauntlet. Keep the terminal path and alias
   as runtime data; do not add broker-name branches to reusable code.
6. Build and publish a generalized VHDX only after guest provisioning, attestation, and self-test
   boundaries are connected. Publication is transactional: a failed stage must not become a golden
   image.
7. Clone a worker only from an attested golden VHDX. Registration is last and occurs only after the
   worker health gate passes.

## Host prerequisites still required

The current local host reports a hypervisor but has no Hyper-V management service/module, and no
operator-supplied generalized base VHDX or virtual switch was provided. Before a real worker can be
published, an operator must provide:

- Hyper-V management and an explicit reboot window if the feature must be enabled;
- a generalized Windows base VHDX and virtual switch;
- separate staging, published-image, and worker roots;
- CPU, memory, maximum-worker, and minimum-free-disk policy;
- guest provisioning plus image attestation/self-test integration;
- worker health and private registration integration.

`Enable-MT5VmHyperV.ps1` changes nothing unless both `-EnableHyperV` and `-AllowReboot` are supplied,
and refuses the change while a trading worker is running. The worker scaler defaults to dry-run,
coalesces the same capacity generation, caps the worker count, checks disk capacity, and never
registers an unhealthy clone.

## Verification

The single rerunnable local gate is:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
  .\tools\run-mt5-vm-powershell-regression-gauntlet.ps1 `
  -IncludeRealExnessProbe -IncludeRealReadonlyMatrix
```

The fresh 21 August run passed 96 Python tests, 14 PowerShell parse checks, 26 mutation controls,
the secret and process-argument gates, the clean-terminal bootstrap, and both single/coexisting
read-only rows. Full sanitized evidence and limitations are in
`agent-evidence/mt5-vm-local-image-automation/EVIDENCE.md`.
