[CmdletBinding()]
param(
  [switch]$ContractTestsOnly,
  [switch]$KnownBadControl,
  [switch]$UnreadableInputControl,
  [switch]$OccupiedPortControl,
  [switch]$MouseHitControl,
  [switch]$CursorRestoreControl,
  [switch]$CommitRollbackTrace
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$uiHelper = Join-Path $repoRoot 'backend\bridge\mt5_vm\Mt5VmTerminalUi.ps1'
$probeDriver = Join-Path $PSScriptRoot 'Invoke-MT5WebRequestProbe.ps1'
$selectedTerminal = 'C:\Program Files\MetaTrader 5\terminal64.exe'
$selectedProfile = 'C:\Users\Duong\AppData\Roaming\MetaQuotes\Terminal\D0E8209F77C8CF37AD8BF550E51FF075'
$expectedPublisher = 'CN=MetaQuotes Ltd., O=MetaQuotes Ltd., S=Lemesos, C=CY'
$gatewayBinary = Join-Path $repoRoot 'backend\bin\execution-gateway.exe'
$expectedOrigin = 'http://127.0.0.1'
$commonIniRelativePath = 'config\common.ini'
$maximumCommonIniBytes = 1048576
$listenAddress = '127.0.0.1'
$listenPort = 80
$connectAddress = '127.0.0.1'
$connectPort = 8790

function Assert-ProductionAllowlistTrue {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][bool]$Condition,
    [Parameter(Mandatory = $true)][string]$Code
  )
  if (-not $Condition) { throw $Code }
}

function Get-ProductionSha256Hex {
  [CmdletBinding()]
  param([Parameter(Mandatory = $true)][byte[]]$Bytes)
  $sha256 = [Security.Cryptography.SHA256]::Create()
  try {
    return ([BitConverter]::ToString($sha256.ComputeHash($Bytes))).Replace('-', '')
  } finally {
    $sha256.Dispose()
  }
}

function Test-ProductionByteArrayEqual {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][byte[]]$Left,
    [Parameter(Mandatory = $true)][byte[]]$Right
  )
  if ($Left.Length -ne $Right.Length) { return $false }
  for ($index = 0; $index -lt $Left.Length; $index++) {
    if ($Left[$index] -ne $Right[$index]) { return $false }
  }
  return $true
}

function New-ProductionUtf16LeBomBytes {
  [CmdletBinding()]
  param([Parameter(Mandatory = $true)][AllowEmptyString()][string]$Text)
  $encoding = New-Object Text.UnicodeEncoding($false, $true, $true)
  $body = $encoding.GetBytes($Text)
  $result = New-Object byte[] ($body.Length + 2)
  $result[0] = 0xFF
  $result[1] = 0xFE
  [Array]::Copy($body, 0, $result, 2, $body.Length)
  return ,$result
}

function Get-ProductionCommonIniModel {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][byte[]]$Bytes,
    [Parameter(Mandatory = $true)][string]$ExpectedOrigin
  )
  if ($Bytes.Length -lt 2 -or $Bytes.Length -gt $maximumCommonIniBytes -or
      $Bytes[0] -ne 0xFF -or $Bytes[1] -ne 0xFE -or
      (($Bytes.Length - 2) % 2) -ne 0) {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_SCHEMA_INVALID'
  }
  $encoding = New-Object Text.UnicodeEncoding($false, $true, $true)
  try {
    $text = $encoding.GetString($Bytes, 2, $Bytes.Length - 2)
  } catch {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_SCHEMA_INVALID'
  }
  $roundTrip = New-ProductionUtf16LeBomBytes -Text $text
  if (-not (Test-ProductionByteArrayEqual -Left $Bytes -Right $roundTrip)) {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_SCHEMA_INVALID'
  }
  $sectionMatches = [regex]::Matches(
    $text,
    '^\[Experts\](?:\r)?$',
    [Text.RegularExpressions.RegexOptions]::Multiline
  )
  if ($sectionMatches.Count -ne 1) {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_SCHEMA_INVALID'
  }
  $header = $sectionMatches[0]
  $sectionStart = $header.Index + $header.Length
  if ($sectionStart -lt $text.Length) {
    if ($text.Substring($sectionStart).StartsWith("`r`n", [StringComparison]::Ordinal)) {
      $sectionStart += 2
    } elseif ($text[$sectionStart] -eq "`n") {
      $sectionStart += 1
    } else {
      throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_SCHEMA_INVALID'
    }
  }
  $remainder = $text.Substring($sectionStart)
  $nextHeader = [regex]::Match(
    $remainder,
    '^\[[^\r\n\]]+\](?:\r)?$',
    [Text.RegularExpressions.RegexOptions]::Multiline
  )
  $sectionEnd = if ($nextHeader.Success) {
    $sectionStart + $nextHeader.Index
  } else {
    $text.Length
  }
  $sectionText = $text.Substring($sectionStart, $sectionEnd - $sectionStart)
  $webMatches = [regex]::Matches(
    $sectionText,
    '^WebRequest=([^\r\n]*)(?:\r)?$',
    [Text.RegularExpressions.RegexOptions]::Multiline
  )
  $urlMatches = [regex]::Matches(
    $sectionText,
    '^WebRequestUrl=([^\r\n]*)(?:\r)?$',
    [Text.RegularExpressions.RegexOptions]::Multiline
  )
  $allWebMatches = [regex]::Matches(
    $text,
    '^WebRequest=([^\r\n]*)(?:\r)?$',
    [Text.RegularExpressions.RegexOptions]::Multiline
  )
  $allUrlMatches = [regex]::Matches(
    $text,
    '^WebRequestUrl=([^\r\n]*)(?:\r)?$',
    [Text.RegularExpressions.RegexOptions]::Multiline
  )
  if ($webMatches.Count -ne 1 -or $urlMatches.Count -ne 1 -or
      $allWebMatches.Count -ne 1 -or $allUrlMatches.Count -ne 1) {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_SCHEMA_INVALID'
  }
  $webGroup = $webMatches[0].Groups[1]
  $urlGroup = $urlMatches[0].Groups[1]
  $absoluteWebIndex = $sectionStart + $webGroup.Index
  $absoluteUrlIndex = $sectionStart + $urlGroup.Index
  if ($absoluteWebIndex -ne $allWebMatches[0].Groups[1].Index -or
      $absoluteUrlIndex -ne $allUrlMatches[0].Groups[1].Index) {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_SCHEMA_INVALID'
  }
  $isPrior = (
    [string]::Equals($webGroup.Value, '0', [StringComparison]::Ordinal) -and
    $urlGroup.Value.Length -eq 0
  )
  $isDesired = (
    [string]::Equals($webGroup.Value, '1', [StringComparison]::Ordinal) -and
    [string]::Equals($urlGroup.Value, $ExpectedOrigin, [StringComparison]::Ordinal)
  )
  if (-not $isPrior -and -not $isDesired) {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_PRIOR_STATE_INVALID'
  }
  return [pscustomobject][ordered]@{
    Bytes = $Bytes
    Text = $text
    IsPrior = $isPrior
    IsDesired = $isDesired
    WebValueIndex = $absoluteWebIndex
    WebValueLength = $webGroup.Length
    UrlValueIndex = $absoluteUrlIndex
    UrlValueLength = $urlGroup.Length
  }
}

function Set-ProductionCommonIniValueSpans {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][object]$Model,
    [Parameter(Mandatory = $true)][AllowEmptyString()][string]$WebValue,
    [Parameter(Mandatory = $true)][AllowEmptyString()][string]$UrlValue
  )
  $replacements = @(
    [pscustomobject]@{
      Index = [int]$Model.WebValueIndex
      Length = [int]$Model.WebValueLength
      Value = $WebValue
    },
    [pscustomobject]@{
      Index = [int]$Model.UrlValueIndex
      Length = [int]$Model.UrlValueLength
      Value = $UrlValue
    }
  ) | Sort-Object -Property Index -Descending
  $result = [string]$Model.Text
  foreach ($replacement in $replacements) {
    $result = $result.Substring(0, $replacement.Index) +
      [string]$replacement.Value +
      $result.Substring($replacement.Index + $replacement.Length)
  }
  return $result
}

function Convert-ProductionWebRequestCommonIni {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][byte[]]$Bytes,
    [Parameter(Mandatory = $true)][string]$ExpectedOrigin
  )
  $model = Get-ProductionCommonIniModel -Bytes $Bytes -ExpectedOrigin $ExpectedOrigin
  if ([bool]$model.IsDesired) {
    $sameHash = Get-ProductionSha256Hex -Bytes $Bytes
    return [pscustomobject][ordered]@{
      Status = 'UNCHANGED'
      Bytes = $Bytes
      OriginalHash = $sameHash
      DesiredHash = $sameHash
    }
  }
  $desiredText = Set-ProductionCommonIniValueSpans -Model $model -WebValue '1' -UrlValue $ExpectedOrigin
  $desiredBytes = New-ProductionUtf16LeBomBytes -Text $desiredText
  $desiredModel = Get-ProductionCommonIniModel `
    -Bytes $desiredBytes -ExpectedOrigin $ExpectedOrigin
  if (-not [bool]$desiredModel.IsDesired) {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_TRANSFORM_INVALID'
  }
  $reverseText = Set-ProductionCommonIniValueSpans `
    -Model $desiredModel -WebValue '0' -UrlValue ''
  $reverseBytes = New-ProductionUtf16LeBomBytes -Text $reverseText
  if (-not (Test-ProductionByteArrayEqual -Left $Bytes -Right $reverseBytes)) {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_UNRELATED_BYTES_CHANGED'
  }
  return [pscustomobject][ordered]@{
    Status = 'APPLIED'
    Bytes = $desiredBytes
    OriginalHash = Get-ProductionSha256Hex -Bytes $Bytes
    DesiredHash = Get-ProductionSha256Hex -Bytes $desiredBytes
  }
}

