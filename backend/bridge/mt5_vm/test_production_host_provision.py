"""V40 contracts: actual PowerShell logic, disposable files, external boundaries only."""
from __future__ import annotations

import os
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
PRELUDE = r'''
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repoRoot = $env:V40_REPO
$maximumCommonIniBytes = 1048576
foreach ($relative in @('tools/mt5-baremetal/Invoke-MT5WebRequestProbe.ps1',
    'tools/Install-ProductionManagedWorker.ps1',
    'tools/verify-production-worker-host-provision.ps1',
    'tools/mt5-baremetal/Set-MT5WebRequestAllowlist.ps1',
    'tools/mt5-baremetal/MT5ProvisioningState.ps1')) {
  $file = Join-Path $repoRoot $relative
  if (-not (Test-Path -LiteralPath $file)) { continue }
  $errors = $null
  $ast = [Management.Automation.Language.Parser]::ParseFile($file, [ref]$null, [ref]$errors)
  if ($errors.Count) { throw 'FIXTURE_PARSE_FAILED' }
  foreach ($node in $ast.FindAll({param($n)
      $n -is [Management.Automation.Language.FunctionDefinitionAst]}, $false)) {
    . ([scriptblock]::Create($node.Extent.Text))
  }
}
function Require([bool]$ok, [string]$why = 'V40_ASSERTION') { if (-not $ok) { throw $why } }
function EqualBytes([byte[]]$a, [byte[]]$b) {
  Require ([Convert]::ToBase64String($a) -ceq [Convert]::ToBase64String($b)) 'BYTES_CHANGED'
}
function Fixture([string]$enabled, [string]$value) {
  return ,(New-ProductionUtf16LeBomBytes -Text (
    "[General]`r`nKeep=original`r`n[Experts]`r`nWebRequest=$enabled`r`nWebRequestUrl=$value`r`n"))
}
$path = Join-Path $env:V40_TEMP 'fixture.env'
$slotInputRoot = Join-Path $env:V40_TEMP 'slot'
$gatewayOrigin = 'http://127.0.0.1'
$script:AutoInstallUtf8 = New-Object Text.UTF8Encoding($false, $true)
'''


