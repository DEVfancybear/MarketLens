[CmdletBinding()]
param(
  [string]$InstallerPath,
  [ValidatePattern('^[A-Fa-f0-9]{64}$')][string]$ExpectedInstallerSha256,
  [string]$ExpectedSignerPattern = 'MetaQuotes',
  [string]$SlotRoot,
  [ValidateRange(1, 4)][int]$SlotCount = 1,
  [string[]]$SlotPath,
  [switch]$AcceptMetaQuotesEula,
  [switch]$Execute
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Get-MT5VmInstallerAttestationBoundary {
  [CmdletBinding()]
  param([Parameter(Mandatory = $true)][string]$Path)

  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw 'INSTALLER_NOT_FOUND'
  }
  $item = Get-Item -LiteralPath $Path -Force
  if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
    throw 'INSTALLER_REPARSE_POINT'
  }
  $signature = Get-AuthenticodeSignature -FilePath $Path
  [pscustomobject][ordered]@{
    sha256 = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
    signature_status = $signature.Status.ToString()
    signer_subject = if ($null -eq $signature.SignerCertificate) {
      ''
    } else {
      [string]$signature.SignerCertificate.Subject
    }
  }
}

function Resolve-MT5VmDataProfileBoundary {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$TerminalStateRoot,
    [Parameter(Mandatory = $true)][string]$InstallRoot
  )

  if (-not (Test-Path -LiteralPath $TerminalStateRoot -PathType Container)) {
    return $null
  }
  $canonicalInstallRoot = [IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')
  $matches = @()
  foreach ($origin in Get-ChildItem `
      -LiteralPath $TerminalStateRoot -Filter origin.txt -File -Recurse) {
    if ($origin.Attributes -band [IO.FileAttributes]::ReparsePoint -or
        $origin.Directory.Attributes -band [IO.FileAttributes]::ReparsePoint) {
      continue
    }
    $originValue = (Get-Content -LiteralPath $origin.FullName -Raw).Trim()
    if ([string]::Equals(
        [IO.Path]::GetFullPath($originValue).TrimEnd('\'),
        $canonicalInstallRoot,
        [StringComparison]::OrdinalIgnoreCase
      )) {
      $matches += $origin.Directory
    }
  }
  if ($matches.Count -gt 1) {
    throw 'DUPLICATE_TERMINAL_DATA_PROFILE'
  }
  if ($matches.Count -eq 0) {
    return $null
  }
  return $matches[0]
}

function Get-MT5VmInstalledSlotAttestationBoundary {
  [CmdletBinding()]
  param([Parameter(Mandatory = $true)][string]$TerminalPath)

  if (-not (Test-Path -LiteralPath $TerminalPath -PathType Leaf)) {
    return [pscustomobject][ordered]@{ exists = $false; valid = $false }
  }
  $terminal = Get-Item -LiteralPath $TerminalPath -Force
  if ($terminal.Attributes -band [IO.FileAttributes]::ReparsePoint) {
    throw 'TERMINAL_REPARSE_POINT'
  }
  $signature = Get-AuthenticodeSignature -FilePath $TerminalPath
  $installRoot = Split-Path -Parent $TerminalPath
  $licensePath = Join-Path $installRoot 'Config\terminal.lic'
  $terminalStateRoot = Join-Path $env:APPDATA 'MetaQuotes\Terminal'
  $originMatch = Resolve-MT5VmDataProfileBoundary `
    -TerminalStateRoot $terminalStateRoot -InstallRoot $installRoot
  $serversPath = if ($null -eq $originMatch) {
    $null
  } else {
    Join-Path $originMatch.FullName 'config\servers.dat'
  }
  $hasLicense = Test-Path -LiteralPath $licensePath -PathType Leaf
  $hasServers = $null -ne $serversPath -and (Test-Path -LiteralPath $serversPath -PathType Leaf)
  $valid = $signature.Status -eq 'Valid' -and
    $null -ne $signature.SignerCertificate -and
    $signature.SignerCertificate.Subject -match 'MetaQuotes' -and
    $hasLicense -and $hasServers
  [pscustomobject][ordered]@{
    exists = $true
    valid = [bool]$valid
    terminal_sha256 = (Get-FileHash -LiteralPath $TerminalPath -Algorithm SHA256).Hash.ToLowerInvariant()
    servers_sha256 = if ($hasServers) {
      (Get-FileHash -LiteralPath $serversPath -Algorithm SHA256).Hash.ToLowerInvariant()
    } else { $null }
    terminal_license_sha256 = if ($hasLicense) {
      (Get-FileHash -LiteralPath $licensePath -Algorithm SHA256).Hash.ToLowerInvariant()
    } else { $null }
    data_profile_hash = if ($null -eq $originMatch) { $null } else { $originMatch.Name }
  }
}

function Invoke-MT5VmSlotInstallerBoundary {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$InstallerPath,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [Parameter(Mandatory = $true)][string]$TerminalPath
  )

  $process = Start-Process -FilePath $InstallerPath -ArgumentList $Arguments `
    -WindowStyle Hidden -Wait -PassThru
  $process.Refresh()
  return [int]$process.ExitCode
}

function Invoke-MT5VmTerminalSlotInstallCore {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$InstallerPath,
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Fa-f0-9]{64}$')][string]$ExpectedInstallerSha256,
    [Parameter(Mandatory = $true)][string]$ExpectedSignerPattern,
    [string]$SlotRoot,
    [ValidateRange(1, 4)][int]$SlotCount = 1,
    [string[]]$SlotPaths,
    [Parameter(Mandatory = $true)][switch]$AcceptMetaQuotesEula,
    [switch]$Execute
  )

  if (-not $AcceptMetaQuotesEula) { throw 'METAQUOTES_EULA_NOT_ACCEPTED' }
  $installer = [IO.Path]::GetFullPath($InstallerPath)
  $attestation = Get-MT5VmInstallerAttestationBoundary -Path $installer
  if (-not [string]::Equals(
      [string]$attestation.sha256,
      $ExpectedInstallerSha256,
      [StringComparison]::OrdinalIgnoreCase
    )) {
    throw 'INSTALLER_HASH_MISMATCH'
  }
  if ($attestation.signature_status -ne 'Valid' -or
      [string]$attestation.signer_subject -notmatch $ExpectedSignerPattern) {
    throw 'INSTALLER_SIGNER_MISMATCH'
  }

  $requestedPaths = @()
  if ($null -ne $SlotPaths -and $SlotPaths.Count -gt 0) {
    if ($SlotPaths.Count -ne $SlotCount) { throw 'SLOT_COUNT_MISMATCH' }
    $requestedPaths = @($SlotPaths | ForEach-Object { [IO.Path]::GetFullPath($_) })
  } else {
    if ([string]::IsNullOrWhiteSpace($SlotRoot)) { throw 'SLOT_ROOT_REQUIRED' }
    $root = [IO.Path]::GetFullPath($SlotRoot).TrimEnd('\')
    $requestedPaths = @(for ($index = 1; $index -le $SlotCount; $index++) {
        Join-Path $root ('slot-{0:d2}' -f $index)
      })
  }
  if (@($requestedPaths | Sort-Object -Unique).Count -ne $requestedPaths.Count) {
    throw 'DUPLICATE_TERMINAL_SLOT'
  }

  $plans = @()
  foreach ($slotDirectory in $requestedPaths) {
    $terminalPath = Join-Path $slotDirectory 'terminal64.exe'
    $existing = Get-MT5VmInstalledSlotAttestationBoundary -TerminalPath $terminalPath
    if ($existing.exists -and -not $existing.valid) {
      throw 'EXISTING_SLOT_ATTESTATION_FAILED'
    }
    $plans += [pscustomobject][ordered]@{
      slot_path = $slotDirectory
      terminal_path = $terminalPath
      already_installed = [bool]$existing.exists
    }
  }

  if (-not $Execute) {
    return [pscustomobject][ordered]@{
      status = 'DRY_RUN'
      dry_run = $true
      planned_count = $plans.Count
      installed_count = 0
      slots = $plans
    }
  }

  $slots = @()
  $installedCount = 0
  for ($index = 0; $index -lt $plans.Count; $index++) {
    $plan = $plans[$index]
    $exitCode = $null
    if (-not $plan.already_installed) {
      $arguments = @('/auto', ('/path:"' + $plan.slot_path + '"'))
      $exitCode = Invoke-MT5VmSlotInstallerBoundary `
        -InstallerPath $installer -Arguments $arguments -TerminalPath $plan.terminal_path
      $installedCount++
    }
    $observed = Get-MT5VmInstalledSlotAttestationBoundary -TerminalPath $plan.terminal_path
    if (-not $observed.exists -or -not $observed.valid) {
      if ($null -ne $exitCode -and $exitCode -ne 0) { throw 'SLOT_INSTALLER_FAILED' }
      throw 'INSTALLED_SLOT_ATTESTATION_FAILED'
    }
    $slots += [pscustomobject][ordered]@{
      slot_id = 'slot-{0:d2}' -f ($index + 1)
      terminal_path = $plan.terminal_path
      terminal_sha256 = [string]$observed.terminal_sha256
      servers_sha256 = [string]$observed.servers_sha256
      terminal_license_sha256 = [string]$observed.terminal_license_sha256
      data_profile_hash = [string]$observed.data_profile_hash
    }
  }
  [pscustomobject][ordered]@{
    status = 'PASS'
    dry_run = $false
    planned_count = $plans.Count
    installed_count = $installedCount
    slots = $slots
  }
}

if ($MyInvocation.InvocationName -ne '.') {
  if ([string]::IsNullOrWhiteSpace($InstallerPath) -or
      [string]::IsNullOrWhiteSpace($ExpectedInstallerSha256) -or
      (($null -eq $SlotPath -or $SlotPath.Count -eq 0) -and
       [string]::IsNullOrWhiteSpace($SlotRoot))) {
    throw 'InstallerPath, ExpectedInstallerSha256, and slot destination are required.'
  }
  Invoke-MT5VmTerminalSlotInstallCore `
    -InstallerPath $InstallerPath `
    -ExpectedInstallerSha256 $ExpectedInstallerSha256 `
    -ExpectedSignerPattern $ExpectedSignerPattern `
    -SlotRoot $SlotRoot `
    -SlotCount $SlotCount `
    -SlotPaths $SlotPath `
    -AcceptMetaQuotesEula:$AcceptMetaQuotesEula `
    -Execute:$Execute | ConvertTo-Json -Depth 8
}
