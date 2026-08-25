[CmdletBinding()]
param([switch]$ContractTestsOnly)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$verificationRepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$helperPath = Join-Path $PSScriptRoot 'Install-ProductionManagedWorker.ps1'
$runnerPath = Join-Path $verificationRepoRoot 'run-backend-production.ps1'
$script:passes = 0
$script:failures = @()

function Assert-AutoInstallTrue {
  param([Parameter(Mandatory = $true)][bool]$Condition, [Parameter(Mandatory = $true)][string]$Message)
  if (-not $Condition) { throw $Message }
}

function Invoke-AutoInstallTest {
  param([Parameter(Mandatory = $true)][string]$Name, [Parameter(Mandatory = $true)][scriptblock]$Body)
  try {
    & $Body
    $script:passes++
    Write-Host "PASS $Name"
  } catch {
    $script:failures += [pscustomobject]@{ name = $Name; error = $_.Exception.Message }
    Write-Host "FAIL $Name :: $($_.Exception.Message)"
  }
}

if (Test-Path -LiteralPath $helperPath -PathType Leaf) {
  . $helperPath
}

Invoke-AutoInstallTest 'auto-install helper exposes protected input and atomic env boundaries' {
  Assert-AutoInstallTrue (Test-Path -LiteralPath $helperPath -PathType Leaf) 'auto-install helper missing'
  . $helperPath
  Assert-AutoInstallTrue ($null -ne (Get-Command Read-ProductionManagedWorkerInstallInputBoundary -ErrorAction SilentlyContinue)) `
    'protected install-input reader missing'
  Assert-AutoInstallTrue ($null -ne (Get-Command Set-ProductionManagedWorkerReceiptEnvBoundary -ErrorAction SilentlyContinue)) `
    'atomic receipt persistence boundary missing'
  Assert-AutoInstallTrue ($null -ne (Get-Command Invoke-ProductionManagedWorkerAutoInstallCore -ErrorAction SilentlyContinue)) `
    'auto-install core missing'
}

Invoke-AutoInstallTest 'install input rejects duplicate and unknown JSON fields' {
  $tempRoot = Join-Path ([IO.Path]::GetTempPath()) ('marketlens-autoinstall-input-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $tempRoot | Out-Null
  $pythonPath = (Get-Command python.exe -ErrorAction Stop).Source
  $slot = [ordered]@{
    slot_id = 'slot-01'; terminal_path = 'C:\MT5\terminal64.exe'; terminal_state_root = 'C:\MT5\state'
    terminal_sha256 = ('a' * 64); servers_sha256 = ('b' * 64); terminal_license_sha256 = ('c' * 64)
    ea_path = 'C:\MT5\EA.ex5'; ea_sha256 = ('d' * 64); ea_bootstrap_pipe = 'slot-01'
    ea_profile = 'MarketLens-slot-01'; ea_gateway_origin = 'http://127.0.0.1:8790'
    ea_chart_template_path = 'C:\MT5\chart.chr'; ea_chart_template_sha256 = ('e' * 64)
    ea_webrequest_settings_source_path = 'C:\MT5\experts.ini'; ea_webrequest_settings_sha256 = ('f' * 64)
    ea_topology_attestation_source_path = 'C:\MT5\attestation.json'; ea_topology_attestation_sha256 = ('1' * 64)
  }
  $valid = [ordered]@{
    schema_version = 1; worker_root = 'C:\MarketLens\worker'; data_root = 'D:\MarketLens\runtime'
    worker_identity = 'HOST\MarketLensWorker'; bootstrap_token_file = 'C:\ProgramData\MarketLens\token'
    terminal_slots = @($slot)
  } | ConvertTo-Json -Depth 8
  try {
    $validPath = Join-Path $tempRoot 'valid.json'
    [IO.File]::WriteAllText($validPath, $valid, (New-Object Text.UTF8Encoding($false)))
    $parsed = Read-ProductionManagedWorkerInstallInputBoundary `
      -Path $validPath -PythonPath $pythonPath -AclValidator { param($path) }
    Assert-AutoInstallTrue ([int]$parsed.schema_version -eq 1) 'valid input did not parse'

    $duplicatePath = Join-Path $tempRoot 'duplicate.json'
    [IO.File]::WriteAllText($duplicatePath, $valid.Replace('"schema_version":  1', '"schema_version":  1, "schema_version": 1'), (New-Object Text.UTF8Encoding($false)))
    $duplicateRejected = $false
    try { $null = Read-ProductionManagedWorkerInstallInputBoundary -Path $duplicatePath -PythonPath $pythonPath -AclValidator { param($path) } } catch {
      $duplicateRejected = $_.Exception.Message -ceq 'MANAGED_MT5_WORKER_AUTOINSTALL_INPUT_JSON_INVALID'
    }
    Assert-AutoInstallTrue $duplicateRejected 'duplicate JSON property was accepted'

    $unknownPath = Join-Path $tempRoot 'unknown.json'
    [IO.File]::WriteAllText($unknownPath, $valid.Replace('"schema_version":  1', '"schema_version":  1, "unknown": true'), (New-Object Text.UTF8Encoding($false)))
    $unknownRejected = $false
    try { $null = Read-ProductionManagedWorkerInstallInputBoundary -Path $unknownPath -PythonPath $pythonPath -AclValidator { param($path) } } catch {
      $unknownRejected = $_.Exception.Message -ceq 'MANAGED_MT5_WORKER_AUTOINSTALL_INPUT_SCHEMA_INVALID'
    }
    Assert-AutoInstallTrue $unknownRejected 'unknown JSON property was accepted'
  } finally {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force
  }
}