class ProductionHostProvisionTests(unittest.TestCase):
    def run_contract(self, body: str) -> subprocess.CompletedProcess[str]:
        artifacts = ROOT / '.artifacts/production-worker-host-provision/v40'
        artifacts.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='contract-', dir=artifacts) as directory:
            script = Path(directory) / 'contract.ps1'
            script.write_text(PRELUDE + body, encoding='utf-8')
            return subprocess.run(
                ['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy',
                 'Bypass', '-File', str(script)], cwd=ROOT,
                env={**os.environ, 'V40_REPO': str(ROOT), 'V40_TEMP': directory},
                capture_output=True, text=True, timeout=60, check=False)

    def check(self, body: str) -> None:
        result = self.run_contract(body + "\n'V40_CONTRACT=PASS'\n")
        self.assertEqual(0, result.returncode, result.stderr + result.stdout)
        self.assertIn('V40_CONTRACT=PASS', result.stdout)

    def test_dotenv_update_preserves_bytes_and_acl(self) -> None:
        self.check(r'''
foreach ($bom in @($false, $true)) {
 foreach ($nl in @("`n", "`r`n")) {
  foreach ($end in @('', $nl)) {
   foreach ($value in @('new', '$1${name}\literal', 'C:\fixture\a b')) {
    $text = '# keep' + $nl + 'EXECUTION_MT5_VM_BOOTSTRAP_TOKEN=old' + $nl + 'LAST=x' + $end
    $encoding = New-Object Text.UTF8Encoding($false, $true)
    $bytes = $encoding.GetBytes($text)
    $expected = $encoding.GetBytes($text.Replace('TOKEN=old', ('TOKEN=' + $value)))
    if ($bom) { $bytes = [byte[]](239,187,191) + $bytes; $expected = [byte[]](239,187,191) + $expected }
    [IO.File]::WriteAllBytes($path, $bytes)
    $sddl = (Get-Acl -LiteralPath $path).Sddl
    Set-DotEnvValues -Path $path -Assignments @{EXECUTION_MT5_VM_BOOTSTRAP_TOKEN=$value}
    EqualBytes $expected ([IO.File]::ReadAllBytes($path))
    Require ((Get-Acl -LiteralPath $path).Sddl -ceq $sddl) 'ACL_CHANGED'
   }
  }
 }
}
''')

    def test_dotenv_rejects_malformed_duplicate_and_invalid_encoding(self) -> None:
        self.check(r'''
foreach ($text in @("EXECUTION_MT5_VM_BOOTSTRAP_TOKEN=x`nEXECUTION_MT5_VM_BOOTSTRAP_TOKEN=y",
 'EXECUTION_MT5_VM_BOOTSTRAP_TOKEN invalid')) {
 [IO.File]::WriteAllText($path, $text)
 $bytes = [IO.File]::ReadAllBytes($path)
 $caught = $false
 try { Set-DotEnvValues -Path $path -Assignments @{EXECUTION_MT5_VM_BOOTSTRAP_TOKEN='new'} } catch { $caught = $true }
 Require $caught 'MALFORMED_ACCEPTED'
 EqualBytes $bytes ([IO.File]::ReadAllBytes($path))
}
[IO.File]::WriteAllBytes($path, [byte[]](255,254,255))
$caught = $false
try { Set-DotEnvValues -Path $path -Assignments @{EXECUTION_MT5_VM_BOOTSTRAP_TOKEN='new'} } catch { $caught = $true }
Require $caught 'ENCODING_ACCEPTED'
''')

    def test_default_allowlist_never_calls_ui(self) -> None:
        self.check(r'''
[IO.File]::WriteAllBytes($path, (Fixture '0' ''))
$caught = ''
try {
 Invoke-ProductionNativeAllowlistTransaction -CommonIniPath $path -PreconditionAction {} `
  -ProbeAction { throw 'UNEXPECTED_PROBE' } -ApplyAction { throw 'UI_CALLED' } -QuiesceAction {}
} catch { $caught = $_.Exception.Message }
Require ($caught -ceq 'PROVISIONING_WEBREQUEST_ALLOWLIST_REQUIRED') $caught
[IO.File]::WriteAllBytes($path, (Fixture '1' 'AABB'))
$caught = ''
try {
 Invoke-ProductionNativeAllowlistTransaction -CommonIniPath $path -PreconditionAction {} -ProvenanceAction {} `
  -ProbeAction { throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_REQUIRED' } -ApplyAction { throw 'UI_CALLED' } -QuiesceAction {}
} catch { $caught = $_.Exception.Message }
Require ($caught -ceq 'PROVISIONING_WEBREQUEST_ALLOWLIST_REQUIRED') $caught
''')

    def test_commit_rollback_trace_is_offline(self) -> None:
        self.check(r'''
$bytes = Fixture '0' ''
[IO.File]::WriteAllBytes($path, $bytes)
$sddl = (Get-Acl -LiteralPath $path).Sddl
$result = Invoke-ProductionNativeAllowlistTransaction -CommonIniPath $path -PreconditionAction {} `
 -ProbeAction { throw 'OFFLINE_PROBE_CALLED' } -ApplyAction { throw 'OFFLINE_UI_CALLED' } `
 -QuiesceAction { throw 'OFFLINE_PROCESS_CALLED' } -RollbackOnSuccess
Require ($result.snapshot_verified -and $result.restored_prior -and -not $result.permission_verified)
EqualBytes $bytes ([IO.File]::ReadAllBytes($path))
Require ((Get-Acl -LiteralPath $path).Sddl -ceq $sddl)
Require (-not (Test-Path -LiteralPath ($path + '.marketlens-native.bak')))
''')

    def test_host_input_bundle_refuses_conflicts_and_adopts_exact_state(self) -> None:
        self.check(r'''
$null = [IO.Directory]::CreateDirectory($slotInputRoot)
$attestation = Join-Path $slotInputRoot 'webrequest-attestation.json'
[IO.File]::WriteAllText($attestation, 'unknown-existing')
$bytes = [IO.File]::ReadAllBytes($attestation)
$caught = $false
try { Write-ProvenTopologyInputs | Out-Null } catch { $caught = $true }
Require $caught 'CONFLICT_ACCEPTED'
EqualBytes $bytes ([IO.File]::ReadAllBytes($attestation))
Require (-not (Test-Path -LiteralPath (Join-Path $slotInputRoot 'chart01.chr'))) 'PARTIAL_BUNDLE'
''')

    def test_attempt_report_cannot_reuse_old_pass(self) -> None:
        self.check(r'''
$reportRoot = $env:V40_TEMP
$reportPath = Join-Path $reportRoot 'report.json'
$expectedLayers = @('first', 'second')
$script:layerResults = [Collections.Generic.List[object]]::new()
$script:layerResults.Add([pscustomobject]@{name='first';status='PASS'})
$caught = $false
try { Write-GauntletReport -Status 'PASS' } catch { $caught = $true }
Require $caught 'INCOMPLETE_PASS_ACCEPTED'
Write-GauntletReport -Status 'FAIL'
Require (((Get-Content -Raw $reportPath) | ConvertFrom-Json).status -ceq 'FAIL')
''')

    def test_explicit_configuration_requires_empty_prior_and_live_proof(self) -> None:
        self.check(r'''
foreach ($enabled in @('0','1')) {
 [IO.File]::WriteAllBytes($path, (Fixture $enabled 'AABB'))
 $caught = ''
 try {
  Invoke-ProductionNativeAllowlistTransaction -CommonIniPath $path -ConfigureNativeAllowlist `
   -PreconditionAction {} -ApplyAction { throw 'UI_MUST_NOT_RUN' } `
   -ProbeAction { return $true } -QuiesceAction {} | Out-Null
 } catch { $caught = $_.Exception.Message }
 Require ($caught -ceq 'PROVISIONING_NATIVE_INITIAL_STATE_UNPROVEN') $caught
}
''')

    def test_configuration_provenance_rejects_unknown_or_stale_state(self) -> None:
        self.check(r'''
Require ($null -ne (Get-Command Assert-ProvisionProvenance -ErrorAction SilentlyContinue)) 'PROVENANCE_GUARD_MISSING'
$terminal = Join-Path $env:V40_TEMP 'terminal.exe'
[IO.File]::WriteAllText($terminal, 'signed-fixture-boundary')
[IO.File]::WriteAllBytes($path, (Fixture '1' 'AABB'))
$proof = [ordered]@{schema_version=1;terminal_path=$terminal;
 terminal_sha256=(Get-FileHash $terminal).Hash.ToLowerInvariant();state_root=$env:V40_TEMP;
 native_config_sha256=(Get-FileHash $path).Hash.ToLowerInvariant();allowed_origin='http://127.0.0.1';
 initial_state='empty-disabled';receipt_sha256=('a'*64);source_commit=('b'*40)}
$provenance = Join-Path $env:V40_TEMP 'provenance.json'
foreach ($kind in @('valid','unknown','duplicate','config','source','receipt','origin','acl')) {
 $text = $proof | ConvertTo-Json -Compress
 switch ($kind) {
  'unknown' { $text = $text.TrimEnd('}') + ',"unexpected":1}' }
  'duplicate' { $text = $text.TrimEnd('}') + ',"schema_version":1}' }
  'config' { $text = $text.Replace($proof.native_config_sha256, ('c'*64)) }
  'source' { $text = $text.Replace(('b'*40), ('d'*40)) }
  'receipt' { $text = $text.Replace(('a'*64), 'malformed') }
  'origin' { $text = $text.Replace('http://127.0.0.1', 'http://evil.invalid') }
 }
 [IO.File]::WriteAllText($provenance, $text)
 [IO.File]::SetAccessControl($provenance, (New-ProvisionAcl))
 if ($kind -ceq 'acl') {
  $acl = Get-Acl $provenance
  $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule('Everyone','Read','Allow')))
  [IO.File]::SetAccessControl($provenance, $acl)
 }
 $caught = $false
 try { Assert-ProvisionProvenance -Path $provenance -TerminalPath $terminal -StateRoot $env:V40_TEMP `
   -ConfigPath $path -SourceCommit ('b'*40) } catch { $caught = $true }
 Require ($caught -eq ($kind -cne 'valid')) ('PROVENANCE_CASE_' + $kind)
}
''')

    def test_restricted_writes_protect_payload_from_creation(self) -> None:
        self.check(r'''
$parent = Join-Path $env:V40_TEMP 'protected'
Ensure-ProvisionDirectory $parent
$file = Join-Path $parent 'payload'
Set-ProvisionFileBytes $file ([byte[]](1,2,3))
Assert-ProvisionAcl $file
foreach ($kind in @('missing','extra','denied','inherited')) {
 $acl = New-ProvisionAcl
 switch ($kind) {
  'missing' { $acl.PurgeAccessRules((New-Object Security.Principal.SecurityIdentifier('S-1-5-18'))) }
  'extra' { $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule('Everyone','Read','Allow'))) }
  'denied' { $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule('Everyone','Read','Deny'))) }
  'inherited' { $acl.SetAccessRuleProtection($false,$true) }
 }
 [IO.File]::SetAccessControl($file, $acl)
 $caught=$false
 try { Assert-ProvisionAcl $file } catch { $caught=$true }
 Require $caught ('ACL_CASE_' + $kind)
}
''')

    def test_bundle_round_trip_and_partial_failure_rollback(self) -> None:
        self.check(r'''
$bundle = [ordered]@{}
$bundle[(Join-Path $slotInputRoot 'a')] = [byte[]](1,2)
$bundle[(Join-Path $slotInputRoot 'b')] = [byte[]](3,4)
Write-ProvisionBundle $bundle
Write-ProvisionBundle $bundle
foreach ($file in $bundle.Keys) { EqualBytes $bundle[$file] ([IO.File]::ReadAllBytes($file)); Assert-ProvisionAcl $file }
$first = @($bundle.Keys)[0]
$caught=$false
try { Set-ProvisionFileBytes $first ([byte[]](9,9)) } catch { $caught=$true }
Require $caught 'CONFLICT_OVERWRITTEN'
EqualBytes $bundle[$first] ([IO.File]::ReadAllBytes($first))
''')

    def test_two_probe_receipts_bind_same_profile_before_publication(self) -> None:
        self.check(r'''
Require ($null -ne (Get-Command Assert-ProvisionProofPair -ErrorAction SilentlyContinue)) 'PROOF_PAIR_GUARD_MISSING'
$now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$first = [pscustomobject]@{status='PASS';terminal_path='C:\fixture\terminal.exe';terminal_sha256=('a'*64);
 native_config_sha256=('b'*64);probe_url='http://127.0.0.1/health';nonce_sha256=('c'*64);
 receipt_sha256=('d'*64);requested_at_unix=$now;observed_at_unix=$now}
foreach ($kind in @('valid','nonce','receipt','config','terminal','stale','url','failed')) {
 $second = ($first | ConvertTo-Json | ConvertFrom-Json)
 $second.nonce_sha256='e'*64; $second.receipt_sha256='f'*64
 switch ($kind) {
  'nonce' { $second.nonce_sha256=$first.nonce_sha256 }
  'receipt' { $second.receipt_sha256=$first.receipt_sha256 }
  'config' { $second.native_config_sha256='e'*64 }
  'terminal' { $second.terminal_path='C:\other.exe' }
  'stale' { $second.requested_at_unix=$now-1000 }
  'url' { $second.probe_url='http://evil.invalid' }
  'failed' { $second.status='FAIL' }
 }
 $caught=$false
 try { Assert-ProvisionProofPair $first $second $now } catch { $caught=$true }
Require ($caught -eq ($kind -cne 'valid')) ('PAIR_CASE_'+$kind)
}
''')

    def test_full_flow_stops_at_each_failed_boundary(self) -> None:
        self.check(r'''
Require ($null -ne (Get-Command Invoke-ProvisionHostFlow -ErrorAction SilentlyContinue)) 'HOST_FLOW_MISSING'
$stages = @('Preflight','Proofs','Prepare','DryRun','Audit','Runner','Postconditions')
foreach ($fail in @('none') + $stages) {
 $events = [Collections.Generic.List[string]]::new()
 $actions = @{}
 foreach ($stage in $stages) {
  $actions[$stage] = { $events.Add($stage); if ($stage -ceq $fail) { throw 'INJECTED_STAGE_FAILURE' } }.GetNewClosure()
 }
 $actions.Rollback = { $events.Add('Rollback') }
 $actions.Complete = { $events.Add('Complete') }
 $caught=''
 try { Invoke-ProvisionHostFlow $actions } catch { $caught=$_.Exception.Message }
 if ($fail -ceq 'none') { Require (($events -join ',') -ceq (($stages + 'Complete') -join ',')) }
 else {
  Require ($caught -ceq 'INJECTED_STAGE_FAILURE') $caught
  $index = [Array]::IndexOf($stages,$fail)
  $expected = @($stages[0..$index])
  if ($index -lt 5) { $expected += 'Rollback' }
  Require (($events -join ',') -ceq ($expected -join ',')) ('FLOW_' + $fail)
 }
}
''')

    def test_source_gate_precedes_host_mutation(self) -> None:
        self.check(r'''
$source = [IO.File]::ReadAllText((Join-Path $repoRoot 'tools/verify-production-worker-host-provision.ps1'))
Require ($source.Contains('Assert-ProvisionSelectedHost')) 'HOST_PREFLIGHT_MISSING'
Require ($source.Contains('PROVISIONING_SOURCE_CHANGED_DURING_RUNNER')) 'PULL_DRIFT_GUARD_MISSING'
Require (-not $source.Contains('Remove-Item -LiteralPath $reportRoot -Recurse -Force')) 'HISTORY_ERASED'
Require ($source.Contains('[switch]$CodeTestsOnly')) 'CODE_MODE_MISSING'
''')

    def test_preparation_dry_run_and_adoption_preserve_installer_contract(self) -> None:
        self.check(r'''
Require ($null -ne (Get-Command Assert-ProvisionInstallerPlan -ErrorAction SilentlyContinue)) 'INSTALLER_PLAN_GUARD_MISSING'
foreach ($case in @('fresh','adopted','fake','installed','badbool')) {
 $value = [pscustomobject]@{status='DRY_RUN';installed=$false;receipt_path=''}
 switch ($case) {
  'adopted' { $value.status='ADOPTED';$value.installed=$false;$value.receipt_path='C:\worker\managed-worker-installation.json' }
  'fake' { $value.status='ADOPTED';$value.installed=$true }
  'installed' { $value.status='INSTALLED';$value.installed=$true }
  'badbool' { $value.installed='false' }
 }
 $caught=$false
 try { Assert-ProvisionInstallerPlan $value } catch { $caught=$true }
 Require ($caught -eq ($case -notin @('fresh','adopted'))) ('PLAN_' + $case)
}
''')

    def test_receipt_persistence_preserves_bom_crlf_and_literals(self) -> None:
        self.check(r'''
$text = "KEEP=x`r`nEXECUTION_MT5_MANAGED_WORKER_RECEIPT_FILE=C:\old\receipt.json`r`nLAST=z"
$bytes = [byte[]](239,187,191) + [Text.Encoding]::UTF8.GetBytes($text)
[IO.File]::WriteAllBytes($path,$bytes)
$sddl=(Get-Acl $path).Sddl
$receipt='C:\fixture\$1\receipt.json'
$null=Set-ProductionManagedWorkerReceiptEnvBoundary -BackendEnvPath $path -ReceiptPath $receipt
$expected=[byte[]](239,187,191) + [Text.Encoding]::UTF8.GetBytes($text.Replace('C:\old\receipt.json',$receipt))
EqualBytes $expected ([IO.File]::ReadAllBytes($path))
Require ((Get-Acl $path).Sddl -ceq $sddl)
''')

    def test_journal_restores_owned_bytes_acl_and_preserves_unknown_files(self) -> None:
        self.check(r'''
[IO.File]::WriteAllText($path,'EXECUTION_MT5_VM_BOOTSTRAP_TOKEN=original')
$bytes=[IO.File]::ReadAllBytes($path); $sddl=(Get-Acl $path).Sddl
$newFile=Join-Path $slotInputRoot 'created'
$unknown=Join-Path $slotInputRoot 'concurrent'
$script:ProvisionJournal=New-ProvisionJournal @($path,$newFile,$unknown) (Join-Path $env:V40_TEMP 'journal')
Set-ProvisionDotEnv $path @{EXECUTION_MT5_VM_BOOTSTRAP_TOKEN='changed'}
Set-ProvisionFileBytes $newFile ([byte[]](1,2,3))
[IO.File]::WriteAllText($unknown,'not-run-owned')
Restore-ProvisionJournal $script:ProvisionJournal
EqualBytes $bytes ([IO.File]::ReadAllBytes($path))
Require ((Get-Acl $path).Sddl -ceq $sddl)
Require (-not (Test-Path $newFile))
Require ([IO.File]::ReadAllText($unknown) -ceq 'not-run-owned') 'UNKNOWN_FILE_DELETED'
''')

    def test_actual_prepared_input_is_single_slot_and_strictly_parsed(self) -> None:
        self.check(r'''
$selectedTerminal=Join-Path $env:V40_TEMP 'terminal/terminal64.exe'
$selectedStateRoot=Join-Path $env:V40_TEMP 'state'
$repoRoot=Join-Path $env:V40_TEMP 'repo'
$installInputPath=Join-Path $slotInputRoot 'install.json'
$bootstrapTokenPath=Join-Path $slotInputRoot 'token'
$workerRoot=Join-Path $env:V40_TEMP 'worker'; $workerDataRoot=Join-Path $env:V40_TEMP 'runtime'
$selectedIdentity=[Security.Principal.WindowsIdentity]::GetCurrent().Name
$expectedOrigin='http://127.0.0.1'; $taskName='MarketLens MT5 Worker'; $workerId='marketlens-baremetal-01'
foreach ($file in @($selectedTerminal, (Join-Path (Split-Path $selectedTerminal) 'Config/terminal.lic'),
 (Join-Path $selectedStateRoot 'Config/servers.dat'), (Join-Path $repoRoot 'frontend/public/downloads/MarketLensExecutionEA.ex5'))) {
 $null=[IO.Directory]::CreateDirectory((Split-Path $file));[IO.File]::WriteAllText($file,'fixture-artifact')
}
$null=Write-ProvenTopologyInputs
$inputObject=Prepare-ManagedWorkerInstallInput
Require (@($inputObject.terminal_slots).Count -eq 1)
$python=Join-Path $env:V40_REPO 'backend/.venv-mt5/Scripts/python.exe'
$parsed=Read-ProductionManagedWorkerInstallInputBoundary -Path $installInputPath -PythonPath $python
Require ($parsed.terminal_slots[0].terminal_sha256 -ceq (Get-FileHash $selectedTerminal).Hash.ToLowerInvariant())
$bad=[IO.File]::ReadAllText($installInputPath).TrimEnd('}') + ',"schema_version":1}'
[IO.File]::WriteAllText($installInputPath,$bad)
$caught=$false
try { Read-ProductionManagedWorkerInstallInputBoundary -Path $installInputPath -PythonPath $python } catch { $caught=$true }
Require $caught 'DUPLICATE_INSTALL_INPUT_ACCEPTED'
''')

    def test_full_server_negative_controls_use_actual_error_codes(self) -> None:
        self.check(r'''
$allowlistDriver=Join-Path $repoRoot 'tools/mt5-baremetal/Set-MT5WebRequestAllowlist.ps1'
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $repoRoot 'tools/verify-production-worker-host-provision.ps1'),[ref]$null,[ref]$null)
$controls=@($ast.FindAll({param($n)
 $n -is [Management.Automation.Language.CommandAst] -and $n.GetCommandName() -ceq 'Assert-PowerShellKnownBad' -and
 $n.Extent.Text.Contains('$allowlistDriver')},$true))
Require ($controls.Count -eq 5)
foreach ($control in $controls) { . ([scriptblock]::Create($control.Extent.Text)) }
''')

    def test_provenance_publication_failure_restores_native_settings(self) -> None:
        self.check(r'''
$bytes=Fixture '0' ''
[IO.File]::WriteAllBytes($path,$bytes)
$caught=''
try {
 Invoke-ProductionNativeAllowlistTransaction -CommonIniPath $path -ConfigureNativeAllowlist `
  -PreconditionAction {} -ApplyAction { [IO.File]::WriteAllBytes($path,(Fixture '1' 'AABB')) } `
  -ProbeAction { return $true } -QuiesceAction {} `
  -CommitAction { throw 'INJECTED_PROVENANCE_WRITE' } | Out-Null
} catch { $caught=$_.Exception.Message }
Require ($caught -ceq 'INJECTED_PROVENANCE_WRITE') $caught
EqualBytes $bytes ([IO.File]::ReadAllBytes($path))
Require (-not (Test-Path ($path + '.marketlens-native.bak')))
''')

    def test_historical_receipt_hash_requires_retained_actual_receipt(self) -> None:
        self.check(r'''
Require ($null -ne (Get-Command Assert-ProvisionHistoricalReceipt -ErrorAction SilentlyContinue)) 'RECEIPT_HASH_GUARD_MISSING'
$nonce='a'*32
$receiptPath=Join-Path $env:V40_TEMP ('webrequest-probe-'+$nonce+'.json')
$receipt=[ordered]@{schemaVersion=1;nonce=$nonce;url='http://127.0.0.1/health';httpStatus=200;mt5Error=0;
 terminalBuild=6140;requestedAtUnix=100;observedAtUnix=101;responseOk=$true;responseService=$true;responseProtocol=$true;probeSucceeded=$true}
[IO.File]::WriteAllText($receiptPath,($receipt|ConvertTo-Json -Compress))
$hash=(Get-FileHash $receiptPath).Hash.ToLowerInvariant()
Assert-ProvisionHistoricalReceipt -Directory $env:V40_TEMP -Hash $hash
[IO.File]::WriteAllText($receiptPath,'tampered')
$caught=$false
try { Assert-ProvisionHistoricalReceipt -Directory $env:V40_TEMP -Hash $hash } catch { $caught=$true }
Require $caught 'HISTORICAL_RECEIPT_MISSING_ACCEPTED'
''')

    def test_selected_host_gateway_preflight_rejects_foreign_listener(self) -> None:
        self.check(r'''
$selectedIdentity=[Security.Principal.WindowsIdentity]::GetCurrent().Name
$selectedTerminal=Join-Path $env:V40_TEMP 'terminal/terminal64.exe'
$selectedProfile=Join-Path $env:V40_TEMP 'profile'
$commonIniRelativePath='config/common.ini';$expectedPublisher='fixture-signer'
$allowlistDriver=Join-Path $env:V40_REPO 'tools/mt5-baremetal/Set-MT5WebRequestAllowlist.ps1'
$probeDriver=Join-Path $env:V40_REPO 'tools/mt5-baremetal/Invoke-MT5WebRequestProbe.ps1'
$repoRoot=Join-Path $env:V40_TEMP 'repo'
foreach ($file in @($selectedTerminal,(Join-Path $selectedProfile $commonIniRelativePath),(Join-Path $repoRoot 'backend/bin/execution-gateway.exe'))) {
 $null=[IO.Directory]::CreateDirectory((Split-Path $file));[IO.File]::WriteAllText($file,'fixture')
}
[IO.File]::WriteAllText((Join-Path $selectedProfile 'origin.txt'),(Split-Path $selectedTerminal))
function Get-AuthenticodeSignature { [pscustomobject]@{Status=[Management.Automation.SignatureStatus]::Valid;SignerCertificate=[pscustomobject]@{Subject=$expectedPublisher}} }
function Get-CimInstance { @() }
function Get-NetTCPConnection { [pscustomobject]@{LocalAddress='127.0.0.1';OwningProcess=42} }
function Get-Process { [pscustomobject]@{Path=$ownerPath} }
function Invoke-RestMethod { [pscustomobject]@{ok=$true;service='execution-gateway';protocolVersion=1} }
$ownerPath=Join-Path $repoRoot 'backend/bin/execution-gateway.exe'
Assert-ProvisionSelectedHost
$ownerPath=Join-Path $env:V40_TEMP 'foreign.exe'
$caught=''
try { Assert-ProvisionSelectedHost } catch { $caught=$_.Exception.Message }
Require ($caught -ceq 'PROVISIONING_GATEWAY_LISTENER_MISMATCH') $caught
''')

    def test_successful_probes_record_owned_proxy_for_later_rollback(self) -> None:
        self.check(r'''
$ConfigureNativeAllowlist=$false
$allowlistDriver='fixture-child-boundary'
$script:hostProxyCreated=$false
$script:hostJournal=$null
$script:probeCalls=0
$script:removals=0
$selectedTerminal=Join-Path $env:V40_TEMP 'terminal.exe'
$proofRoot=Join-Path $env:V40_TEMP 'proofs'
Ensure-ProvisionDirectory $proofRoot
function powershell.exe {
 $script:probeCalls++
 $now=[DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
 $nonce=if ($script:probeCalls -eq 1) {'a'*64} else {'b'*64}
 $hash=if ($script:probeCalls -eq 1) {'c'*64} else {'d'*64}
 $proof=[ordered]@{status='PASS';terminal_path=$selectedTerminal;terminal_sha256=('e'*64);
  native_config_sha256=('f'*64);probe_url='http://127.0.0.1/health';nonce_sha256=$nonce;
  receipt_sha256=$hash;requested_at_unix=$now;observed_at_unix=$now}
 $file=Join-Path $proofRoot ($script:probeCalls.ToString()+'.json')
 Set-ProvisionFileBytes $file ([Text.Encoding]::UTF8.GetBytes(($proof | ConvertTo-Json -Compress)))
 'PRODUCTION_WEBREQUEST_ALLOWLIST_PROOF='+$file
 $created=($script:probeCalls -eq 1)
 'PRODUCTION_WEBREQUEST_ALLOWLIST=PASS proxy_created='+$created+' status=UNCHANGED enabled=True probe_verified=True'
 $global:LASTEXITCODE=0
}
function Get-CimInstance { @() }
function Remove-ProductionOwnedLoopbackPortProxy { $script:removals++; return $true }
Invoke-ProvisionHostProofs
Require $script:hostProxyCreated 'PROXY_OWNERSHIP_LOST'
Require ($null -ne (Get-Command Undo-ProvisionHostPreparation -ErrorAction SilentlyContinue)) 'HOST_ROLLBACK_MISSING'
Undo-ProvisionHostPreparation
Undo-ProvisionHostPreparation
Require ($script:removals -eq 1 -and -not $script:hostProxyCreated) 'PROXY_ROLLBACK_NOT_EXACT'
''')


if __name__ == '__main__':
    unittest.main()