function Read-ProductionWebRequestCommonIni {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$ExpectedOrigin
  )
  try {
    $bytes = [IO.File]::ReadAllBytes($Path)
  } catch {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_CONFIG_UNREADABLE'
  }
  $model = Get-ProductionCommonIniModel -Bytes $bytes -ExpectedOrigin $ExpectedOrigin
  return [pscustomobject][ordered]@{
    Bytes = $bytes
    Hash = Get-ProductionSha256Hex -Bytes $bytes
    IsPrior = [bool]$model.IsPrior
    IsDesired = [bool]$model.IsDesired
  }
}

function Assert-ProductionNoReparseComponent {
  [CmdletBinding()]
  param([Parameter(Mandatory = $true)][string]$Path)

  $cursor = Get-Item -LiteralPath ([IO.Path]::GetFullPath($Path)) -Force -ErrorAction Stop
  while ($null -ne $cursor) {
    if (($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw 'PROVISIONING_WEBREQUEST_REPARSE_PATH_REJECTED'
    }
    $cursor = if ($cursor -is [IO.FileInfo]) { $cursor.Directory } else { $cursor.Parent }
  }
}

function Assert-ProductionSelectedTerminalProfile {
  [CmdletBinding()]
  param()

  Assert-MT5VmTrustedTerminalBoundary -TerminalPath $selectedTerminal
  Assert-ProductionNoReparseComponent -Path $selectedTerminal
  $signature = Get-AuthenticodeSignature -LiteralPath $selectedTerminal
  if ($signature.Status -ne [Management.Automation.SignatureStatus]::Valid -or
      $null -eq $signature.SignerCertificate -or
      -not [string]::Equals(
        [string]$signature.SignerCertificate.Subject,
        $expectedPublisher,
        [StringComparison]::Ordinal
      )) {
    throw 'PROVISIONING_WEBREQUEST_TERMINAL_SIGNER_MISMATCH'
  }
  if (-not (Test-Path -LiteralPath $selectedProfile -PathType Container)) {
    throw 'PROVISIONING_WEBREQUEST_SELECTED_PROFILE_MISSING'
  }
  Assert-ProductionNoReparseComponent -Path $selectedProfile
  $profileOriginPath = Join-Path $selectedProfile 'origin.txt'
  if (-not (Test-Path -LiteralPath $profileOriginPath -PathType Leaf)) {
    throw 'PROVISIONING_WEBREQUEST_SELECTED_PROFILE_ORIGIN_MISSING'
  }
  Assert-ProductionNoReparseComponent -Path $profileOriginPath
  $profileOrigin = (Get-Content -LiteralPath $profileOriginPath -Raw).Trim().TrimEnd('\')
  $terminalRoot = (Split-Path -Parent $selectedTerminal).TrimEnd('\')
  if (-not [string]::Equals(
      $profileOrigin,
      $terminalRoot,
      [StringComparison]::OrdinalIgnoreCase
    )) {
    throw 'PROVISIONING_WEBREQUEST_SELECTED_PROFILE_ORIGIN_MISMATCH'
  }
}

function Get-ProductionSelectedTerminalProcesses {
  [CmdletBinding()]
  param()
  try {
    $processes = @(Get-CimInstance Win32_Process -Filter "Name = 'terminal64.exe'")
  } catch {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_PROCESS_QUERY_FAILED'
  }
  $selected = @()
  foreach ($candidate in $processes) {
    if ([string]::IsNullOrWhiteSpace([string]$candidate.ExecutablePath)) { continue }
    try {
      $candidatePath = [IO.Path]::GetFullPath([string]$candidate.ExecutablePath)
    } catch {
      continue
    }
    if ([string]::Equals(
        $candidatePath,
        $selectedTerminal,
        [StringComparison]::OrdinalIgnoreCase
      )) {
      $selected += [pscustomobject]@{ ProcessId = [int]$candidate.ProcessId }
    }
  }
  if ($selected.Count -gt 1) {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_PROCESS_AMBIGUOUS'
  }
  return $selected
}

function Assert-ProductionSelectedTerminalAbsent {
  [CmdletBinding()]
  param()
  if (@(Get-ProductionSelectedTerminalProcesses).Count -ne 0) {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_TERMINAL_RUNNING'
  }
}

function Wait-ProductionSelectedTerminalAbsent {
  [CmdletBinding()]
  param()
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    if (@(Get-ProductionSelectedTerminalProcesses).Count -eq 0) { return }
    Start-Sleep -Milliseconds 250
  }
  $matches = @(Get-ProductionSelectedTerminalProcesses)
  if ($matches.Count -eq 1) {
    $process = Get-Process -Id ([int]$matches[0].ProcessId) -ErrorAction Stop
    $null = $process.CloseMainWindow()
    if ($process.WaitForExit(15000)) { return }
  }
  throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_TERMINAL_STOP_FAILED'
}

function Assert-ProductionSelectedTerminalAndProfile {
  [CmdletBinding()]
  param()
  foreach ($path in @(
      $selectedTerminal,
      $selectedProfile,
      (Join-Path $selectedProfile 'origin.txt'),
      (Join-Path $selectedProfile $commonIniRelativePath),
      $probeDriver
    )) {
    Assert-ProductionAllowlistTrue `
      (Test-Path -LiteralPath $path) `
      'PROVISIONING_WEBREQUEST_ALLOWLIST_PATH_INVALID'
    Assert-ProductionNoReparseComponent -Path $path
  }
  $signature = Get-AuthenticodeSignature -LiteralPath $selectedTerminal
  Assert-ProductionAllowlistTrue (
    $signature.Status -eq [Management.Automation.SignatureStatus]::Valid -and
    $null -ne $signature.SignerCertificate -and
    [string]::Equals(
      [string]$signature.SignerCertificate.Subject,
      $expectedPublisher,
      [StringComparison]::Ordinal
    )
  ) 'PROVISIONING_WEBREQUEST_ALLOWLIST_SIGNER_INVALID'
  try {
    $observedInstall = [IO.Path]::GetFullPath(
      (Get-Content -LiteralPath (Join-Path $selectedProfile 'origin.txt') -Raw).Trim()
    ).TrimEnd('\')
    $expectedInstall = [IO.Path]::GetFullPath(
      (Split-Path -Parent $selectedTerminal)
    ).TrimEnd('\')
  } catch {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_PROFILE_ORIGIN_INVALID'
  }
  Assert-ProductionAllowlistTrue (
    [string]::Equals(
      $observedInstall,
      $expectedInstall,
      [StringComparison]::OrdinalIgnoreCase
    )
  ) 'PROVISIONING_WEBREQUEST_ALLOWLIST_PROFILE_ORIGIN_INVALID'
}

function Get-ProductionAclSddl {
  [CmdletBinding()]
  param([Parameter(Mandatory = $true)][string]$Path)
  try {
    return [string](Get-Acl -LiteralPath $Path -ErrorAction Stop).Sddl
  } catch {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_ACL_INVALID'
  }
}

function Write-ProductionCreateNewFile {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][byte[]]$Bytes,
    [Parameter(Mandatory = $true)][object]$Acl
  )
  $stream = $null
  try {
    $stream = New-Object IO.FileStream(
      $Path,
      [IO.FileMode]::CreateNew,
      [IO.FileAccess]::Write,
      [IO.FileShare]::None
    )
    $stream.Write($Bytes, 0, $Bytes.Length)
    $stream.Flush($true)
  } finally {
    if ($null -ne $stream) { $stream.Dispose() }
  }
  Set-Acl -LiteralPath $Path -AclObject $Acl
}

function Invoke-ProductionAtomicCommonIniReplace {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$CommonIniPath,
    [Parameter(Mandatory = $true)][byte[]]$DesiredBytes
  )
  $parent = Split-Path -Parent $CommonIniPath
  $backupPath = $CommonIniPath + '.marketlens-v36.bak'
  if (Test-Path -LiteralPath $backupPath) {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_RECOVERY_STATE_INVALID'
  }
  $temporaryPath = Join-Path $parent (
    '.marketlens-v36-' + [guid]::NewGuid().ToString('N') + '.tmp'
  )
  $originalBytes = [IO.File]::ReadAllBytes($CommonIniPath)
  $originalHash = Get-ProductionSha256Hex -Bytes $originalBytes
  $originalAcl = Get-Acl -LiteralPath $CommonIniPath -ErrorAction Stop
  $originalSddl = [string]$originalAcl.Sddl
  try {
    Write-ProductionCreateNewFile `
      -Path $temporaryPath -Bytes $DesiredBytes -Acl $originalAcl
    [IO.File]::Replace($temporaryPath, $CommonIniPath, $backupPath, $true)
    $backupBytes = [IO.File]::ReadAllBytes($backupPath)
    if ((Get-ProductionSha256Hex -Bytes $backupBytes) -cne $originalHash -or
        (Get-ProductionAclSddl -Path $backupPath) -cne $originalSddl -or
        (Get-ProductionAclSddl -Path $CommonIniPath) -cne $originalSddl) {
      throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_ATOMIC_REPLACE_INVALID'
    }
    return [pscustomobject][ordered]@{
      BackupPath = $backupPath
      SnapshotBytes = $originalBytes
      SnapshotHash = $originalHash
      SnapshotSddl = $originalSddl
    }
  } finally {
    if (Test-Path -LiteralPath $temporaryPath -PathType Leaf) {
      Remove-Item -LiteralPath $temporaryPath -Force
    }
  }
}

function Restore-ProductionWebRequestCommonIniSnapshot {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$CommonIniPath,
    [Parameter(Mandatory = $true)][string]$BackupPath,
    [Parameter(Mandatory = $true)][byte[]]$SnapshotBytes,
    [Parameter(Mandatory = $true)][string]$SnapshotHash,
    [Parameter(Mandatory = $true)][string]$SnapshotSddl
  )
  $parent = Split-Path -Parent $CommonIniPath
  $temporaryPath = Join-Path $parent (
    '.marketlens-v36-restore-' + [guid]::NewGuid().ToString('N') + '.tmp'
  )
  $failedPath = Join-Path $parent (
    '.marketlens-v36-failed-' + [guid]::NewGuid().ToString('N') + '.tmp'
  )
  try {
    $backupBytes = [IO.File]::ReadAllBytes($BackupPath)
    if ((Get-ProductionSha256Hex -Bytes $backupBytes) -cne $SnapshotHash -or
        (Get-ProductionAclSddl -Path $BackupPath) -cne $SnapshotSddl) {
      throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_ROLLBACK_FAILED'
    }
    $snapshotAcl = Get-Acl -LiteralPath $BackupPath -ErrorAction Stop
    Write-ProductionCreateNewFile `
      -Path $temporaryPath -Bytes $SnapshotBytes -Acl $snapshotAcl
    [IO.File]::Replace($temporaryPath, $CommonIniPath, $failedPath, $true)
    $restoredBytes = [IO.File]::ReadAllBytes($CommonIniPath)
    if ((Get-ProductionSha256Hex -Bytes $restoredBytes) -cne $SnapshotHash -or
        (Get-ProductionAclSddl -Path $CommonIniPath) -cne $SnapshotSddl) {
      throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_ROLLBACK_FAILED'
    }
    if (Test-Path -LiteralPath $failedPath -PathType Leaf) {
      Remove-Item -LiteralPath $failedPath -Force
    }
    Remove-Item -LiteralPath $BackupPath -Force
  } catch {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_ROLLBACK_FAILED'
  } finally {
    if (Test-Path -LiteralPath $temporaryPath -PathType Leaf) {
      Remove-Item -LiteralPath $temporaryPath -Force
    }
  }
}

function Invoke-ProductionWebRequestCommonIniTransaction {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$CommonIniPath,
    [Parameter(Mandatory = $true)][string]$ExpectedOrigin,
    [Parameter(Mandatory = $true)][scriptblock]$PreconditionAction,
    [Parameter(Mandatory = $true)][scriptblock]$ProbeAction,
    [Parameter(Mandatory = $true)][scriptblock]$QuiesceAction,
    [Parameter(Mandatory = $true)][scriptblock]$RollbackAction,
    [switch]$RollbackOnSuccess
  )
  & $PreconditionAction
  $backupPath = $CommonIniPath + '.marketlens-v36.bak'
  $backupExistedOnEntry = Test-Path -LiteralPath $backupPath -PathType Leaf
  $snapshotBytes = $null
  $snapshotHash = ''
  $snapshotSddl = ''
  $hasRollbackSnapshot = $false
  $status = ''

  try {
    if ($backupExistedOnEntry) {
      Assert-ProductionNoReparseComponent -Path $backupPath
      $backupState = Read-ProductionWebRequestCommonIni `
        -Path $backupPath -ExpectedOrigin $ExpectedOrigin
      $currentState = Read-ProductionWebRequestCommonIni `
        -Path $CommonIniPath -ExpectedOrigin $ExpectedOrigin
      if (-not [bool]$backupState.IsPrior -or -not [bool]$currentState.IsDesired) {
        throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_RECOVERY_STATE_INVALID'
      }
      $expectedCurrent = Convert-ProductionWebRequestCommonIni `
        -Bytes ([byte[]]$backupState.Bytes) -ExpectedOrigin $ExpectedOrigin
      if (-not (Test-ProductionByteArrayEqual `
          -Left ([byte[]]$currentState.Bytes) `
          -Right ([byte[]]$expectedCurrent.Bytes))) {
        throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_RECOVERY_STATE_INVALID'
      }
      $snapshotBytes = [byte[]]$backupState.Bytes
      $snapshotHash = [string]$backupState.Hash
      $snapshotSddl = Get-ProductionAclSddl -Path $backupPath
      if ((Get-ProductionAclSddl -Path $CommonIniPath) -cne $snapshotSddl) {
        throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_RECOVERY_STATE_INVALID'
      }
      $hasRollbackSnapshot = $true
      $status = 'RECOVERED'
    } else {
      $currentState = Read-ProductionWebRequestCommonIni `
        -Path $CommonIniPath -ExpectedOrigin $ExpectedOrigin
      $currentSddl = Get-ProductionAclSddl -Path $CommonIniPath
      $conversion = Convert-ProductionWebRequestCommonIni `
        -Bytes ([byte[]]$currentState.Bytes) -ExpectedOrigin $ExpectedOrigin
      if ([string]$conversion.Status -ceq 'UNCHANGED') {
        $snapshotBytes = [byte[]]$currentState.Bytes
        $snapshotHash = [string]$currentState.Hash
        $snapshotSddl = $currentSddl
        $status = 'UNCHANGED'
      } else {
        $replacement = Invoke-ProductionAtomicCommonIniReplace `
          -CommonIniPath $CommonIniPath `
          -DesiredBytes ([byte[]]$conversion.Bytes)
        $snapshotBytes = [byte[]]$replacement.SnapshotBytes
        $snapshotHash = [string]$replacement.SnapshotHash
        $snapshotSddl = [string]$replacement.SnapshotSddl
        $hasRollbackSnapshot = $true
        $status = 'APPLIED'
        $afterWrite = Read-ProductionWebRequestCommonIni `
          -Path $CommonIniPath -ExpectedOrigin $ExpectedOrigin
        $idempotent = Convert-ProductionWebRequestCommonIni `
          -Bytes ([byte[]]$afterWrite.Bytes) -ExpectedOrigin $ExpectedOrigin
        if ([string]$idempotent.Status -cne 'UNCHANGED' -or
            [string]$idempotent.DesiredHash -cne [string]$afterWrite.Hash) {
          throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_IDEMPOTENCY_INVALID'
        }
      }
    }

    if ((& $ProbeAction) -ne $true) {
      throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_PROBE_INVALID'
    }
    & $QuiesceAction
    $postProbe = Read-ProductionWebRequestCommonIni `
      -Path $CommonIniPath -ExpectedOrigin $ExpectedOrigin
    if (-not [bool]$postProbe.IsDesired -or
        (Get-ProductionAclSddl -Path $CommonIniPath) -cne $snapshotSddl) {
      throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_POST_PROBE_INVALID'
    }
    if ($hasRollbackSnapshot) {
      $expectedPostProbe = Convert-ProductionWebRequestCommonIni `
        -Bytes $snapshotBytes -ExpectedOrigin $ExpectedOrigin
      if (-not (Test-ProductionByteArrayEqual `
          -Left ([byte[]]$postProbe.Bytes) `
          -Right ([byte[]]$expectedPostProbe.Bytes))) {
        throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_POST_PROBE_INVALID'
      }
      if ($RollbackOnSuccess) {
        if ((& $RollbackAction `
            $CommonIniPath $backupPath $snapshotBytes $snapshotHash $snapshotSddl) -ne $true) {
          throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_ROLLBACK_FAILED'
        }
        $restored = Read-ProductionWebRequestCommonIni `
          -Path $CommonIniPath -ExpectedOrigin $ExpectedOrigin
        if (-not [bool]$restored.IsPrior -or [string]$restored.Hash -cne $snapshotHash) {
          throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_ROLLBACK_FAILED'
        }
        return [pscustomobject][ordered]@{
          status = $status
          persisted_desired = $true
          restored_prior = $true
          probe_verified = $true
        }
      }
      Remove-Item -LiteralPath $backupPath -Force
    } elseif ([string]$postProbe.Hash -cne $snapshotHash) {
      throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_POST_PROBE_INVALID'
    } elseif ($RollbackOnSuccess) {
      throw 'PROVISIONING_WEBREQUEST_COMMIT_ROLLBACK_TRACE_INVALID'
    }
    return [pscustomobject][ordered]@{
      status = $status
      enabled = $true
      non_empty_count = 1
      probe_verified = $true
    }
  } catch {
    $originalFailure = [string]$_.Exception.Message
    if (-not $backupExistedOnEntry -and -not $hasRollbackSnapshot -and
        (Test-Path -LiteralPath $backupPath -PathType Leaf)) {
      try {
        $emergencySnapshot = Read-ProductionWebRequestCommonIni `
          -Path $backupPath -ExpectedOrigin $ExpectedOrigin
        if ([bool]$emergencySnapshot.IsPrior) {
          $snapshotBytes = [byte[]]$emergencySnapshot.Bytes
          $snapshotHash = [string]$emergencySnapshot.Hash
          $snapshotSddl = Get-ProductionAclSddl -Path $backupPath
          $hasRollbackSnapshot = $true
        }
      } catch {
        throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_ROLLBACK_FAILED'
      }
    }
    if ($hasRollbackSnapshot -and -not (
        $backupExistedOnEntry -and
        $originalFailure -ceq 'PROVISIONING_WEBREQUEST_ALLOWLIST_RECOVERY_STATE_INVALID'
      ) -and -not (
        $RollbackOnSuccess -and
        $originalFailure -ceq 'PROVISIONING_WEBREQUEST_ALLOWLIST_ROLLBACK_FAILED'
      )) {
      try {
        & $QuiesceAction
        $rollbackResult = & $RollbackAction `
          $CommonIniPath $backupPath $snapshotBytes $snapshotHash $snapshotSddl
        if ($rollbackResult -ne $true) {
          throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_ROLLBACK_FAILED'
        }
      } catch {
        throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_ROLLBACK_FAILED'
      }
    }
    throw $originalFailure
  }
}

function ConvertFrom-ProductionPortProxyOutput {
  [CmdletBinding()]
  param([Parameter(Mandatory = $true)][AllowEmptyString()][string]$OutputText)

  $entries = [Collections.Generic.List[object]]::new()
  foreach ($line in @($OutputText -split '\r?\n')) {
    $trimmed = $line.Trim()
    if ($trimmed.Length -eq 0 -or $trimmed -match '^-+$') { continue }
    $match = [regex]::Match(
      $trimmed,
      '^(\S+)\s+(\d+)\s+(\S+)\s+(\d+)$'
    )
    if (-not $match.Success) {
      if ($trimmed -match '\d{1,3}(?:\.\d{1,3}){3}') {
        throw 'PROVISIONING_WEBREQUEST_PORTPROXY_OUTPUT_INVALID'
      }
      continue
    }
    $listenIp = $null
    $connectIp = $null
    if (-not [Net.IPAddress]::TryParse($match.Groups[1].Value, [ref]$listenIp) -or
        -not [Net.IPAddress]::TryParse($match.Groups[3].Value, [ref]$connectIp) -or
        $listenIp.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork -or
        $connectIp.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) {
      throw 'PROVISIONING_WEBREQUEST_PORTPROXY_OUTPUT_INVALID'
    }
    $parsedListenPort = 0
    $parsedConnectPort = 0
    if (-not [int]::TryParse($match.Groups[2].Value, [ref]$parsedListenPort) -or
        -not [int]::TryParse($match.Groups[4].Value, [ref]$parsedConnectPort) -or
        $parsedListenPort -lt 1 -or $parsedListenPort -gt 65535 -or
        $parsedConnectPort -lt 1 -or $parsedConnectPort -gt 65535) {
      throw 'PROVISIONING_WEBREQUEST_PORTPROXY_OUTPUT_INVALID'
    }
    $entries.Add([pscustomobject][ordered]@{
        listen_address = $listenIp.ToString()
        listen_port = $parsedListenPort
        connect_address = $connectIp.ToString()
        connect_port = $parsedConnectPort
      })
  }
  return @($entries)
}

function Assert-ProductionLoopbackPortProxyState {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$Entries,
    [switch]$AllowEmpty
  )

  if ($Entries.Count -eq 0) {
    if ($AllowEmpty) { return 'EMPTY' }
    throw 'PROVISIONING_WEBREQUEST_PORTPROXY_STATE_INVALID'
  }
  if ($Entries.Count -ne 1) {
    throw 'PROVISIONING_WEBREQUEST_PORTPROXY_STATE_INVALID'
  }
  $entry = $Entries[0]
  if ([string]$entry.listen_address -cne $listenAddress -or
      [int]$entry.listen_port -ne $listenPort -or
      [string]$entry.connect_address -cne $connectAddress -or
      [int]$entry.connect_port -ne $connectPort) {
    throw 'PROVISIONING_WEBREQUEST_PORTPROXY_STATE_INVALID'
  }
  return 'EXACT'
}

function Assert-ProductionPort80ListenerState {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$Listeners,
    [Parameter(Mandatory = $true)][bool]$ExpectPresent
  )

  if (-not $ExpectPresent) {
    if ($Listeners.Count -ne 0) {
      throw 'PROVISIONING_WEBREQUEST_PORT80_OCCUPIED'
    }
    return $true
  }
  if ($Listeners.Count -ne 1 -or
      [string]$Listeners[0].local_address -cne $listenAddress -or
      [int]$Listeners[0].local_port -ne $listenPort -or
      [string]$Listeners[0].process_name -cne 'System') {
    throw 'PROVISIONING_WEBREQUEST_PORT80_LISTENER_INVALID'
  }
  return $true
}

function Test-ProductionPriorWebRequestState {
  [CmdletBinding()]
  param([Parameter(Mandatory = $true)][object]$State)
  return (
    [int]$State.Enabled -eq 0 -and
    @($State.Items).Count -eq 1 -and
    [string]::IsNullOrEmpty([string]@($State.Items)[0])
  )
}

function Invoke-ProductionPersistedPreflight {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$ExpectedOrigin,
    [Parameter(Mandatory = $true)][scriptblock]$SnapshotAction,
    [Parameter(Mandatory = $true)][scriptblock]$ApplyAction
  )

  $prior = & $SnapshotAction
  $wasDesired = Test-MT5VmDesiredWebRequestState `
    -State $prior -ExpectedOrigin $ExpectedOrigin
  if (-not $wasDesired -and -not (Test-ProductionPriorWebRequestState -State $prior)) {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_STATE_INVALID'
  }
  $applied = & $ApplyAction
  $expectedStatus = if ($wasDesired) { 'UNCHANGED' } else { 'APPLIED' }
  if ([string]$applied.status -cne $expectedStatus) {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_PERSIST_FAILED'
  }
  return [pscustomobject][ordered]@{
    status = $expectedStatus
    prior = $prior
  }
}

function Invoke-ProductionCommitRollbackTrace {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][scriptblock]$PreflightAction,
    [Parameter(Mandatory = $true)][scriptblock]$RollbackUiAction
  )

  $preflight = & $PreflightAction
  if ([string]$preflight.status -cne 'APPLIED') {
    throw 'PROVISIONING_WEBREQUEST_COMMIT_ROLLBACK_TRACE_INVALID'
  }
  if ((& $RollbackUiAction $preflight.prior) -ne $true) {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_ROLLBACK_FAILED'
  }
  return [pscustomobject][ordered]@{
    status = 'APPLIED'
    persisted_desired = $true
    restored_prior = $true
  }
}