Invoke-AutoInstallTest 'receipt persistence preserves unrelated env bytes and rejects duplicates' {
  $tempRoot = Join-Path ([IO.Path]::GetTempPath()) ('marketlens-autoinstall-env-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $tempRoot | Out-Null
  try {
    $envPath = Join-Path $tempRoot 'backend.env'
    $before = "SECRET_VALUE=preserve-me`r`nEXECUTION_MT5_MANAGED_WORKER_RECEIPT_FILE=`r`nOTHER=unchanged`r`n"
    [IO.File]::WriteAllText($envPath, $before, (New-Object Text.UTF8Encoding($false)))
    $receipt = 'C:\MarketLens\worker\managed-worker-installation.json'
    $actual = Set-ProductionManagedWorkerReceiptEnvBoundary -BackendEnvPath $envPath -ReceiptPath $receipt
    Assert-AutoInstallTrue ($actual -ceq $receipt) 'persisted receipt path changed'
    $after = [IO.File]::ReadAllText($envPath)
    Assert-AutoInstallTrue ($after.Contains('SECRET_VALUE=preserve-me') -and $after.Contains('OTHER=unchanged')) `
      'unrelated env content changed'
    Assert-AutoInstallTrue ($after.Contains("EXECUTION_MT5_MANAGED_WORKER_RECEIPT_FILE=$receipt")) `
      'receipt assignment missing'

    $duplicatePath = Join-Path $tempRoot 'duplicate.env'
    $duplicate = "EXECUTION_MT5_MANAGED_WORKER_RECEIPT_FILE=A`nEXECUTION_MT5_MANAGED_WORKER_RECEIPT_FILE=B`nSECRET_VALUE=keep`n"
    [IO.File]::WriteAllText($duplicatePath, $duplicate, (New-Object Text.UTF8Encoding($false)))
    $duplicateHash = (Get-FileHash -LiteralPath $duplicatePath -Algorithm SHA256).Hash
    $rejected = $false
    try { $null = Set-ProductionManagedWorkerReceiptEnvBoundary -BackendEnvPath $duplicatePath -ReceiptPath $receipt } catch {
      $rejected = $_.Exception.Message -ceq 'MANAGED_MT5_WORKER_AUTOINSTALL_ENV_DUPLICATE'
    }
    Assert-AutoInstallTrue $rejected 'duplicate env assignment was accepted'
    Assert-AutoInstallTrue ((Get-FileHash -LiteralPath $duplicatePath -Algorithm SHA256).Hash -ceq $duplicateHash) `
      'duplicate env fixture changed after rejection'
  } finally {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force
  }
}

Invoke-AutoInstallTest 'core installs once or adopts without reinstalling' {
  $tempRoot = Join-Path ([IO.Path]::GetTempPath()) ('marketlens-autoinstall-core-' + [guid]::NewGuid().ToString('N'))
  $workerRoot = Join-Path $tempRoot 'worker'
  New-Item -ItemType Directory -Path $workerRoot -Force | Out-Null
  $inputObject = [pscustomobject]@{ worker_root = $workerRoot }
  $script:installerCalls = 0
  try {
    $installed = Invoke-ProductionManagedWorkerAutoInstallCore `
      -InputObject $inputObject -InstallerArguments @{} -BackendEnvPath (Join-Path $tempRoot 'backend.env') -Execute `
      -InstallerInvoker {
        param($arguments, $executeInstall)
        $script:installerCalls++
        if ($executeInstall) {
          return [pscustomobject]@{ receipt_path = (Join-Path $workerRoot 'managed-worker-installation.json') }
        }
        return [pscustomobject]@{ status = 'DRY_RUN'; dry_run = $true }
      } `
      -ReceiptValidator { param($path) [pscustomobject]@{ receipt_path = $path } } `
      -AdoptionValidator { param($receipt) } `
      -ReceiptPersister { param($path, $receipt) $receipt }
    Assert-AutoInstallTrue ($installed.status -ceq 'INSTALLED' -and $script:installerCalls -eq 2) `
      'install path did not run one dry-run and one execute'

    $receiptPath = Join-Path $workerRoot 'managed-worker-installation.json'
    [IO.File]::WriteAllText($receiptPath, '{}', (New-Object Text.UTF8Encoding($false)))
    $script:installerCalls = 0
    $adopted = Invoke-ProductionManagedWorkerAutoInstallCore `
      -InputObject $inputObject -InstallerArguments @{} -BackendEnvPath (Join-Path $tempRoot 'backend.env') -Execute `
      -InstallerInvoker { param($arguments, $executeInstall) $script:installerCalls++; throw 'installer must not run' } `
      -ReceiptValidator { param($path) [pscustomobject]@{ receipt_path = $path } } `
      -AdoptionValidator { param($receipt) } `
      -ReceiptPersister { param($path, $receipt) $receipt }
    Assert-AutoInstallTrue ($adopted.status -ceq 'ADOPTED' -and $script:installerCalls -eq 0) `
      'adoption path reinstalled the worker'
  } finally {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force
  }
}

Invoke-AutoInstallTest 'invalid installer execution never reaches receipt persistence' {
  $tempRoot = Join-Path ([IO.Path]::GetTempPath()) ('marketlens-autoinstall-invalid-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $tempRoot | Out-Null
  $inputObject = [pscustomobject]@{ worker_root = (Join-Path $tempRoot 'worker') }
  $script:persistCalls = 0
  try {
    $message = ''
    try {
      $null = Invoke-ProductionManagedWorkerAutoInstallCore `
        -InputObject $inputObject -InstallerArguments @{} -BackendEnvPath (Join-Path $tempRoot 'backend.env') -Execute `
        -InstallerInvoker {
          param($arguments, $executeInstall)
          if ($executeInstall) { return [pscustomobject]@{ receipt_path = '' } }
          return [pscustomobject]@{ status = 'DRY_RUN'; dry_run = $true }
        } `
        -ReceiptValidator { param($path) [pscustomobject]@{} } `
        -AdoptionValidator { param($receipt) } `
        -ReceiptPersister { param($path, $receipt) $script:persistCalls++; $receipt }
    } catch { $message = $_.Exception.Message }
    Assert-AutoInstallTrue ($message -ceq 'MANAGED_MT5_WORKER_AUTOINSTALL_EXECUTION_INVALID') `
      'invalid installer execution returned the wrong failure'
    Assert-AutoInstallTrue ($script:persistCalls -eq 0) 'invalid installer execution reached persistence'
  } finally {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force
  }
}

Invoke-AutoInstallTest 'receipt validation always precedes env persistence' {
  $tempRoot = Join-Path ([IO.Path]::GetTempPath()) ('marketlens-autoinstall-order-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $tempRoot | Out-Null
  $inputObject = [pscustomobject]@{ worker_root = (Join-Path $tempRoot 'worker') }
  $script:receiptOrder = [Collections.Generic.List[string]]::new()
  try {
    $null = Invoke-ProductionManagedWorkerAutoInstallCore `
      -InputObject $inputObject -InstallerArguments @{} -BackendEnvPath (Join-Path $tempRoot 'backend.env') -Execute `
      -InstallerInvoker {
        param($arguments, $executeInstall)
        if ($executeInstall) { return [pscustomobject]@{ receipt_path = (Join-Path $tempRoot 'receipt.json') } }
        return [pscustomobject]@{ status = 'DRY_RUN'; dry_run = $true }
      } `
      -ReceiptValidator { param($path) $script:receiptOrder.Add('validate'); [pscustomobject]@{} } `
      -AdoptionValidator { param($receipt) } `
      -ReceiptPersister { param($path, $receipt) $script:receiptOrder.Add('persist'); $receipt }
    Assert-AutoInstallTrue (($script:receiptOrder -join ',') -ceq 'validate,persist') `
      'receipt was persisted before validation'
  } finally {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force
  }
}

Invoke-AutoInstallTest 'canonical runner auto-installs only after verified source build' {
  $source = Get-Content -LiteralPath $runnerPath -Raw
  $build = $source.IndexOf('& $buildScript -BackendOnly -StageApi', [StringComparison]::Ordinal)
  $workerArtifact = $source.IndexOf('Backend build did not produce backend\execution\target\release\mt5-vm-agent.exe.', [StringComparison]::Ordinal)
  $autoInstall = $source.IndexOf('$autoInstallJson = @(& $managedWorkerAutoInstallPath', [StringComparison]::Ordinal)
  $managedPython = $source.IndexOf('Managed MT5 market-data Python is missing', [StringComparison]::Ordinal)
  Assert-AutoInstallTrue ($build -ge 0 -and $workerArtifact -gt $build -and $autoInstall -gt $workerArtifact -and $managedPython -gt $autoInstall) `
    'runner build/auto-install/runtime ordering invalid'
  Assert-AutoInstallTrue ($source.Contains('if ($SkipBuild)')) 'runner lacks explicit SkipBuild auto-install fence'
  $autoInstallBlock = $source.Substring($autoInstall, $managedPython - $autoInstall)
  Assert-AutoInstallTrue (-not $autoInstallBlock.Contains('$LASTEXITCODE')) `
    'runner reads stale native exit state after an in-process PowerShell helper'
}

Invoke-AutoInstallTest 'operator configuration documents one-command prepared-host bootstrap' {
  $environment = Get-Content -LiteralPath (Join-Path $verificationRepoRoot 'backend\.env.example') -Raw
  $runbook = Get-Content -LiteralPath (Join-Path $verificationRepoRoot 'docs\MT5_BAREMETAL_MANAGED_EA_RUNBOOK.md') -Raw
  $operations = Get-Content -LiteralPath (Join-Path $verificationRepoRoot 'docs\OPERATIONS.md') -Raw
  Assert-AutoInstallTrue ($environment.Contains('EXECUTION_MT5_MANAGED_WORKER_INSTALL_INPUT_FILE')) `
    'environment example omits install-input setting'
  foreach ($document in @($runbook, $operations)) {
    Assert-AutoInstallTrue ($document -match '(?i)one.command|single invocation|same invocation') `
      'operator docs omit one-command bootstrap behavior'
  }
}

if ($script:failures.Count -gt 0) {
  Write-Host "AUTOINSTALL_TESTS_FAILED=$($script:failures.Count) PASSED=$script:passes"
  exit 1
}

Write-Host "PRODUCTION_MANAGED_WORKER_AUTOINSTALL_TESTS_OK=$script:passes"
if ($ContractTestsOnly) { exit 0 }

$artifactRoot = Join-Path $verificationRepoRoot '.artifacts\production-managed-worker-autoinstall'
$summaryPath = Join-Path $artifactRoot 'summary.json'
$utf8 = New-Object Text.UTF8Encoding($false, $true)
$startedAt = [DateTime]::UtcNow
$layers = [Collections.Generic.List[object]]::new()
$script:mutantsKilled = 0

if (Test-Path -LiteralPath $artifactRoot) {
  $item = Get-Item -LiteralPath $artifactRoot -Force
  Assert-AutoInstallTrue (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) `
    'artifact root is a reparse point'
  Remove-Item -LiteralPath $artifactRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $artifactRoot | Out-Null

function Add-AutoInstallLayer {
  param([string]$Name, [string]$Status, [string]$Detail)
  $layers.Add([pscustomobject][ordered]@{ name = $Name; status = $Status; detail = $Detail })
  Write-Host "$Status $Name $Detail"
}

function ConvertTo-AutoInstallProcessArgument {
  param([AllowEmptyString()][string]$Value)
  if ($Value -notmatch '[\s"]') { return $Value }
  return '"' + $Value.Replace('"', '\"') + '"'
}

function Invoke-AutoInstallCapturedProcess {
  param(
    [Parameter(Mandatory = $true)][string]$File,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [Parameter(Mandatory = $true)][string]$WorkingDirectory,
    [ValidateRange(1, 300)][int]$TimeoutSeconds = 120
  )
  $info = New-Object Diagnostics.ProcessStartInfo
  $info.FileName = $File
  $info.Arguments = (($Arguments | ForEach-Object { ConvertTo-AutoInstallProcessArgument $_ }) -join ' ')
  $info.WorkingDirectory = $WorkingDirectory
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $true
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  $process = New-Object Diagnostics.Process
  $process.StartInfo = $info
  try {
    if (-not $process.Start()) { throw 'AUTOINSTALL_CHILD_START_FAILED' }
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
      try { $process.Kill() } catch { }
      throw 'AUTOINSTALL_CHILD_TIMEOUT'
    }
    $process.WaitForExit()
    return [pscustomobject]@{
      exit_code = [int]$process.ExitCode
      stdout = [string]$stdoutTask.Result
      stderr = [string]$stderrTask.Result
      output = ([string]$stdoutTask.Result + [string]$stderrTask.Result)
    }
  } finally {
    $process.Dispose()
  }
}

function Invoke-AutoInstallMutant {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$RelativePath,
    [Parameter(Mandatory = $true)][string]$Old,
    [Parameter(Mandatory = $true)][string]$New
  )
  $path = Join-Path $verificationRepoRoot $RelativePath
  $originalBytes = [IO.File]::ReadAllBytes($path)
  $originalHash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
  $source = $utf8.GetString($originalBytes)
  $count = ([regex]::Matches($source, [regex]::Escape($Old))).Count
  if ($count -ne 1) { throw "AUTOINSTALL_MUTANT_MATCH_INVALID:$Name`:$count" }
  try {
    [IO.File]::WriteAllBytes($path, $utf8.GetBytes($source.Replace($Old, $New)))
    if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ceq $originalHash) {
      throw "AUTOINSTALL_MUTANT_NOT_APPLIED:$Name"
    }
    $captured = Invoke-AutoInstallCapturedProcess `
      -File (Join-Path $PSHOME 'powershell.exe') `
      -Arguments @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $PSCommandPath, '-ContractTestsOnly') `
      -WorkingDirectory $verificationRepoRoot -TimeoutSeconds 120
    if ($captured.exit_code -eq 0) { throw "AUTOINSTALL_MUTANT_SURVIVED:$Name" }
    if ($captured.output -notmatch 'AUTOINSTALL_TESTS_FAILED=') {
      throw "AUTOINSTALL_MUTANT_WRONG_FAILURE:$Name"
    }
    $script:mutantsKilled++
    Write-Host "MUTANT_KILLED=$Name"
  } finally {
    [IO.File]::WriteAllBytes($path, $originalBytes)
    if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -cne $originalHash) {
      throw "AUTOINSTALL_MUTANT_RESTORE_FAILED:$Name"
    }
  }
}

try {
  Add-AutoInstallLayer 'contract-tests' 'PASS' "$script:passes tests"

  $parserPaths = @(
    'run-backend-production.ps1',
    'tools/Install-ProductionManagedWorker.ps1',
    'tools/verify-production-managed-worker-autoinstall.ps1',
    'tools/verify-production-managed-mt5-readiness.ps1'
  )
  foreach ($relative in $parserPaths) {
    $tokens = $null
    $errors = $null
    $null = [Management.Automation.Language.Parser]::ParseFile(
      (Join-Path $verificationRepoRoot $relative), [ref]$tokens, [ref]$errors
    )
    if ($errors.Count -gt 0) { throw "AUTOINSTALL_PARSER_FAILED:$relative" }
  }
  Add-AutoInstallLayer 'powershell-parser' 'PASS' "$($parserPaths.Count) files"

  $readiness = Invoke-AutoInstallCapturedProcess `
    -File (Join-Path $PSHOME 'powershell.exe') `
    -Arguments @(
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
      (Join-Path $verificationRepoRoot 'tools\verify-production-managed-mt5-readiness.ps1'),
      '-ReadinessTestsOnly'
    ) -WorkingDirectory $verificationRepoRoot -TimeoutSeconds 120
  [IO.File]::WriteAllText((Join-Path $artifactRoot 'readiness.log'), $readiness.output, $utf8)
  if ($readiness.exit_code -ne 0 -or $readiness.output -notmatch 'PRODUCTION_MANAGED_MT5_READINESS_TESTS_OK=19') {
    throw 'AUTOINSTALL_EXISTING_READINESS_FAILED'
  }
  Add-AutoInstallLayer 'existing-readiness-contracts' 'PASS' '19 tests'

  $runnerRelative = 'run-backend-production.ps1'
  $helperRelative = 'tools/Install-ProductionManagedWorker.ps1'
  Invoke-AutoInstallMutant -Name 'installer-before-artifact-verification' -RelativePath $runnerRelative `
    -Old '$replaceArtifacts = $false' `
    -New "`$autoInstallJson = @(& `$managedWorkerAutoInstallPath)`r`n`$replaceArtifacts = `$false"
  Invoke-AutoInstallMutant -Name 'skipbuild-autoinstall-enabled' -RelativePath $runnerRelative `
    -Old 'if ($SkipBuild) {' -New 'if ($false) {'
  Invoke-AutoInstallMutant -Name 'invalid-installer-exit-accepted' -RelativePath $helperRelative `
    -Old 'if ($null -eq $installed -or [string]::IsNullOrWhiteSpace([string]$installed.receipt_path)) {' `
    -New 'if ($null -eq $installed -and [string]::IsNullOrWhiteSpace([string]$installed.receipt_path)) {'
  Invoke-AutoInstallMutant -Name 'receipt-persisted-before-validation' -RelativePath $helperRelative `
    -Old "  `$receipt = & `$ReceiptValidator ([string]`$installed.receipt_path)`n  `$persisted = & `$ReceiptPersister `$BackendEnvPath ([string]`$installed.receipt_path)" `
    -New "  `$persisted = & `$ReceiptPersister `$BackendEnvPath ([string]`$installed.receipt_path)`n  `$receipt = & `$ReceiptValidator ([string]`$installed.receipt_path)"
  Invoke-AutoInstallMutant -Name 'duplicate-env-key-accepted' -RelativePath $helperRelative `
    -Old 'if ($matches.Count -gt 1 -or [regex]::Matches($text, $candidatePattern).Count -ne $matches.Count) {' `
    -New 'if ($matches.Count -lt 0 -or [regex]::Matches($text, $candidatePattern).Count -ne $matches.Count) {'
  if ($script:mutantsKilled -ne 5) { throw "AUTOINSTALL_MUTATION_SCORE_INVALID:$script:mutantsKilled/5" }
  Add-AutoInstallLayer 'mutation' 'PASS' '5/5 killed and byte-restored'

  $taskPaths = @(
    'run-backend-production.ps1', 'backend/.env.example',
    'tools/Install-ProductionManagedWorker.ps1',
    'tools/verify-production-managed-worker-autoinstall.ps1',
    'tools/verify-production-managed-mt5-readiness.ps1',
    'docs/MT5_BAREMETAL_MANAGED_EA_RUNBOOK.md', 'docs/OPERATIONS.md',
    'docs/agent-evidence/production-managed-worker-autoinstall'
  )
  $diffCheck = Invoke-AutoInstallCapturedProcess -File 'git.exe' `
    -Arguments (@('-c', 'core.safecrlf=false', 'diff', '--check', '8dcc38f', '--') + $taskPaths) `
    -WorkingDirectory $verificationRepoRoot -TimeoutSeconds 30
  if ($diffCheck.exit_code -ne 0) { throw 'AUTOINSTALL_DIFF_CHECK_FAILED' }
  Add-AutoInstallLayer 'diff-check' 'PASS' 'task paths clean'

  $diff = Invoke-AutoInstallCapturedProcess -File 'git.exe' `
    -Arguments (@('diff', '--unified=0', '8dcc38f', '--') + $taskPaths) `
    -WorkingDirectory $verificationRepoRoot -TimeoutSeconds 30
  if ($diff.exit_code -ne 0) { throw 'AUTOINSTALL_DIFF_AUDIT_FAILED' }
  if ($diff.output -match '(?im)^\+.*(?:password|secret|private[_-]?key|token)\s*=\s*["''][^"'']{12,}') {
    throw 'AUTOINSTALL_SECRET_ASSIGNMENT_FOUND'
  }
  $runnerSource = Get-Content -LiteralPath $runnerPath -Raw
  if ($runnerSource.Contains('Install-MT5BareMetalWorker.ps1') -or
      $runnerSource.Contains('Start-Process -FilePath $agentPath') -or
      $runnerSource.Contains('New-LocalUser')) {
    throw 'AUTOINSTALL_RUNNER_CAPABILITY_INVALID'
  }
  Add-AutoInstallLayer 'capability-secret-audit' 'PASS' 'no direct installer/identity/agent or secret assignment'

  $canonical = @()
  foreach ($relative in $taskPaths | Sort-Object) {
    $absolute = Join-Path $verificationRepoRoot $relative
    if (Test-Path -LiteralPath $absolute -PathType Leaf) {
      $canonical += "$((Get-FileHash -LiteralPath $absolute -Algorithm SHA256).Hash.ToLowerInvariant())  $relative"
    }
  }
  $hasher = [Security.Cryptography.SHA256]::Create()
  try {
    $treeHash = ([BitConverter]::ToString($hasher.ComputeHash($utf8.GetBytes(($canonical -join "`n") + "`n")))).Replace('-', '').ToLowerInvariant()
  } finally { $hasher.Dispose() }
  $summary = [ordered]@{
    schema_version = 1
    status = 'PASS_WITH_DECLARED_UNVERIFIED'
    started_at_utc = $startedAt.ToString('o')
    finished_at_utc = [DateTime]::UtcNow.ToString('o')
    contract_tests = $script:passes
    existing_readiness_tests = 19
    mutants_killed = $script:mutantsKilled
    mutants_total = 5
    task_tree_sha256 = $treeHash
    layers = @($layers)
    declared_unverified = @(
      'real build and production runner execution',
      'Windows identity ACL and Scheduled Task creation',
      'worker heartbeat terminal broker deployment and activation',
      'frontend Go and Rust full suites'
    )
  }
  [IO.File]::WriteAllText($summaryPath, ($summary | ConvertTo-Json -Depth 8), $utf8)
  Write-Host 'PRODUCTION_MANAGED_WORKER_AUTOINSTALL_STATUS=PASS_WITH_DECLARED_UNVERIFIED'
  Write-Host "SUMMARY=$summaryPath"
} catch {
  $failure = $_.Exception.Message
  Add-AutoInstallLayer 'lightweight-gauntlet' 'FAIL' $failure
  $summary = [ordered]@{
    schema_version = 1; status = 'FAIL'; started_at_utc = $startedAt.ToString('o')
    finished_at_utc = [DateTime]::UtcNow.ToString('o'); failure = $failure; layers = @($layers)
  }
  [IO.File]::WriteAllText($summaryPath, ($summary | ConvertTo-Json -Depth 8), $utf8)
  throw
}
