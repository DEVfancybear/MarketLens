<# Fail unless each listed dangerous Phase 4 mutation is killed by its focused test. #>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$RepoRoot = Split-Path -Parent $PSScriptRoot
$ArtifactRoot = Join-Path $RepoRoot '.artifacts\mt5-phase4-mutants'
$SourceRoot = Join-Path $RepoRoot 'backend\execution'
$TempRoot = Join-Path $ArtifactRoot 'execution'
$MigrationRoot = Join-Path $ArtifactRoot 'migrations'
$TargetRoot = Join-Path $SourceRoot 'target'

if (Test-Path -LiteralPath $ArtifactRoot) {
  $resolved = (Resolve-Path -LiteralPath $ArtifactRoot).Path
  if (-not $resolved.StartsWith((Join-Path $RepoRoot '.artifacts'), [StringComparison]::OrdinalIgnoreCase)) {
    throw 'refusing to remove mutation artifacts outside .artifacts'
  }
  Remove-Item -LiteralPath $resolved -Recurse -Force
}
New-Item -ItemType Directory -Path $TempRoot -Force | Out-Null
Get-ChildItem -LiteralPath $SourceRoot -Force |
  Where-Object { $_.Name -ne 'target' } |
  Copy-Item -Destination $TempRoot -Recurse -Force
Copy-Item -LiteralPath (Join-Path $RepoRoot 'backend\migrations') -Destination $MigrationRoot -Recurse -Force

$MutantFile = Join-Path $TempRoot 'crates\execution-gateway\src\mt5_vm_sync.rs'
$Original = Get-Content -LiteralPath $MutantFile -Raw -Encoding UTF8

$mutants = @(
  @{
    Name='partial-delete'; Test='partial_snapshot_never_deletes_and_never_advances_freshness';
    Old='let deletes = if result.is_authoritative() {'; New='let deletes = if true {'
  },
  @{
    Name='dropped-lease-fence'; Test='stale_lease_generation_is_refused';
    Old='if envelope.lease_generation != state.current_lease_generation {'; New='if false {'
  },
  @{
    Name='dropped-identity-check'; Test='different_server_or_login_suffix_is_rejected';
    Old='if !normalized_server_eq(registered_server, observed_server) {'; New='if false {'
  },
  @{
    Name='one-sided-portfolio-freshness'; Test='portfolio_requires_both_families_and_uses_the_older_anchor';
    Old='(Some(positions), Some(pending)) => Some(positions.min(pending)),';
    New='(Some(positions), None) => Some(positions),'
  },
  @{
    Name='partial-history-coverage'; Test='history_empty_complete_is_authoritative_but_partial_cannot_claim_coverage';
    Old='} else if request.covered_through_ms.is_some() {'; New='} else if false {'
  }
)

function Remove-ArtifactTree([string]$path) {
  $resolved = (Resolve-Path -LiteralPath $path).Path
  if (-not $resolved.StartsWith($ArtifactRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "refusing to remove mutation artifacts outside .artifacts: $resolved"
  }
  $lastError = $null
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    try {
      Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction Stop
      if (-not (Test-Path -LiteralPath $resolved)) { return }
    } catch {
      $lastError = $_
      Start-Sleep -Seconds 1
    }
  }
  throw "could not remove mutation artifact tree after 30 attempts: $resolved; last error: $lastError"
}

try {
  foreach ($mutant in $mutants) {
    $old = $mutant.Old
    $new = $mutant.New
    if (-not $Original.Contains($old)) { throw "mutant anchor missing: $($mutant.Name)" }
    $mutated = $Original.Replace($old, $new)
    Set-Content -LiteralPath $MutantFile -Value $mutated -Encoding UTF8 -NoNewline
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
      $output = & cargo test --locked --target-dir $TargetRoot --manifest-path (Join-Path $TempRoot 'Cargo.toml') `
        -p execution-gateway $mutant.Test 2>&1 | ForEach-Object { $_.ToString() }
      $exit = $LASTEXITCODE
    } finally { $ErrorActionPreference = $previous }
    $output | Set-Content -LiteralPath (Join-Path $ArtifactRoot ($mutant.Name + '.log')) -Encoding UTF8
    if ($exit -eq 0) { throw "SURVIVED mutant: $($mutant.Name)" }
    $joined = $output -join "`n"
    if ($joined -match 'could not compile' -or $joined -notmatch 'test result: FAILED') {
      throw "invalid mutant execution (test did not kill it): $($mutant.Name)"
    }
    Write-Host "KILLED $($mutant.Name)" -ForegroundColor Green
  }
} finally {
  if (Test-Path -LiteralPath $TempRoot) {
    Remove-ArtifactTree $TempRoot
  }
  if (Test-Path -LiteralPath $MigrationRoot) {
    Remove-ArtifactTree $MigrationRoot
  }
}

Write-Host 'All five Phase 4 manual mutants were killed.' -ForegroundColor Green