function Invoke-ProductionAllowlistTransactionCore {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][scriptblock]$PreflightAction,
    [Parameter(Mandatory = $true)][scriptblock]$EnsureProxyAction,
    [Parameter(Mandatory = $true)][scriptblock]$ApplyAction,
    [Parameter(Mandatory = $true)][scriptblock]$ProbeAction,
    [Parameter(Mandatory = $true)][scriptblock]$RollbackUiAction,
    [Parameter(Mandatory = $true)][scriptblock]$RollbackProxyAction
  )

  $preflight = $null
  $proxy = $null
  $first = $null
  try {
    $preflight = & $PreflightAction
    $proxy = & $EnsureProxyAction
    $first = & $ApplyAction
    if ([string]$first.status -notin @('APPLIED', 'UNCHANGED')) {
      throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_APPLY_INVALID'
    }
    $second = & $ApplyAction
    if ([string]$second.status -cne 'UNCHANGED') {
      throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_IDEMPOTENCY_INVALID'
    }
    if ((& $ProbeAction) -ne $true) {
      throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_PROBE_FAILED'
    }
    return [pscustomobject][ordered]@{
      preflight_status = [string]$preflight.status
      proxy_created = [bool]$proxy.created
      status = [string]$first.status
      enabled = $true
      non_empty_count = 1
      probe_verified = $true
    }
  } catch {
    $originalFailure = [string]$_.Exception.Message
    try {
      if ($null -ne $preflight -and [string]$preflight.status -ceq 'APPLIED') {
        if ((& $RollbackUiAction $preflight.prior) -ne $true) {
          throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_ROLLBACK_FAILED'
        }
      }
      if ($null -ne $proxy -and [bool]$proxy.created) {
        if ((& $RollbackProxyAction) -ne $true) {
          throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_ROLLBACK_FAILED'
        }
      }
    } catch {
      throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_ROLLBACK_FAILED'
    }
    throw $originalFailure
  }
}

