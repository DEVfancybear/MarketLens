[CmdletBinding()]
param([string]$ManifestPath)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Test-MT5VmImageManifestObject {
  [CmdletBinding()]
  param([Parameter(Mandatory = $true)]$Manifest)

  if ($Manifest.schema_version -ne 1 -or
      [string]$Manifest.image_version -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$' -or
      [string]::IsNullOrWhiteSpace([string]$Manifest.generated_at)) {
    throw 'INVALID_IMAGE_MANIFEST'
  }
  $slots = @($Manifest.slots)
  if ($slots.Count -lt 1 -or $slots.Count -gt 4) { throw 'INVALID_TERMINAL_SLOTS' }
  $slotIds = @{}
  $terminalPaths = @{}
  $profiles = @{}
  foreach ($slot in $slots) {
    $slotId = [string]$slot.slot_id
    $terminalPath = [string]$slot.terminal_path
    $profile = [string]$slot.data_profile_hash
    if ($slotId -notmatch '^slot-[0-9]{2}$' -or
        -not [IO.Path]::IsPathRooted($terminalPath) -or
        [IO.Path]::GetFileName($terminalPath) -ine 'terminal64.exe' -or
        $profile -notmatch '^[A-Fa-f0-9]{32}$') {
      throw 'INVALID_TERMINAL_SLOT'
    }
    foreach ($hashName in @('terminal_sha256', 'servers_sha256', 'terminal_license_sha256')) {
      if ([string]$slot.$hashName -notmatch '^[A-Fa-f0-9]{64}$') {
        throw 'INVALID_ARTIFACT_HASH'
      }
    }
    $canonicalKey = [IO.Path]::GetFullPath($terminalPath).ToLowerInvariant()
    $profileKey = $profile.ToLowerInvariant()
    if ($slotIds.ContainsKey($slotId) -or
        $terminalPaths.ContainsKey($canonicalKey) -or
        $profiles.ContainsKey($profileKey)) {
      throw 'DUPLICATE_TERMINAL_SLOT'
    }
    $slotIds[$slotId] = $true
    $terminalPaths[$canonicalKey] = $true
    $profiles[$profileKey] = $true
  }
  return $true
}

if ($MyInvocation.InvocationName -ne '.') {
  if ([string]::IsNullOrWhiteSpace($ManifestPath) -or
      -not (Test-Path -LiteralPath $ManifestPath -PathType Leaf)) {
    throw 'ManifestPath must identify a manifest file.'
  }
  $manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
  $valid = Test-MT5VmImageManifestObject -Manifest $manifest
  [pscustomobject]@{ status = if ($valid) { 'PASS' } else { 'BLOCKED' } } |
    ConvertTo-Json -Compress
}
