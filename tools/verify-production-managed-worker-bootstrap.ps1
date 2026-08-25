[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$artifactRoot = Join-Path $repoRoot '.artifacts\production-managed-worker-bootstrap'
$utf8 = New-Object Text.UTF8Encoding($false, $true)
$powershell = Join-Path $PSHOME 'powershell.exe'
$runnerPath = Join-Path $repoRoot 'run-backend-production.ps1'
$readinessPath = Join-Path $repoRoot 'tools\verify-production-managed-mt5-readiness.ps1'
$summaryPath = Join-Path $artifactRoot 'summary.json'
$logPath = Join-Path $artifactRoot 'readiness-tests.log'
$mutantLogPath = Join-Path $artifactRoot 'ordering-mutant.log'
$started = [DateTime]::UtcNow

function Assert-True {
  param([Parameter(Mandatory = $true)][bool]$Condition, [Parameter(Mandatory = $true)][string]$Message)
  if (-not $Condition) { throw $Message }
}

function Quote-ProcessArgument {
  param([AllowEmptyString()][string]$Value)
  if ($Value -notmatch '[\s"]') { return $Value }
  return '"' + $Value.Replace('\', '\\').Replace('"', '\"') + '"'
}

function Invoke-Captured {
  param(
    [Parameter(Mandatory = $true)][string]$FileName,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [Parameter(Mandatory = $true)][string]$WorkingDirectory,
    [ValidateRange(1, 300)][int]$TimeoutSeconds = 120
  )
  $info = New-Object Diagnostics.ProcessStartInfo
  $info.FileName = $FileName
  $info.Arguments = (($Arguments | ForEach-Object { Quote-ProcessArgument $_ }) -join ' ')
  $info.WorkingDirectory = $WorkingDirectory
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $true
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  $process = New-Object Diagnostics.Process
  $process.StartInfo = $info
  try {
    if (-not $process.Start()) { throw "failed to start $FileName" }
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
      try { $process.Kill() } catch { }
      throw "timed out after ${TimeoutSeconds}s: $FileName $($info.Arguments)"
    }
    $process.WaitForExit()
    return [pscustomobject]@{
      ExitCode = $process.ExitCode
      Output = $stdoutTask.Result
      Error = $stderrTask.Result
    }
  } finally {
    $process.Dispose()
  }
}

function Invoke-ParserCheck {
  param([Parameter(Mandatory = $true)][string]$Path)
  $tokens = $null
  $errors = $null
  $null = [Management.Automation.Language.Parser]::ParseFile($Path, [ref]$tokens, [ref]$errors)
  if ($errors.Count -gt 0) {
    throw "PowerShell parser rejected ${Path}: $(($errors | ForEach-Object { $_.Message }) -join '; ')"
  }
}

function Write-Log {
  param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)]$Result)
  [IO.File]::WriteAllText($Path, (@(
    "exit_code=$($Result.ExitCode)"
    $Result.Output
    $Result.Error
  ) -join "`n"), $utf8)
}