function Get-ProductionLoopbackPortProxyState {
  [CmdletBinding()]
  param()
  $savedPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $output = @(& netsh.exe interface portproxy show v4tov4 2>&1)
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $savedPreference
  }
  if ($exitCode -ne 0) {
    throw 'PROVISIONING_WEBREQUEST_PORTPROXY_QUERY_FAILED'
  }
  $entries = @(ConvertFrom-ProductionPortProxyOutput -OutputText ($output -join "`n"))
  $status = Assert-ProductionLoopbackPortProxyState -Entries $entries -AllowEmpty
  return [pscustomobject][ordered]@{ status = $status; entries = $entries }
}

function Get-ProductionPort80Listeners {
  [CmdletBinding()]
  param()
  try {
    $connections = @(Get-NetTCPConnection -State Listen -LocalPort $listenPort -ErrorAction Stop)
  } catch [Microsoft.PowerShell.Cmdletization.Cim.CimJobException] {
    if ($_.Exception.Message -match 'No matching') { return @() }
    throw 'PROVISIONING_WEBREQUEST_PORT80_QUERY_FAILED'
  } catch {
    throw 'PROVISIONING_WEBREQUEST_PORT80_QUERY_FAILED'
  }
  $listeners = @()
  foreach ($connection in $connections) {
    $process = Get-Process -Id ([int]$connection.OwningProcess) -ErrorAction SilentlyContinue
    $listeners += [pscustomobject][ordered]@{
      local_address = [string]$connection.LocalAddress
      local_port = [int]$connection.LocalPort
      process_name = if ($null -eq $process) { '' } else { [string]$process.ProcessName }
    }
  }
  return @($listeners)
}

