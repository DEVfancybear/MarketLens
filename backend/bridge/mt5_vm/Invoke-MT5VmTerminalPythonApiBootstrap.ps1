[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$TerminalPath,

  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$')]
  [string]$AccountAlias,

  [string]$CredentialPath,
  [string]$PythonPath,

  [ValidateLength(0, 64)]
  [string]$Symbol = '',

  [string]$OutputPath,

  [switch]$RestartTerminalAfterSettings
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$uiHelperPath = Join-Path $PSScriptRoot 'Mt5VmTerminalUi.ps1'
$phase0Path = Join-Path $PSScriptRoot 'Invoke-MT5VmPhase0.ps1'
$powerShellPath = Join-Path $PSHOME 'powershell.exe'
. $uiHelperPath

$fullTerminalPath = [System.IO.Path]::GetFullPath($TerminalPath)
if ([string]::IsNullOrWhiteSpace($OutputPath)) {
  $resultDirectory = Join-Path $env:LOCALAPPDATA 'MarketLens\phase0-results'
  $OutputPath = Join-Path $resultDirectory "mt5-vm-$AccountAlias.json"
}
$fullOutputPath = [System.IO.Path]::GetFullPath($OutputPath)

$probeRunner = {
  $probeStartedAt = [DateTime]::UtcNow
  $arguments = @(
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    $phase0Path,
    '-Mode',
    'Account',
    '-TerminalPath',
    $fullTerminalPath,
    '-AccountAlias',
    $AccountAlias,
    '-OutputPath',
    $fullOutputPath
  )
  if (-not [string]::IsNullOrWhiteSpace($CredentialPath)) {
    $arguments += @('-CredentialPath', [System.IO.Path]::GetFullPath($CredentialPath))
  }
  if (-not [string]::IsNullOrWhiteSpace($PythonPath)) {
    $arguments += @('-PythonPath', [System.IO.Path]::GetFullPath($PythonPath))
  }
  if (-not [string]::IsNullOrWhiteSpace($Symbol)) {
    $arguments += @('-Symbol', $Symbol)
  }

  $capturedOutput = & $powerShellPath @arguments 2>&1
  $probeExitCode = $LASTEXITCODE
  try {
    if (-not (Test-Path -LiteralPath $fullOutputPath -PathType Leaf)) {
      throw 'The Phase 0 probe did not create its sanitized result.'
    }
    $resultItem = Get-Item -LiteralPath $fullOutputPath -Force
    if ($resultItem.LastWriteTimeUtc -lt $probeStartedAt.AddSeconds(-1)) {
      throw 'The Phase 0 probe result was not refreshed by this invocation.'
    }
    try {
      $result = Get-Content -LiteralPath $fullOutputPath -Raw | ConvertFrom-Json
    } catch {
      throw 'The Phase 0 probe result is not valid JSON.'
    }
    if ($result.schema_version -ne 1 -or
        $result.phase -ne 'mt5_windows_vm_phase0' -or
        $result.mode -ne 'account' -or
        $result.account_alias -ne $AccountAlias) {
      throw 'The Phase 0 probe result does not match this bootstrap invocation.'
    }
    return [pscustomobject]@{
      ExitCode = [int]$probeExitCode
      Result = $result
    }
  } finally {
    $capturedOutput = $null
  }
}

try {
  $summary = Invoke-MT5VmTerminalPythonApiBootstrapCore `
    -TerminalPath $fullTerminalPath `
    -AccountAlias $AccountAlias `
    -ProbeRunner $probeRunner `
    -RestartTerminalAfterSettings:$RestartTerminalAfterSettings
  $summary | ConvertTo-Json -Compress
  exit ([int]$summary.ExitCode)
} catch {
  $errorClass = if ($_.Exception.Message -like 'MT5_VM_ROLLBACK_FAILED:*') {
    'MT5_TERMINAL_SETTINGS_ROLLBACK_FAILED'
  } else {
    'MT5_TERMINAL_PYTHON_API_BOOTSTRAP_FAILED'
  }
  [pscustomobject][ordered]@{
    phase = 'mt5_terminal_python_api_bootstrap'
    status = 'BLOCKED'
    error_class = $errorClass
  } | ConvertTo-Json -Compress
  exit 2
}