function Get-FileSha256 {
  param([Parameter(Mandatory = $true)][string]$Path)
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

if (Test-Path -LiteralPath $artifactRoot) {
  $artifactItem = Get-Item -LiteralPath $artifactRoot -Force
  Assert-True (($artifactItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) `
    "refusing cleanup through reparse point: $artifactRoot"
  Remove-Item -LiteralPath $artifactRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $artifactRoot -Force | Out-Null

$layers = [Collections.Generic.List[object]]::new()
function Add-Layer {
  param([string]$Name, [string]$Status, [string]$Detail)
  $layers.Add([pscustomobject][ordered]@{ name = $Name; status = $Status; detail = $Detail })
  Write-Host "$Status $Name $Detail"
}

try {
  foreach ($path in @($runnerPath, $readinessPath, $PSCommandPath)) {
    Invoke-ParserCheck -Path $path
  }
  Add-Layer 'powershell-parser' 'PASS' '3 files'

  $readinessArguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $readinessPath, '-ReadinessTestsOnly')
  $result = Invoke-Captured -FileName $powershell -Arguments $readinessArguments -WorkingDirectory $repoRoot -TimeoutSeconds 120
  Write-Log -Path $logPath -Result $result
  Assert-True ($result.ExitCode -eq 0) "focused readiness tests failed with exit $($result.ExitCode)"
  Assert-True ($result.Output -match 'PRODUCTION_MANAGED_MT5_READINESS_TESTS_OK=\d+') `
    'focused readiness success marker missing'
  Add-Layer 'focused-readiness-tests' 'PASS' (($result.Output -split "`r?`n" | Where-Object { $_ -match 'PRODUCTION_MANAGED' }) -join ' ')

  $originalBytes = [IO.File]::ReadAllBytes($runnerPath)
  $originalHash = Get-FileSha256 -Path $runnerPath
  $source = $utf8.GetString($originalBytes)
  $old = '$replaceArtifacts = $false'
  $new = '$executionMt5ManagedWorkerReceiptFile = Resolve-ManagedWorkerReceiptFile -ReceiptPath $executionMt5ManagedWorkerReceiptFile -ArtifactsBuilt $false`r`n$replaceArtifacts = $false'
  $matchCount = ([regex]::Matches($source, [regex]::Escape($old))).Count
  Assert-True ($matchCount -eq 1) "ordering mutant match count was $matchCount, expected 1"
  try {
    [IO.File]::WriteAllBytes($runnerPath, $utf8.GetBytes($source.Replace($old, $new)))
    Assert-True ((Get-FileSha256 -Path $runnerPath) -ne $originalHash) 'ordering mutant did not change bytes'
    $mutant = Invoke-Captured -FileName $powershell -Arguments $readinessArguments -WorkingDirectory $repoRoot -TimeoutSeconds 120
    Write-Log -Path $mutantLogPath -Result $mutant
    Assert-True ($mutant.ExitCode -ne 0) 'receipt-before-build mutant survived'
    Assert-True ($mutant.Output -match 'READINESS_TESTS_FAILED=') 'mutant failed outside readiness checker'
  } finally {
    [IO.File]::WriteAllBytes($runnerPath, $originalBytes)
    Assert-True ((Get-FileSha256 -Path $runnerPath) -eq $originalHash) 'ordering mutant restore hash mismatch'
  }
  Add-Layer 'receipt-gate-before-build-mutant' 'PASS' '1/1 killed and byte-restored'

  $taskPaths = @(
    'run-backend-production.ps1',
    'backend/.env.example',
    'tools/verify-production-managed-mt5-readiness.ps1',
    'tools/verify-production-managed-worker-bootstrap.ps1',
    'docs/MT5_BAREMETAL_MANAGED_EA_RUNBOOK.md',
    'docs/OPERATIONS.md',
    'docs/agent-evidence/production-managed-worker-bootstrap'
  )
  $diffCheck = Invoke-Captured -FileName 'git.exe' `
    -Arguments (@('-c', 'core.safecrlf=false', 'diff', '--check', '0e42b86', '--') + $taskPaths) `
    -WorkingDirectory $repoRoot -TimeoutSeconds 30
  Assert-True ($diffCheck.ExitCode -eq 0) "git diff --check failed: $($diffCheck.Error.Trim())"
  Add-Layer 'diff-check' 'PASS' 'task paths clean'

  $manifestNames = @('backend/go.mod', 'backend/go.sum', 'backend/execution/Cargo.toml', 'backend/execution/Cargo.lock', 'frontend/package.json', 'frontend/package-lock.json')
  $manifestDiff = Invoke-Captured -FileName 'git.exe' -Arguments (@('diff', '--name-only', '0e42b86', '--') + $manifestNames) -WorkingDirectory $repoRoot -TimeoutSeconds 30
  Assert-True ($manifestDiff.ExitCode -eq 0) "dependency diff check failed: $($manifestDiff.Error.Trim())"
  Assert-True ([string]::IsNullOrWhiteSpace($manifestDiff.Output)) "unexpected dependency manifest changes: $($manifestDiff.Output.Trim())"
  Add-Layer 'dependency-audit' 'PASS' 'no manifest changes'

  $runnerSource = Get-Content -LiteralPath $runnerPath -Raw
  Assert-True (-not $runnerSource.Contains('Install-MT5BareMetalWorker.ps1')) 'runner invokes installer'
  Assert-True (-not $runnerSource.Contains('managed-worker-installation.json')) 'runner synthesizes receipt'
  Assert-True (-not $runnerSource.Contains('Start-Process -FilePath $agentPath')) 'runner launches agent directly'
  $added = (Invoke-Captured -FileName 'git.exe' -Arguments (@('diff', '--unified=0', '0e42b86', '--') + $taskPaths) -WorkingDirectory $repoRoot -TimeoutSeconds 30).Output
  Assert-True ($added -notmatch '(?im)^\+.*(?:password|secret|private[_-]?key|token)\s*=\s*["''][^"'']{12,}') 'high-confidence secret assignment found in additions'
  Add-Layer 'capability-secret-audit' 'PASS' 'installer/direct-agent forbidden; secret scan clean'

  $canonical = @()
  foreach ($relative in $taskPaths | Sort-Object) {
    $absolute = Join-Path $repoRoot $relative
    if (Test-Path -LiteralPath $absolute -PathType Leaf) {
      $canonical += "$(Get-FileSha256 -Path $absolute)  $relative"
    }
  }
  $hasher = [Security.Cryptography.SHA256]::Create()
  try { $treeHash = ([BitConverter]::ToString($hasher.ComputeHash($utf8.GetBytes(($canonical -join "`n") + "`n")))).Replace('-', '').ToLowerInvariant() } finally { $hasher.Dispose() }
  $summary = [ordered]@{
    schema_version = 1
    status = 'PASS_WITH_DECLARED_UNVERIFIED'
    started_at_utc = $started.ToString('o')
    finished_at_utc = [DateTime]::UtcNow.ToString('o')
    task_tree_sha256 = $treeHash
    layers = @($layers)
    forbidden_heavy_layers = @('frontend full build', 'Go full suite/vet/coverage/race', 'Rust test/check/clippy/build', 'production execution')
  }
  [IO.File]::WriteAllText($summaryPath, ($summary | ConvertTo-Json -Depth 8), $utf8)
  Write-Host 'PRODUCTION_MANAGED_WORKER_BOOTSTRAP_STATUS=PASS_WITH_DECLARED_UNVERIFIED'
  Write-Host "SUMMARY=$summaryPath"
} catch {
  $failure = $_.Exception.Message
  Add-Layer 'lightweight-entrypoint' 'FAIL' $failure
  $summary = [ordered]@{
    schema_version = 1
    status = 'FAIL'
    started_at_utc = $started.ToString('o')
    finished_at_utc = [DateTime]::UtcNow.ToString('o')
    layers = @($layers)
    failure = $failure
  }
  [IO.File]::WriteAllText($summaryPath, ($summary | ConvertTo-Json -Depth 8), $utf8)
  throw
}