function Assert-ProductionIpHelperRunning {
  [CmdletBinding()]
  param()
  try {
    $service = Get-Service -Name 'iphlpsvc' -ErrorAction Stop
  } catch {
    throw 'PROVISIONING_WEBREQUEST_IPHELPER_INVALID'
  }
  if ($service.Status -ne [ServiceProcess.ServiceControllerStatus]::Running) {
    throw 'PROVISIONING_WEBREQUEST_IPHELPER_INVALID'
  }
}

function Invoke-ProductionNetshAddBoundary {
  [CmdletBinding()]
  param()
  & netsh.exe interface portproxy add v4tov4 `
    'listenaddress=127.0.0.1' 'listenport=80' `
    'connectaddress=127.0.0.1' 'connectport=8790' | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw 'PROVISIONING_WEBREQUEST_PORTPROXY_ADD_FAILED'
  }
}

function Invoke-ProductionNetshDeleteBoundary {
  [CmdletBinding()]
  param()
  & netsh.exe interface portproxy delete v4tov4 `
    'listenaddress=127.0.0.1' 'listenport=80' | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw 'PROVISIONING_WEBREQUEST_PORTPROXY_DELETE_FAILED'
  }
}

function Wait-ProductionPort80ListenerState {
  [CmdletBinding()]
  param([Parameter(Mandatory = $true)][bool]$ExpectPresent)
  for ($attempt = 0; $attempt -lt 50; $attempt++) {
    $listeners = @(Get-ProductionPort80Listeners)
    try {
      $null = Assert-ProductionPort80ListenerState `
        -Listeners $listeners -ExpectPresent $ExpectPresent
      return
    } catch {
      if ($attempt -eq 49) { throw }
    }
    Start-Sleep -Milliseconds 100
  }
}

function Ensure-ProductionLoopbackPortProxy {
  [CmdletBinding()]
  param()
  Assert-ProductionIpHelperRunning
  $initial = Get-ProductionLoopbackPortProxyState
  if ([string]$initial.status -ceq 'EXACT') {
    Wait-ProductionPort80ListenerState -ExpectPresent $true
    return [pscustomobject][ordered]@{ created = $false; status = 'EXISTING' }
  }
  $listeners = @(Get-ProductionPort80Listeners)
  $null = Assert-ProductionPort80ListenerState -Listeners $listeners -ExpectPresent $false
  Invoke-ProductionNetshAddBoundary
  try {
    $after = Get-ProductionLoopbackPortProxyState
    if ([string]$after.status -cne 'EXACT') {
      throw 'PROVISIONING_WEBREQUEST_PORTPROXY_STATE_INVALID'
    }
    Wait-ProductionPort80ListenerState -ExpectPresent $true
    return [pscustomobject][ordered]@{ created = $true; status = 'CREATED' }
  } catch {
    try {
      Invoke-ProductionNetshDeleteBoundary
      $restored = Get-ProductionLoopbackPortProxyState
      if ([string]$restored.status -cne 'EMPTY') {
        throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_ROLLBACK_FAILED'
      }
      Wait-ProductionPort80ListenerState -ExpectPresent $false
    } catch {
      throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_ROLLBACK_FAILED'
    }
    throw
  }
}

function Remove-ProductionOwnedLoopbackPortProxy {
  [CmdletBinding()]
  param()
  $before = Get-ProductionLoopbackPortProxyState
  if ([string]$before.status -cne 'EXACT') {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_ROLLBACK_FAILED'
  }
  try {
    Invoke-ProductionNetshDeleteBoundary
    $after = Get-ProductionLoopbackPortProxyState
    if ([string]$after.status -cne 'EMPTY') {
      throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_ROLLBACK_FAILED'
    }
    Wait-ProductionPort80ListenerState -ExpectPresent $false
  } catch {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_ROLLBACK_FAILED'
  }
  return $true
}

function Assert-ProductionForwardedGatewayHealth {
  [CmdletBinding()]
  param()
  if (-not (Test-Path -LiteralPath $gatewayBinary -PathType Leaf)) {
    throw 'PROVISIONING_GATEWAY_BINARY_MISSING'
  }
  $direct = @(
    Get-NetTCPConnection -State Listen -LocalPort $connectPort -ErrorAction Stop |
      Where-Object { [string]$_.LocalAddress -ceq $connectAddress }
  )
  if ($direct.Count -ne 1) {
    throw 'PROVISIONING_GATEWAY_LISTENER_MISMATCH'
  }
  $owner = Get-Process -Id ([int]$direct[0].OwningProcess) -ErrorAction Stop
  if (-not [string]::Equals(
      [IO.Path]::GetFullPath([string]$owner.Path),
      [IO.Path]::GetFullPath($gatewayBinary),
      [StringComparison]::OrdinalIgnoreCase
    )) {
    throw 'PROVISIONING_GATEWAY_LISTENER_MISMATCH'
  }
  try {
    $response = Invoke-RestMethod -Uri 'http://127.0.0.1/health' -TimeoutSec 5
  } catch {
    throw 'PROVISIONING_WEBREQUEST_PORTPROXY_HEALTH_FAILED'
  }
  if ($response.ok -isnot [bool] -or -not [bool]$response.ok -or
      [string]$response.service -cne 'execution-gateway' -or
      [int]$response.protocolVersion -ne 1) {
    throw 'PROVISIONING_WEBREQUEST_PORTPROXY_HEALTH_FAILED'
  }
  return $true
}

