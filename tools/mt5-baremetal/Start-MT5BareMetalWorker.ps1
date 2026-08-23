[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$AgentPath,
  [Parameter(Mandatory = $true)][string]$ConfigPath,
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[A-Fa-f0-9]{64}$')]
  [string]$ExpectedAgentSha256,
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[A-Fa-f0-9]{64}$')]
  [string]$ExpectedConfigSha256
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$agent = [IO.Path]::GetFullPath($AgentPath)
$config = [IO.Path]::GetFullPath($ConfigPath)
foreach ($path in @($agent, $config)) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw 'BAREMETAL_LAUNCH_ARTIFACT_MISSING' }
  if ((Get-Item -LiteralPath $path -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
    throw 'BAREMETAL_LAUNCH_REPARSE_POINT'
  }
}
$agentHash = (Get-FileHash -LiteralPath $agent -Algorithm SHA256).Hash
if (-not [string]::Equals(
    $agentHash,
    $ExpectedAgentSha256,
    [StringComparison]::OrdinalIgnoreCase
  )) {
  throw 'BAREMETAL_LAUNCH_AGENT_HASH_MISMATCH'
}
$configHash = (Get-FileHash -LiteralPath $config -Algorithm SHA256).Hash
if (-not [string]::Equals(
    $configHash,
    $ExpectedConfigSha256,
    [StringComparison]::OrdinalIgnoreCase
  )) {
  throw 'BAREMETAL_LAUNCH_CONFIG_HASH_MISMATCH'
}
$raw = Get-Content -LiteralPath $config -Raw
$parsed = $raw | ConvertFrom-Json
if ($parsed.worker_substrate -ne 'bare_metal' -or $parsed.process.terminal_slots.Count -lt 1 -or
    $parsed.process.terminal_slots.Count -gt 4 -or
    -not [string]::Equals(
      [string]$parsed.process.artifact_pins.agent_sha256,
      $ExpectedAgentSha256,
      [StringComparison]::OrdinalIgnoreCase
    )) {
  throw 'BAREMETAL_LAUNCH_CONFIG_INVALID'
}
if ([IO.Path]::GetExtension($agent) -ieq '.ps1') {
  $raw | & (Join-Path $PSHOME 'powershell.exe') -NoProfile -NonInteractive `
    -ExecutionPolicy Bypass -File $agent --managed-worker
} else {
  $raw | & $agent --managed-worker
}
if ($LASTEXITCODE -ne 0) { throw 'BAREMETAL_WORKER_EXITED' }
