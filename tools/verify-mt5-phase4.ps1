<#
.SYNOPSIS
  Fail-closed repository gauntlet for the Universal MT5 VM connector Phase 0-4 slice.

  The database layer is deliberately opt-in through MT5_PHASE4_DATABASE_URL. The
  value is never printed. Without a disposable database the script exits blocked,
  rather than treating migration coverage as a pass.
#>
[CmdletBinding()]
param([switch]$SkipDatabase)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$RepoRoot = Split-Path -Parent $PSScriptRoot
$ReportDir = Join-Path $RepoRoot '.artifacts\mt5-phase4'
if (Test-Path -LiteralPath $ReportDir) { Remove-Item -LiteralPath $ReportDir -Recurse -Force }
New-Item -ItemType Directory -Path $ReportDir -Force | Out-Null
$results = [System.Collections.Generic.List[object]]::new()
$blocked = $false

function Run-Layer([string]$Name, [scriptblock]$Body) {
  try { & $Body; $results.Add([pscustomobject]@{Name=$Name;Status='PASS'}); Write-Host "PASS $Name" -ForegroundColor Green }
  catch { $results.Add([pscustomobject]@{Name=$Name;Status='FAIL';Detail=$_.Exception.Message}); Write-Host "FAIL $Name`n$($_.Exception.Message)" -ForegroundColor Red; throw }
}
function Run-Native([string]$File, [string[]]$CommandArgs, [string]$WorkDir) {
  Push-Location $WorkDir
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $output = & $File @CommandArgs 2>&1 | ForEach-Object { $_.ToString() } | Out-String
    $exit = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previous
    Pop-Location
  }
  $output | Set-Content -LiteralPath (Join-Path $ReportDir (($File -replace '[^A-Za-z0-9]','_') + '.log')) -Encoding UTF8
  if ($exit -ne 0) { throw "$File exited $exit" }
}

Run-Layer 'rust-check' { Run-Native 'cargo' @('check','--locked','-p','execution-gateway','-p','mt5-vm-agent') (Join-Path $RepoRoot 'backend\execution') }
Run-Layer 'rust-clippy' { Run-Native 'cargo' @('clippy','--locked','-p','execution-gateway','-p','mt5-vm-agent','--all-targets') (Join-Path $RepoRoot 'backend\execution') }
Run-Layer 'rust-tests' { Run-Native 'cargo' @('test','--locked','-p','execution-gateway','-p','mt5-vm-agent','--all-targets') (Join-Path $RepoRoot 'backend\execution') }
Run-Layer 'python-phase0-1-4' {
  $python = Join-Path $RepoRoot 'backend\.venv-mt5\Scripts\python.exe'
  if (-not (Test-Path -LiteralPath $python)) { throw 'backend/.venv-mt5 is missing' }
  Run-Native $python @('-m','unittest','backend.bridge.mt5_vm.test_phase0_probe','backend.bridge.mt5_vm.test_phase1_adapter','backend.bridge.mt5_vm.test_phase1_control_harness','backend.bridge.mt5_vm.test_phase4_snapshots','-v') $RepoRoot
}
Run-Layer 'go-execution' { Run-Native 'go' @('test','./internal/execution','-count=1') (Join-Path $RepoRoot 'backend') }
Run-Layer 'migration-0041-static' {
  $up = Get-Content (Join-Path $RepoRoot 'backend\migrations\0041_mt5_vm_history_sync.up.sql') -Raw
  $down = Get-Content (Join-Path $RepoRoot 'backend\migrations\0041_mt5_vm_history_sync.down.sql') -Raw
  foreach ($token in @('execution_mt5_vm_history_orders','execution_mt5_vm_deals','execution_mt5_vm_history_coverage')) { if ($up -notmatch $token -or $down -notmatch $token) { throw "0041 missing $token" } }
  if ($down -notmatch 'DROP TABLE IF EXISTS') { throw '0041 down migration is not additive-safe' }
}
Run-Layer 'manual-mutation-controls' {
  $runner = Join-Path $RepoRoot 'tools\verify-mt5-phase4-mutants.ps1'
  Run-Native 'powershell' @('-NoProfile','-ExecutionPolicy','Bypass','-File',$runner) $RepoRoot
}

if ($SkipDatabase) {
  $blocked = $true
  $results.Add([pscustomobject]@{Name='postgres-0040-0041-roundtrip';Status='BLOCKED';Detail='-SkipDatabase supplied'})
  Write-Host 'BLOCKED postgres-0040-0041-roundtrip: disposable database was skipped.' -ForegroundColor Yellow
} elseif ([string]::IsNullOrWhiteSpace($env:MT5_PHASE4_DATABASE_URL)) {
  $blocked = $true
  $results.Add([pscustomobject]@{Name='postgres-0040-0041-roundtrip';Status='BLOCKED';Detail='MT5_PHASE4_DATABASE_URL is not set'})
  Write-Host 'BLOCKED postgres-0040-0041-roundtrip: set MT5_PHASE4_DATABASE_URL to a disposable database.' -ForegroundColor Yellow
} else {
  Run-Layer 'postgres-0040-0041-roundtrip' {
    $env:DATABASE_URL = $env:MT5_PHASE4_DATABASE_URL
    # go run embeds the migration sources from this checkout. A previously
    # built migrate.exe may predate 0041 and therefore cannot prove this change.
    Run-Native 'go' @('run','./cmd/migrate','up') (Join-Path $RepoRoot 'backend')
    Run-Native 'go' @('run','./cmd/migrate','down','1') (Join-Path $RepoRoot 'backend')
    Run-Native 'go' @('run','./cmd/migrate','up','1') (Join-Path $RepoRoot 'backend')
  }
}

$results | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $ReportDir 'summary.json') -Encoding UTF8
if ($blocked) { exit 2 }
Write-Host 'All applicable Phase 4 layers passed.' -ForegroundColor Green