function Invoke-ProductionAllowlistProbe {
  [CmdletBinding()]
  param()
  $savedPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $output = @(
      & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass `
        -File $probeDriver 2>&1
    )
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $savedPreference
  }
  if ($exitCode -ne 0 -or
      @($output | Where-Object {
          [string]$_ -match '^PRODUCTION_WEBREQUEST_PROBE=PASS proof=.+$'
        }).Count -ne 1) {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_PROBE_FAILED'
  }
  return $true
}

function Assert-ContractFailure {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][scriptblock]$Action,
    [Parameter(Mandatory = $true)][string]$ExpectedCode
  )
  try {
    & $Action
  } catch {
    if ([string]$_.Exception.Message -ceq $ExpectedCode) { return }
    throw
  }
  throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_CONTRACT_FAILED_OPEN'
}

function Read-ProductionWebRequestCommonIniFromBytesForContract {
  [CmdletBinding()]
  param([Parameter(Mandatory = $true)][byte[]]$Bytes)
  $model = Get-ProductionCommonIniModel -Bytes $Bytes -ExpectedOrigin $expectedOrigin
  return [bool]$model.IsDesired
}

function New-ProductionCommonIniContractFixtureBytes {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][AllowEmptyString()][string]$WebValue,
    [Parameter(Mandatory = $true)][AllowEmptyString()][string]$UrlValue,
    [switch]$DuplicateWeb,
    [switch]$MoveUrlOutsideExperts
  )
  $crlf = "`r`n"
  $webLine = "WebRequest=$WebValue"
  if ($DuplicateWeb) { $webLine += $crlf + "WebRequest=$WebValue" }
  $urlLine = if ($MoveUrlOutsideExperts) { '' } else { "WebRequestUrl=$UrlValue" }
  $outside = if ($MoveUrlOutsideExperts) {
    $crlf + '[Outside]' + $crlf + "WebRequestUrl=$UrlValue"
  } else {
    $crlf + '[Outside]' + $crlf + 'Untouched=tail'
  }
  $text = (
    '[General]' + $crlf + 'Untouched=prefix' + $crlf +
    '[Experts]' + $crlf + 'Enabled=1' + $crlf +
    $webLine + $crlf + $urlLine + $crlf +
    'Secret=SuperSecretSentinel-v36' + $outside + $crlf
  )
  return ,(New-ProductionUtf16LeBomBytes -Text $text)
}

function Invoke-ProductionCommonIniContractTests {
  [CmdletBinding()]
  param()
  $contractRoot = Join-Path ([IO.Path]::GetTempPath()) (
    'marketlens-v36-' + [guid]::NewGuid().ToString('N')
  )
  $null = [IO.Directory]::CreateDirectory($contractRoot)
  $commonPath = Join-Path $contractRoot 'common.ini'
  try {
    $priorBytes = New-ProductionCommonIniContractFixtureBytes `
      -WebValue '0' -UrlValue ''
    $conversion = Convert-ProductionWebRequestCommonIni `
      -Bytes $priorBytes -ExpectedOrigin $expectedOrigin
    Assert-ProductionAllowlistTrue (
      [string]$conversion.Status -ceq 'APPLIED' -and
      (Read-ProductionWebRequestCommonIniFromBytesForContract `
        -Bytes ([byte[]]$conversion.Bytes))
    ) 'PROVISIONING_WEBREQUEST_ALLOWLIST_CONTRACT_FAILED'

    Assert-ContractFailure `
      -ExpectedCode 'PROVISIONING_WEBREQUEST_ALLOWLIST_SCHEMA_INVALID' -Action {
        $duplicate = New-ProductionCommonIniContractFixtureBytes `
          -WebValue '0' -UrlValue '' -DuplicateWeb
        Convert-ProductionWebRequestCommonIni `
          -Bytes $duplicate -ExpectedOrigin $expectedOrigin
      }
    Assert-ContractFailure `
      -ExpectedCode 'PROVISIONING_WEBREQUEST_ALLOWLIST_SCHEMA_INVALID' -Action {
        $moved = New-ProductionCommonIniContractFixtureBytes `
          -WebValue '0' -UrlValue '' -MoveUrlOutsideExperts
        Convert-ProductionWebRequestCommonIni `
          -Bytes $moved -ExpectedOrigin $expectedOrigin
      }
    Assert-ContractFailure `
      -ExpectedCode 'PROVISIONING_WEBREQUEST_ALLOWLIST_SCHEMA_INVALID' -Action {
        Convert-ProductionWebRequestCommonIni `
          -Bytes ([Text.Encoding]::UTF8.GetBytes('[Experts]')) `
          -ExpectedOrigin $expectedOrigin
      }
    Assert-ContractFailure `
      -ExpectedCode 'PROVISIONING_WEBREQUEST_ALLOWLIST_PRIOR_STATE_INVALID' -Action {
        $wrong = New-ProductionCommonIniContractFixtureBytes `
          -WebValue '1' -UrlValue 'http://127.0.0.1:9999'
        Convert-ProductionWebRequestCommonIni `
          -Bytes $wrong -ExpectedOrigin $expectedOrigin
      }
    Assert-ContractFailure `
      -ExpectedCode 'PROVISIONING_WEBREQUEST_ALLOWLIST_SCHEMA_INVALID' -Action {
        Convert-ProductionWebRequestCommonIni `
          -Bytes (New-Object byte[] ($maximumCommonIniBytes + 1)) `
          -ExpectedOrigin $expectedOrigin
      }

    [IO.File]::WriteAllBytes($commonPath, $priorBytes)
    $rollbackAction = {
      param($target, $backup, $bytes, $hash, $sddl)
      Restore-ProductionWebRequestCommonIniSnapshot `
        -CommonIniPath $target -BackupPath $backup `
        -SnapshotBytes $bytes -SnapshotHash $hash -SnapshotSddl $sddl
      return $true
    }
    $applied = Invoke-ProductionWebRequestCommonIniTransaction `
      -CommonIniPath $commonPath -ExpectedOrigin $expectedOrigin `
      -PreconditionAction {} -ProbeAction { return $true } `
      -QuiesceAction {} -RollbackAction $rollbackAction
    Assert-ProductionAllowlistTrue (
      [string]$applied.status -ceq 'APPLIED' -and
      -not (Test-Path -LiteralPath ($commonPath + '.marketlens-v36.bak'))
    ) 'PROVISIONING_WEBREQUEST_ALLOWLIST_CONTRACT_FAILED'
    $firstHash = (Read-ProductionWebRequestCommonIni `
      -Path $commonPath -ExpectedOrigin $expectedOrigin).Hash
    $unchanged = Invoke-ProductionWebRequestCommonIniTransaction `
      -CommonIniPath $commonPath -ExpectedOrigin $expectedOrigin `
      -PreconditionAction {} -ProbeAction { return $true } `
      -QuiesceAction {} -RollbackAction $rollbackAction
    $secondHash = (Read-ProductionWebRequestCommonIni `
      -Path $commonPath -ExpectedOrigin $expectedOrigin).Hash
    Assert-ProductionAllowlistTrue (
      [string]$unchanged.status -ceq 'UNCHANGED' -and $firstHash -ceq $secondHash
    ) 'PROVISIONING_WEBREQUEST_ALLOWLIST_CONTRACT_FAILED'
    [IO.File]::WriteAllBytes($commonPath, $priorBytes)
    $trace = Invoke-ProductionWebRequestCommonIniTransaction `
      -CommonIniPath $commonPath -ExpectedOrigin $expectedOrigin `
      -PreconditionAction {} -ProbeAction { return $true } `
      -QuiesceAction {} -RollbackAction $rollbackAction -RollbackOnSuccess
    Assert-ProductionAllowlistTrue (
      [string]$trace.status -ceq 'APPLIED' -and
      [bool]$trace.persisted_desired -and [bool]$trace.restored_prior -and
      (Test-ProductionByteArrayEqual `
        -Left $priorBytes -Right ([IO.File]::ReadAllBytes($commonPath)))
    ) 'PROVISIONING_WEBREQUEST_ALLOWLIST_CONTRACT_FAILED'
    Write-Output 'PRODUCTION_WEBREQUEST_ALLOWLIST_CONFIG_CONTRACTS=PASS'

    [IO.File]::WriteAllBytes($commonPath, $priorBytes)
    Assert-ContractFailure `
      -ExpectedCode 'PROVISIONING_WEBREQUEST_ALLOWLIST_PROBE_FAILED' -Action {
        Invoke-ProductionWebRequestCommonIniTransaction `
          -CommonIniPath $commonPath -ExpectedOrigin $expectedOrigin `
          -PreconditionAction {} `
          -ProbeAction { throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_PROBE_FAILED' } `
          -QuiesceAction {} -RollbackAction $rollbackAction
      }
    Assert-ProductionAllowlistTrue (
      (Test-ProductionByteArrayEqual `
        -Left $priorBytes -Right ([IO.File]::ReadAllBytes($commonPath))) -and
      -not (Test-Path -LiteralPath ($commonPath + '.marketlens-v36.bak'))
    ) 'PROVISIONING_WEBREQUEST_ALLOWLIST_CONTRACT_FAILED'

    [IO.File]::WriteAllBytes($commonPath, $priorBytes)
    Assert-ContractFailure `
      -ExpectedCode 'PROVISIONING_WEBREQUEST_ALLOWLIST_ROLLBACK_FAILED' -Action {
        Invoke-ProductionWebRequestCommonIniTransaction `
          -CommonIniPath $commonPath -ExpectedOrigin $expectedOrigin `
          -PreconditionAction {} `
          -ProbeAction { throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_PROBE_FAILED' } `
          -QuiesceAction {} -RollbackAction { return $false }
      }
    $backupPath = $commonPath + '.marketlens-v36.bak'
    if (Test-Path -LiteralPath $backupPath -PathType Leaf) {
      Remove-Item -LiteralPath $backupPath -Force
    }

    [IO.File]::WriteAllBytes($commonPath, $priorBytes)
    $priorAcl = Get-Acl -LiteralPath $commonPath
    $desiredBytes = [byte[]](Convert-ProductionWebRequestCommonIni `
      -Bytes $priorBytes -ExpectedOrigin $expectedOrigin).Bytes
    [IO.File]::WriteAllBytes($backupPath, $priorBytes)
    Set-Acl -LiteralPath $backupPath -AclObject $priorAcl
    [IO.File]::WriteAllBytes($commonPath, $desiredBytes)
    Set-Acl -LiteralPath $commonPath -AclObject $priorAcl
    $recovered = Invoke-ProductionWebRequestCommonIniTransaction `
      -CommonIniPath $commonPath -ExpectedOrigin $expectedOrigin `
      -PreconditionAction {} -ProbeAction { return $true } `
      -QuiesceAction {} -RollbackAction $rollbackAction
    Assert-ProductionAllowlistTrue (
      [string]$recovered.status -ceq 'RECOVERED' -and
      -not (Test-Path -LiteralPath $backupPath)
    ) 'PROVISIONING_WEBREQUEST_ALLOWLIST_CONTRACT_FAILED'

    [IO.File]::WriteAllBytes($backupPath, $priorBytes)
    Set-Acl -LiteralPath $backupPath -AclObject $priorAcl
    [IO.File]::WriteAllBytes($commonPath, $priorBytes)
    Set-Acl -LiteralPath $commonPath -AclObject $priorAcl
    Assert-ContractFailure `
      -ExpectedCode 'PROVISIONING_WEBREQUEST_ALLOWLIST_RECOVERY_STATE_INVALID' -Action {
        Invoke-ProductionWebRequestCommonIniTransaction `
          -CommonIniPath $commonPath -ExpectedOrigin $expectedOrigin `
          -PreconditionAction {} -ProbeAction { return $true } `
          -QuiesceAction {} -RollbackAction $rollbackAction
      }
    Write-Output 'PRODUCTION_WEBREQUEST_ALLOWLIST_RECOVERY_CONTRACTS=PASS'
  } finally {
    if (Test-Path -LiteralPath $contractRoot -PathType Container) {
      Remove-Item -LiteralPath $contractRoot -Recurse -Force
    }
  }
}

function Invoke-ProductionAllowlistContractTests {
  [CmdletBinding()]
  param()
  Invoke-ProductionCommonIniContractTests

  $empty = @(ConvertFrom-ProductionPortProxyOutput -OutputText '')
  Assert-ProductionAllowlistTrue (
    (Assert-ProductionLoopbackPortProxyState -Entries $empty -AllowEmpty) -ceq 'EMPTY'
  ) 'PROVISIONING_WEBREQUEST_ALLOWLIST_CONTRACT_FAILED'
  $exactText = @'
Listen on ipv4:             Connect to ipv4:

Address         Port        Address         Port
--------------- ----------  --------------- ----------
127.0.0.1       80          127.0.0.1       8790
'@
  $exact = @(ConvertFrom-ProductionPortProxyOutput -OutputText $exactText)
  Assert-ProductionAllowlistTrue (
    (Assert-ProductionLoopbackPortProxyState -Entries $exact) -ceq 'EXACT'
  ) 'PROVISIONING_WEBREQUEST_ALLOWLIST_CONTRACT_FAILED'
  foreach ($invalidText in @(
      '0.0.0.0 80 127.0.0.1 8790',
      '127.0.0.1 80 127.0.0.1 8791',
      "127.0.0.1 80 127.0.0.1 8790`n127.0.0.1 80 127.0.0.1 8790"
    )) {
    Assert-ContractFailure -ExpectedCode 'PROVISIONING_WEBREQUEST_PORTPROXY_STATE_INVALID' -Action {
      $entries = @(ConvertFrom-ProductionPortProxyOutput -OutputText $invalidText)
      Assert-ProductionLoopbackPortProxyState -Entries $entries
    }
  }
  Assert-ContractFailure -ExpectedCode 'PROVISIONING_WEBREQUEST_PORTPROXY_OUTPUT_INVALID' -Action {
    ConvertFrom-ProductionPortProxyOutput -OutputText '::1 80 127.0.0.1 8790'
  }
  $null = Assert-ProductionPort80ListenerState -Listeners @() -ExpectPresent $false
  $null = Assert-ProductionPort80ListenerState -Listeners @(
    [pscustomobject]@{
      local_address = '127.0.0.1'
      local_port = 80
      process_name = 'System'
    }
  ) -ExpectPresent $true
  Write-Output 'PRODUCTION_WEBREQUEST_ALLOWLIST_PORTPROXY_CONTRACTS=PASS'

  $script:contractPrior = [pscustomobject][ordered]@{ Enabled = 0; Items = @('') }
  $script:contractEvents = [Collections.Generic.List[string]]::new()
  $preflight = Invoke-ProductionPersistedPreflight -ExpectedOrigin $expectedOrigin `
    -SnapshotAction {
      $script:contractEvents.Add('snapshot')
      return $script:contractPrior
    } `
    -ApplyAction {
      $script:contractEvents.Add('apply-persisted')
      return [pscustomobject]@{ status = 'APPLIED' }
    }
  Assert-ProductionAllowlistTrue (
    [string]$preflight.status -ceq 'APPLIED' -and
    ($script:contractEvents -join ',') -ceq 'snapshot,apply-persisted' -and
    (Test-ProductionPriorWebRequestState -State $preflight.prior)
  ) 'PROVISIONING_WEBREQUEST_ALLOWLIST_CONTRACT_FAILED'

  $script:contractEvents = [Collections.Generic.List[string]]::new()
  $trace = Invoke-ProductionCommitRollbackTrace -PreflightAction {
    $script:contractEvents.Add('preflight')
    return [pscustomobject]@{ status = 'APPLIED'; prior = $script:contractPrior }
  } -RollbackUiAction {
    param($prior)
    $script:contractEvents.Add('rollback-ui')
    return (Test-ProductionPriorWebRequestState -State $prior)
  }
  Assert-ProductionAllowlistTrue (
    [string]$trace.status -ceq 'APPLIED' -and
    [bool]$trace.persisted_desired -and
    [bool]$trace.restored_prior -and
    ($script:contractEvents -join ',') -ceq 'preflight,rollback-ui'
  ) 'PROVISIONING_WEBREQUEST_ALLOWLIST_CONTRACT_FAILED'
  Write-Output 'PRODUCTION_WEBREQUEST_ALLOWLIST_PREFLIGHT_CONTRACTS=PASS'

  $script:contractEvents = [Collections.Generic.List[string]]::new()
  $script:applyCount = 0
  $success = Invoke-ProductionAllowlistTransactionCore -PreflightAction {
    $script:contractEvents.Add('preflight')
    return [pscustomobject]@{
      status = 'APPLIED'
      prior = [pscustomobject]@{ Enabled = 0; Items = @('') }
    }
  } -EnsureProxyAction {
    $script:contractEvents.Add('proxy')
    return [pscustomobject]@{ created = $true }
  } -ApplyAction {
    $script:applyCount += 1
    $script:contractEvents.Add('apply')
    return [pscustomobject]@{
      status = 'UNCHANGED'
    }
  } -ProbeAction {
    $script:contractEvents.Add('probe')
    return $true
  } -RollbackUiAction {
    $script:contractEvents.Add('rollback-ui')
    return $true
  } -RollbackProxyAction {
    $script:contractEvents.Add('rollback-proxy')
    return $true
  }
  Assert-ProductionAllowlistTrue (
    [string]$success.status -ceq 'UNCHANGED' -and
    ($script:contractEvents -join ',') -ceq
      'preflight,proxy,apply,apply,probe'
  ) 'PROVISIONING_WEBREQUEST_ALLOWLIST_CONTRACT_FAILED'

  $script:contractEvents = [Collections.Generic.List[string]]::new()
  $script:applyCount = 0
  Assert-ContractFailure -ExpectedCode 'PROVISIONING_WEBREQUEST_ALLOWLIST_PROBE_FAILED' -Action {
    Invoke-ProductionAllowlistTransactionCore -PreflightAction {
      $script:contractEvents.Add('preflight')
      return [pscustomobject]@{
        status = 'APPLIED'
        prior = [pscustomobject]@{ Enabled = 0; Items = @('') }
      }
    } -EnsureProxyAction {
      $script:contractEvents.Add('proxy')
      return [pscustomobject]@{ created = $true }
    } -ApplyAction {
      $script:applyCount += 1
      $script:contractEvents.Add('apply')
      return [pscustomobject]@{
        status = 'UNCHANGED'
      }
    } -ProbeAction {
      $script:contractEvents.Add('probe')
      throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_PROBE_FAILED'
    } -RollbackUiAction {
      param($prior)
      $script:contractEvents.Add('rollback-ui')
      return (Test-ProductionPriorWebRequestState -State $prior)
    } -RollbackProxyAction {
      $script:contractEvents.Add('rollback-proxy')
      return $true
    }
  }
  Assert-ProductionAllowlistTrue (
    ($script:contractEvents -join ',') -ceq
      'preflight,proxy,apply,apply,probe,rollback-ui,rollback-proxy'
  ) 'PROVISIONING_WEBREQUEST_ALLOWLIST_CONTRACT_FAILED'

  $script:contractEvents = [Collections.Generic.List[string]]::new()
  $script:applyCount = 0
  Assert-ContractFailure -ExpectedCode 'PROVISIONING_WEBREQUEST_ALLOWLIST_PROBE_FAILED' -Action {
    Invoke-ProductionAllowlistTransactionCore -PreflightAction {
      $script:contractEvents.Add('preflight')
      return [pscustomobject]@{
        status = 'UNCHANGED'
        prior = [pscustomobject]@{ Enabled = 0; Items = @('') }
      }
    } -EnsureProxyAction {
      $script:contractEvents.Add('proxy-existing')
      return [pscustomobject]@{ created = $false }
    } -ApplyAction {
      $script:applyCount += 1
      $script:contractEvents.Add('apply')
      return [pscustomobject]@{
        status = 'UNCHANGED'
      }
    } -ProbeAction {
      $script:contractEvents.Add('probe')
      throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_PROBE_FAILED'
    } -RollbackUiAction {
      param($prior)
      $script:contractEvents.Add('rollback-ui')
      return (Test-ProductionPriorWebRequestState -State $prior)
    } -RollbackProxyAction {
      $script:contractEvents.Add('rollback-proxy')
      return $true
    }
  }
  Assert-ProductionAllowlistTrue (
    ($script:contractEvents -join ',') -ceq
      'preflight,proxy-existing,apply,apply,probe'
  ) 'PROVISIONING_WEBREQUEST_ALLOWLIST_CONTRACT_FAILED'

  $script:contractEvents = [Collections.Generic.List[string]]::new()
  Assert-ContractFailure -ExpectedCode 'PROVISIONING_WEBREQUEST_ALLOWLIST_PERSIST_FAILED' -Action {
    Invoke-ProductionAllowlistTransactionCore -PreflightAction {
      $script:contractEvents.Add('preflight')
      throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_PERSIST_FAILED'
    } -EnsureProxyAction {
      $script:contractEvents.Add('proxy')
      return [pscustomobject]@{ created = $true }
    } -ApplyAction {
      $script:contractEvents.Add('apply')
    } -ProbeAction {
      $script:contractEvents.Add('probe')
    } -RollbackUiAction {
      $script:contractEvents.Add('rollback-ui')
    } -RollbackProxyAction {
      $script:contractEvents.Add('rollback-proxy')
    }
  }
  Assert-ProductionAllowlistTrue (
    ($script:contractEvents -join ',') -ceq 'preflight'
  ) 'PROVISIONING_WEBREQUEST_ALLOWLIST_CONTRACT_FAILED'

  $script:applyCount = 0
  Assert-ContractFailure -ExpectedCode 'PROVISIONING_WEBREQUEST_ALLOWLIST_ROLLBACK_FAILED' -Action {
    Invoke-ProductionAllowlistTransactionCore -PreflightAction {
      return [pscustomobject]@{
        status = 'APPLIED'
        prior = [pscustomobject]@{ Enabled = 0; Items = @('') }
      }
    } -EnsureProxyAction {
      return [pscustomobject]@{ created = $true }
    } -ApplyAction {
      $script:applyCount += 1
      return [pscustomobject]@{
        status = 'UNCHANGED'
      }
    } -ProbeAction {
      throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_PROBE_FAILED'
    } -RollbackUiAction {
      return $false
    } -RollbackProxyAction {
      return $true
    }
  }
  Write-Output 'PRODUCTION_WEBREQUEST_ALLOWLIST_ROLLBACK_CONTRACTS=PASS'
  Write-Output 'PRODUCTION_WEBREQUEST_ALLOWLIST_CONTRACTS=PASS'
}

if ($ContractTestsOnly) {
  if ($KnownBadControl) {
    $duplicate = New-ProductionCommonIniContractFixtureBytes `
      -WebValue '0' -UrlValue '' -DuplicateWeb
    Convert-ProductionWebRequestCommonIni `
      -Bytes $duplicate -ExpectedOrigin $expectedOrigin
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_KNOWN_BAD_FAILED_OPEN'
  }
  if ($UnreadableInputControl) {
    $controlRoot = Join-Path ([IO.Path]::GetTempPath()) (
      'marketlens-v36-unreadable-' + [guid]::NewGuid().ToString('N')
    )
    $null = [IO.Directory]::CreateDirectory($controlRoot)
    $controlPath = Join-Path $controlRoot 'common.ini'
    [IO.File]::WriteAllBytes(
      $controlPath,
      (New-ProductionCommonIniContractFixtureBytes -WebValue '0' -UrlValue '')
    )
    $lock = $null
    $failure = ''
    try {
      $lock = New-Object IO.FileStream(
        $controlPath,
        [IO.FileMode]::Open,
        [IO.FileAccess]::ReadWrite,
        [IO.FileShare]::None
      )
      try {
        Read-ProductionWebRequestCommonIni `
          -Path $controlPath -ExpectedOrigin $expectedOrigin
      } catch {
        $failure = [string]$_.Exception.Message
      }
    } finally {
      if ($null -ne $lock) { $lock.Dispose() }
      if (Test-Path -LiteralPath $controlRoot -PathType Container) {
        Remove-Item -LiteralPath $controlRoot -Recurse -Force
      }
    }
    if ($failure -cne 'PROVISIONING_WEBREQUEST_ALLOWLIST_CONFIG_UNREADABLE') {
      throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_UNREADABLE_CONTROL_FAILED_OPEN'
    }
    throw $failure
  }
  if ($OccupiedPortControl) {
    Assert-ProductionPort80ListenerState -Listeners @(
      [pscustomobject]@{
        local_address = '127.0.0.1'
        local_port = 80
        process_name = 'Unexpected'
      }
    ) -ExpectPresent $false
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_OCCUPIED_CONTROL_FAILED_OPEN'
  }
  if ($MouseHitControl) {
    if (-not (Test-Path -LiteralPath $uiHelper -PathType Leaf)) {
      throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_HELPER_MISSING'
    }
    . $uiHelper
    Assert-MT5VmPhysicalMousePointIdentity `
      -ExpectedListHandle ([IntPtr]42) `
      -ObservedPointHandle ([IntPtr]99)
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_MOUSE_CONTROL_FAILED_OPEN'
  }
  if ($CursorRestoreControl) {
    if (-not (Test-Path -LiteralPath $uiHelper -PathType Leaf)) {
      throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_HELPER_MISSING'
    }
    . $uiHelper
    Invoke-MT5VmPhysicalMouseActivationTransactionCore `
      -CaptureCursorAction {
        return [pscustomobject]@{ x = 7; y = 9 }
      } `
      -ActivationAction { return $true } `
      -ContinuationAction { return $true } `
      -RestoreCursorAction { return $false }
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_CURSOR_CONTROL_FAILED_OPEN'
  }
  if (-not (Test-Path -LiteralPath $uiHelper -PathType Leaf)) {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_HELPER_MISSING'
  }
  . $uiHelper
  Invoke-ProductionAllowlistContractTests
  exit 0
}

$commonIniPath = Join-Path $selectedProfile $commonIniRelativePath
$ownedProxy = $null
$productionRollback = {
  param($target, $backup, $bytes, $hash, $sddl)
  Restore-ProductionWebRequestCommonIniSnapshot `
    -CommonIniPath $target -BackupPath $backup `
    -SnapshotBytes $bytes -SnapshotHash $hash -SnapshotSddl $sddl
  return $true
}

Assert-ProductionSelectedTerminalAndProfile
Assert-ProductionSelectedTerminalAbsent

if ($CommitRollbackTrace) {
  $initialProxy = Get-ProductionLoopbackPortProxyState
  if ([string]$initialProxy.status -cne 'EMPTY') {
    throw 'PROVISIONING_WEBREQUEST_COMMIT_ROLLBACK_TRACE_PROXY_PRESENT'
  }
  $null = Assert-ProductionPort80ListenerState `
    -Listeners @(Get-ProductionPort80Listeners) -ExpectPresent $false
  $trace = Invoke-ProductionWebRequestCommonIniTransaction `
    -CommonIniPath $commonIniPath `
    -ExpectedOrigin $expectedOrigin `
    -PreconditionAction { Assert-ProductionSelectedTerminalAbsent } `
    -ProbeAction { return $true } `
    -QuiesceAction { Assert-ProductionSelectedTerminalAbsent } `
    -RollbackAction $productionRollback `
    -RollbackOnSuccess
  Write-Output (
    'PRODUCTION_WEBREQUEST_ALLOWLIST_COMMIT_ROLLBACK=PASS status={0} persisted_desired={1} restored_prior={2}' -f
      [string]$trace.status,
      [bool]$trace.persisted_desired,
      [bool]$trace.restored_prior
  )
  return
}

try {
  $result = Invoke-ProductionWebRequestCommonIniTransaction `
    -CommonIniPath $commonIniPath `
    -ExpectedOrigin $expectedOrigin `
    -PreconditionAction { Assert-ProductionSelectedTerminalAbsent } `
    -ProbeAction {
      $ownedProxy = Ensure-ProductionLoopbackPortProxy
      $null = Assert-ProductionForwardedGatewayHealth
      return [bool](Invoke-ProductionAllowlistProbe)
    } `
    -QuiesceAction { Wait-ProductionSelectedTerminalAbsent } `
    -RollbackAction $productionRollback
  Write-Output (
    'PRODUCTION_WEBREQUEST_ALLOWLIST=PASS proxy_created={0} status={1} enabled={2} non_empty_count={3} probe_verified={4}' -f
      [bool]$ownedProxy.created,
      [string]$result.status,
      [bool]$result.enabled,
      [int]$result.non_empty_count,
      [bool]$result.probe_verified
  )
} catch {
  $originalFailure = [string]$_.Exception.Message
  if ($null -ne $ownedProxy -and [bool]$ownedProxy.created) {
    try {
      if (-not (Remove-ProductionOwnedLoopbackPortProxy)) {
        throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_ROLLBACK_FAILED'
      }
    } catch {
      throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_ROLLBACK_FAILED'
    }
  }
  throw $originalFailure
}
