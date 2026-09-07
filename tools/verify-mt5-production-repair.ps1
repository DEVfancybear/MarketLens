[CmdletBinding()]
param([switch]$KnownBadControl)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$exclude = @(& git -C $repo rev-parse --git-path info/exclude)
if ($LASTEXITCODE -ne 0 -or $exclude.Count -ne 1) { throw 'REPAIR_GIT_EXCLUDE_PATH_FAILED' }
$excludePath = if ([IO.Path]::IsPathRooted($exclude[0])) { $exclude[0] } else { Join-Path $repo $exclude[0] }
$excludeRule = '/.artifacts/mt5-production-repair/'
$excludeText = if (Test-Path -LiteralPath $excludePath) { [IO.File]::ReadAllText($excludePath) } else { '' }
if (-not (($excludeText -split '\r?\n') -ccontains $excludeRule)) {
  [IO.File]::AppendAllText($excludePath, "`n" + $excludeRule + "`n", (New-Object Text.UTF8Encoding($false)))
}
$python = Join-Path $repo 'backend\.venv-mt5\Scripts\python.exe'
$runRoot = Join-Path $repo ('.artifacts\mt5-production-repair\' + [guid]::NewGuid().ToString('N'))
$null = [IO.Directory]::CreateDirectory($runRoot)
$results = [Collections.Generic.List[object]]::new()
$probe = Join-Path $repo 'tools\mt5-baremetal\Invoke-MT5WebRequestProbe.ps1'
$allowlist = Join-Path $repo 'tools\mt5-baremetal\Set-MT5WebRequestAllowlist.ps1'
$verifier = Join-Path $repo 'tools\verify-production-worker-host-provision.ps1'
$uiHelper = Join-Path $repo 'backend\bridge\mt5_vm\Mt5VmTerminalUi.ps1'
$repairTests = 'backend.bridge.mt5_vm.test_production_webrequest_probe'

function Assert-Repair([bool]$Condition, [string]$Code) {
  if (-not $Condition) { throw $Code }
}

function Assert-RepairSecretsAbsent([string]$SourceText, [string[]]$Secrets) {
  foreach ($secret in $Secrets) {
    if ($SourceText.Contains($secret)) { throw 'REPAIR_SECRET_DETECTED' }
  }
}

function Invoke-RepairCommand {
  param([string]$Name, [string]$Executable, [string[]]$CommandArguments,
    [int]$ExpectedExit = 0, [string]$RequiredText = '')
  Write-Host "[$Name]" -ForegroundColor Cyan
  $out = Join-Path $runRoot ($Name + '.stdout.log')
  $err = Join-Path $runRoot ($Name + '.stderr.log')
  # Process arguments contain only controlled paths, switches, and test names.
  $quoted = @($CommandArguments | ForEach-Object {
    Assert-Repair (-not $_.Contains('"')) 'REPAIR_ARGUMENT_QUOTE_UNSUPPORTED'
    '"' + $_ + '"'
  })
  $process = Start-Process -FilePath $Executable -ArgumentList $quoted `
    -WorkingDirectory $repo -WindowStyle Hidden -PassThru -Wait `
    -RedirectStandardOutput $out -RedirectStandardError $err
  $output = [IO.File]::ReadAllText($out) + [IO.File]::ReadAllText($err)
  $pass = $process.ExitCode -eq $ExpectedExit -and
    ([string]::IsNullOrEmpty($RequiredText) -or $output.Contains($RequiredText))
  $results.Add([pscustomobject]@{
    name = $Name; pass = $pass; exit_code = $process.ExitCode
    expected_exit = $ExpectedExit; stdout = $out; stderr = $err
  })
  if (-not $pass) { throw "REPAIR_LAYER_FAILED:$Name" }
  return $output
}

function Invoke-RepairMutant {
  param([string]$Name, [string]$Path, [string]$Search, [string]$Replacement, [string]$Test)
  $bytes = [IO.File]::ReadAllBytes($Path)
  $hash = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
  $source = [Text.Encoding]::UTF8.GetString($bytes).Replace("`r`n", "`n")
  Assert-Repair ([regex]::Matches($source, [regex]::Escape($Search)).Count -eq 1) 'REPAIR_MUTANT_SOURCE_UNEXPECTED'
  try {
    $mutant = $source.Replace($Search, $Replacement)
    [IO.File]::WriteAllText($Path, $mutant, (New-Object Text.UTF8Encoding($false)))
    $mutantHash = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
    Assert-Repair ($mutantHash -cne $hash) 'REPAIR_MUTANT_NOT_APPLIED'
    $testName = if ($Test.StartsWith('backend.')) { $Test } else { $repairTests + '.' + $Test }
    $output = Invoke-RepairCommand -Name ('mutant-' + $Name) -Executable $python `
      -CommandArguments @('-m', 'unittest', $testName, '-v') `
      -ExpectedExit 1 -RequiredText 'FAILED (failures='
    Assert-Repair ($output.Contains(($Test -split '\.')[-1])) 'REPAIR_MUTANT_TEST_NOT_EXECUTED'
    $results.Add([pscustomobject]@{ name = 'mutant-proof-' + $Name; pass = $true; mutated_sha256 = $mutantHash })
  } finally {
    [IO.File]::WriteAllBytes($Path, $bytes)
    Assert-Repair ((Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash -ceq $hash) 'REPAIR_MUTANT_RESTORE_FAILED'
  }
}

$codeFiles = @(
  'tools/mt5-baremetal/Invoke-MT5WebRequestProbe.ps1',
  'tools/mt5-baremetal/MarketLensWebRequestProbe.mq5',
  'tools/mt5-baremetal/Set-MT5WebRequestAllowlist.ps1',
  'tools/verify-production-worker-host-provision.ps1',
  'tools/verify-mt5-production-repair.ps1',
  'backend/bridge/mt5_vm/test_production_webrequest_probe.py',
  'backend/bridge/mt5_vm/test_terminal_python_api_bootstrap.py',
  'backend/bridge/mt5_vm/Mt5VmTerminalUi.ps1'
)
$sourceHashes = @{}
foreach ($relative in $codeFiles) {
  $path = Join-Path $repo $relative
  $sourceHashes[$relative] = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
  if ($relative.EndsWith('.ps1')) {
    $errors = $null
    $null = [Management.Automation.Language.Parser]::ParseFile($path, [ref]$null, [ref]$errors)
    Assert-Repair ($errors.Count -eq 0) 'REPAIR_PARSE_FAILED'
  }
}
$gitHead = @(& git -C $repo rev-parse HEAD)
Assert-Repair ($LASTEXITCODE -eq 0 -and $gitHead.Count -eq 1) 'REPAIR_GIT_HEAD_FAILED'
$savedUtf8 = [Environment]::GetEnvironmentVariable('PYTHONUTF8', 'Process')
$status = 'FAIL'
try {
  [Environment]::SetEnvironmentVariable('PYTHONUTF8', '1', 'Process')
  if ($KnownBadControl) {
    Assert-RepairSecretsAbsent -SourceText 'repair-control-secret-0123456789' -Secrets @('repair-control-secret-0123456789')
    return
  }
  $null = Invoke-RepairCommand -Name 'python-version' -Executable $python -CommandArguments @('--version') -RequiredText 'Python '
  $compileSource = Join-Path $runRoot 'MarketLensWebRequestProbe.mq5'
  $compileLog = Join-Path $runRoot 'probe-compile.log'
  Copy-Item -LiteralPath (Join-Path $repo 'tools/mt5-baremetal/MarketLensWebRequestProbe.mq5') -Destination $compileSource
  $compiler = Start-Process -FilePath 'C:\Program Files\MetaTrader 5\metaeditor64.exe' `
    -ArgumentList @('/compile:"' + $compileSource + '"', '/log:"' + $compileLog + '"') `
    -WindowStyle Hidden -Wait -PassThru
  $probeAst = [Management.Automation.Language.Parser]::ParseFile($probe, [ref]$null, [ref]$null)
  foreach ($node in $probeAst.FindAll({ param($n)
      $n -is [Management.Automation.Language.FunctionDefinitionAst] -and
      $n.Name -in @('Assert-ProbeTrue', 'Assert-ProbeCompileResult')
    }, $false)) { . ([scriptblock]::Create($node.Extent.Text)) }
  Assert-ProbeCompileResult -ExitCode $compiler.ExitCode `
    -BinaryExists (Test-Path -LiteralPath ([IO.Path]::ChangeExtension($compileSource, '.ex5'))) `
    -CompileText ([IO.File]::ReadAllText($compileLog))
  $results.Add([pscustomobject]@{ name = 'mql-compile'; pass = $true; exit_code = $compiler.ExitCode; log = $compileLog })
  $null = Invoke-RepairCommand -Name 'focused-regressions' -Executable $python -CommandArguments @(
    '-m', 'unittest', '-v', 'backend.bridge.mt5_vm.test_terminal_python_api_bootstrap',
    $repairTests, 'backend.bridge.mt5_vm.test_baremetal_worker_install'
  ) -RequiredText 'OK'
  foreach ($item in @(
      [pscustomobject]@{ name = 'allowlist-contracts'; path = $allowlist; marker = 'PRODUCTION_WEBREQUEST_ALLOWLIST_CONTRACTS=PASS' },
      [pscustomobject]@{ name = 'probe-contracts'; path = $probe; marker = 'PRODUCTION_WEBREQUEST_PROBE_CONTRACTS=PASS' },
      [pscustomobject]@{ name = 'verifier-contracts'; path = $verifier; marker = 'PRODUCTION_WORKER_HOST_PROVISION_CONTRACTS=PASS' }
    )) {
    $null = Invoke-RepairCommand -Name $item.name -Executable 'powershell.exe' -CommandArguments @(
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $item.path, '-ContractTestsOnly'
    ) -RequiredText $item.marker
  }
  $null = Invoke-RepairCommand -Name 'probe-known-bad' -Executable 'powershell.exe' -CommandArguments @(
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $probe, '-ContractTestsOnly', '-KnownBadControl'
  ) -ExpectedExit 1 -RequiredText 'PROVISIONING_PROBE_RECEIPT_INVALID'
  $null = Invoke-RepairCommand -Name 'entrypoint-known-bad' -Executable 'powershell.exe' -CommandArguments @(
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $PSCommandPath, '-KnownBadControl'
  ) -ExpectedExit 1 -RequiredText 'REPAIR_SECRET_DETECTED'
  foreach ($mode in @('Allowlist', 'Probe', 'Mouse')) {
    $null = Invoke-RepairCommand -Name ('existing-' + $mode + '-mutations') -Executable 'powershell.exe' -CommandArguments @(
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $verifier, ('-' + $mode + 'MutationTestsOnly')
    ) -RequiredText 'MUTATION='
  }
  Invoke-RepairMutant -Name 'crlf' -Path $probe `
    -Search '$driverText = (Get-Content -LiteralPath $PSCommandPath -Raw).Replace("`r`n", "`n")' `
    -Replacement '$driverText = Get-Content -LiteralPath $PSCommandPath -Raw' `
    -Test 'ProductionWebRequestProbeTests.test_probe_contract_accepts_lf_and_crlf'
  Invoke-RepairMutant -Name 'skip-live-probe' -Path $allowlist `
    -Search '$verified = ((& $ProbeAction) -eq $true)' -Replacement '$verified = $true' `
    -Test 'ProductionRepairContractsTests.test_allowlist_preserves_opaque_profile_values'
  Invoke-RepairMutant -Name 'overwrite-native-value' -Path $allowlist `
    -Search '-ExpectedOrigin ''http://127.0.0.1'' -PreserveNativeValue' `
    -Replacement '-ExpectedOrigin ''http://127.0.0.1''' `
    -Test 'ProductionRepairContractsTests.test_allowlist_preserves_opaque_profile_values'
  Invoke-RepairMutant -Name 'rollback-acl' -Path $allowlist `
    -Search 'if ($PreserveNativeAcl) {' -Replacement 'if ($false) {' `
    -Test 'ProductionRepairContractsTests.test_probe_and_settings_failure_restore_owned_state'
  Invoke-RepairMutant -Name 'accept-unrelated-source' -Path $verifier `
    -Search 'Assert-Gate ($allowed -ccontains $path.Replace(''\'', ''/'')) ''PROVISIONING_UNAPPROVED_TRACKED_PATH''' `
    -Replacement '$null = $path' `
    -Test 'ProductionRepairContractsTests.test_source_guard_rejects_unrelated_change'
  Invoke-RepairMutant -Name 'stale-permission-receipt' -Path $probe `
    -Search 'Assert-ProbeTrue ([string]$Receipt.nonce -ceq $ExpectedNonce) ''PROVISIONING_PROBE_RECEIPT_INVALID''' `
    -Replacement '$null = $ExpectedNonce' `
    -Test 'ProductionRepairContractsTests.test_permission_failure_requires_fresh_receipt_identity'
  Invoke-RepairMutant -Name 'accept-malformed-native-switch' -Path $allowlist `
    -Search '$webGroup.Value -cnotin @(''0'', ''1'')' -Replacement '$false' `
    -Test 'ProductionRepairContractsTests.test_native_allowlist_rejects_hostile_inputs_before_actions'
  Invoke-RepairMutant -Name 'accept-opaque-rows-without-probe-contract' -Path $uiHelper `
    -Search 'if ($DeferPermissionProof -and $persisted.Enabled -eq 1 -and' `
    -Replacement 'if ($persisted.Enabled -eq 1 -and' `
    -Test 'backend.bridge.mt5_vm.test_terminal_python_api_bootstrap.TerminalPythonApiBootstrapTests.test_opaque_reopened_rows_require_explicit_probe_opt_in'
  Invoke-RepairMutant -Name 'local-clock-receipt' -Path (Join-Path $repo 'tools/mt5-baremetal/MarketLensWebRequestProbe.mq5') `
    -Search 'long observed_at_unix=(long)TimeGMT();' `
    -Replacement 'long observed_at_unix=(long)TimeLocal();' `
    -Test 'ProductionRepairContractsTests.test_receipt_clock_is_utc_and_rejects_local_timezone_offsets'

  $reverseRunner = Join-Path $runRoot 'reverse-tests.py'
  [IO.File]::WriteAllText($reverseRunner, @'
import sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path.cwd()))
def flatten(suite):
    for item in suite:
        if isinstance(item, unittest.TestSuite):
            yield from flatten(item)
        else:
            yield item
suite = unittest.defaultTestLoader.loadTestsFromNames([
    'backend.bridge.mt5_vm.test_production_webrequest_probe',
    'backend.bridge.mt5_vm.test_terminal_python_api_bootstrap.TerminalPythonApiBootstrapTests.test_opaque_reopened_url_rows_remain_pending_until_external_probe',
    'backend.bridge.mt5_vm.test_terminal_python_api_bootstrap.TerminalPythonApiBootstrapTests.test_opaque_reopened_rows_require_explicit_probe_opt_in',
    'backend.bridge.mt5_vm.test_terminal_python_api_bootstrap.TerminalPythonApiBootstrapTests.test_deferred_probe_does_not_accept_readable_wrong_url',
])
tests = list(flatten(suite))
if not tests:
    raise RuntimeError('EMPTY_REPAIR_SUITE')
result = unittest.TextTestRunner(verbosity=2).run(unittest.TestSuite(reversed(tests)))
sys.exit(0 if result.wasSuccessful() else 1)
'@, (New-Object Text.UTF8Encoding($false)))
  $null = Invoke-RepairCommand -Name 'reverse-order-restored-regressions' -Executable $python -CommandArguments @($reverseRunner) -RequiredText 'OK'
  $null = Invoke-RepairCommand -Name 'diff-check' -Executable 'git.exe' -CommandArguments @('-C', $repo, 'diff', '--check')
  $null = Invoke-RepairCommand -Name 'backend-docs' -Executable 'powershell.exe' -CommandArguments @(
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $repo 'tools\verify-backend-docs.ps1'), '-DocsOnly'
  )
  $secrets = @()
  $envFile = Join-Path $repo 'backend\.env'
  if (Test-Path -LiteralPath $envFile) {
    foreach ($line in [IO.File]::ReadAllLines($envFile)) {
      if ($line -match '^\s*([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|KEY)[A-Z0-9_]*)\s*=(.*)$' -and
          $Matches[1] -notmatch '(?:FILE|PATH)$') {
        $value = $Matches[2].Trim().Trim('"').Trim("'")
        if ($value.Length -ge 8) { $secrets += $value }
      }
    }
  }
  foreach ($relative in $codeFiles) {
    Assert-RepairSecretsAbsent -SourceText ([IO.File]::ReadAllText((Join-Path $repo $relative))) -Secrets $secrets
  }
  $results.Add([pscustomobject]@{ name = 'known-local-secret-scan'; pass = $true; configured_secret_count = $secrets.Count })
  $dependencyPaths = @('backend/go.mod', 'backend/go.sum', 'backend/execution/Cargo.toml',
    'backend/execution/Cargo.lock', 'frontend/package.json', 'frontend/package-lock.json')
  $dependencyChanges = @(& git -C $repo diff --name-only '7bcfeb891c6b76048c471af8c8dd0738177b2b56' -- @dependencyPaths)
  Assert-Repair ($LASTEXITCODE -eq 0 -and $dependencyChanges.Count -eq 0) 'REPAIR_DEPENDENCY_DELTA'
  $results.Add([pscustomobject]@{ name = 'dependency-delta'; pass = $true; changed_manifests = 0 })
  foreach ($relative in $codeFiles) {
    Assert-Repair ((Get-FileHash -LiteralPath (Join-Path $repo $relative) -Algorithm SHA256).Hash -ceq $sourceHashes[$relative]) 'REPAIR_FINAL_SOURCE_DRIFT'
  }
  $status = 'PASS'
} finally {
  [Environment]::SetEnvironmentVariable('PYTHONUTF8', $savedUtf8, 'Process')
  $report = [ordered]@{
    status = $status; head = $gitHead[0]; source_sha256 = $sourceHashes
    powershell_version = $PSVersionTable.PSVersion.ToString()
    finished_at_utc = [DateTime]::UtcNow.ToString('o'); layers = @($results)
    production = 'DEFERRED_TO_USER_ON_DESKTOP-MDC339G'
    coverage = 'behavior and branch mapping; no numeric PowerShell line coverage'
  }
  [IO.File]::WriteAllText((Join-Path $runRoot 'report.json'), ($report | ConvertTo-Json -Depth 6), (New-Object Text.UTF8Encoding($false)))
  Write-Host "REPAIR_REPORT=$runRoot\report.json"
}
Write-Host 'MT5_PRODUCTION_REPAIR_CODE_GAUNTLET=PASS' -ForegroundColor Green
