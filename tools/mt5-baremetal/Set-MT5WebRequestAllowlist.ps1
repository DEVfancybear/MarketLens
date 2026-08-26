[CmdletBinding()]
param(
  [switch]$ContractTestsOnly,
  [switch]$KnownBadControl,
  [switch]$UnreadableInputControl
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$selectedTerminal = 'C:\Program Files\MetaTrader 5\terminal64.exe'
$selectedProfileRoot = 'C:\Users\Duong\AppData\Roaming\MetaQuotes\Terminal\D0E8209F77C8CF37AD8BF550E51FF075'
$expectedPublisher = 'CN=MetaQuotes Ltd., O=MetaQuotes Ltd., S=Lemesos, C=CY'
$expectedOrigin = 'http://127.0.0.1:8790'
$commonIniRelativePath = 'config\common.ini'
$probeDriver = Join-Path $PSScriptRoot 'Invoke-MT5WebRequestProbe.ps1'
$maximumCommonIniBytes = 1048576

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
  $desiredModel = Get-ProductionCommonIniModel -Bytes $desiredBytes -ExpectedOrigin $ExpectedOrigin
  if (-not [bool]$desiredModel.IsDesired) {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_TRANSFORM_INVALID'
  }
  $reverseText = Set-ProductionCommonIniValueSpans -Model $desiredModel -WebValue '0' -UrlValue ''
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
  try {
    $cursor = Get-Item -LiteralPath ([IO.Path]::GetFullPath($Path)) -Force -ErrorAction Stop
    while ($null -ne $cursor) {
      if (($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_REPARSE_PATH_REJECTED'
      }
      $cursor = if ($cursor -is [IO.FileInfo]) { $cursor.Directory } else { $cursor.Parent }
    }
  } catch {
    if ([string]$_.Exception.Message -ceq
        'PROVISIONING_WEBREQUEST_ALLOWLIST_REPARSE_PATH_REJECTED') {
      throw
    }
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_PATH_INVALID'
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
      $selectedProfileRoot,
      (Join-Path $selectedProfileRoot 'origin.txt'),
      (Join-Path $selectedProfileRoot $commonIniRelativePath),
      $probeDriver
    )) {
    Assert-ProductionAllowlistTrue (Test-Path -LiteralPath $path) 'PROVISIONING_WEBREQUEST_ALLOWLIST_PATH_INVALID'
    Assert-ProductionNoReparseComponent -Path $path
  }
  Assert-ProductionAllowlistTrue (
    Test-Path -LiteralPath $selectedTerminal -PathType Leaf
  ) 'PROVISIONING_WEBREQUEST_ALLOWLIST_PATH_INVALID'
  Assert-ProductionAllowlistTrue (
    Test-Path -LiteralPath $selectedProfileRoot -PathType Container
  ) 'PROVISIONING_WEBREQUEST_ALLOWLIST_PATH_INVALID'
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
    $originPath = Join-Path $selectedProfileRoot 'origin.txt'
    $observedInstall = [IO.Path]::GetFullPath(
      (Get-Content -LiteralPath $originPath -Raw).Trim()
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
  $backupPath = $CommonIniPath + '.marketlens-v27.bak'
  if (Test-Path -LiteralPath $backupPath) {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_RECOVERY_STATE_INVALID'
  }
  $temporaryPath = Join-Path $parent (
    '.marketlens-v27-' + [guid]::NewGuid().ToString('N') + '.tmp'
  )
  $originalBytes = [IO.File]::ReadAllBytes($CommonIniPath)
  $originalHash = Get-ProductionSha256Hex -Bytes $originalBytes
  $originalAcl = Get-Acl -LiteralPath $CommonIniPath -ErrorAction Stop
  $originalSddl = [string]$originalAcl.Sddl
  try {
    Write-ProductionCreateNewFile -Path $temporaryPath -Bytes $DesiredBytes -Acl $originalAcl
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
    '.marketlens-v27-restore-' + [guid]::NewGuid().ToString('N') + '.tmp'
  )
  $failedPath = Join-Path $parent (
    '.marketlens-v27-failed-' + [guid]::NewGuid().ToString('N') + '.tmp'
  )
  try {
    $backupBytes = [IO.File]::ReadAllBytes($BackupPath)
    if ((Get-ProductionSha256Hex -Bytes $backupBytes) -cne $SnapshotHash -or
        (Get-ProductionAclSddl -Path $BackupPath) -cne $SnapshotSddl) {
      throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_ROLLBACK_FAILED'
    }
    $snapshotAcl = Get-Acl -LiteralPath $BackupPath -ErrorAction Stop
    Write-ProductionCreateNewFile -Path $temporaryPath -Bytes $SnapshotBytes -Acl $snapshotAcl
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
    [Parameter(Mandatory = $true)][scriptblock]$RollbackAction
  )
  & $PreconditionAction
  $backupPath = $CommonIniPath + '.marketlens-v27.bak'
  $backupExistedOnEntry = Test-Path -LiteralPath $backupPath -PathType Leaf
  $snapshotBytes = $null
  $snapshotHash = ''
  $snapshotSddl = ''
  $hasRollbackSnapshot = $false
  $status = ''

  try {
    if ($backupExistedOnEntry) {
      Assert-ProductionNoReparseComponent -Path $backupPath
      $backupState = Read-ProductionWebRequestCommonIni -Path $backupPath -ExpectedOrigin $ExpectedOrigin
      $currentState = Read-ProductionWebRequestCommonIni -Path $CommonIniPath -ExpectedOrigin $ExpectedOrigin
      if (-not [bool]$backupState.IsPrior -or -not [bool]$currentState.IsDesired) {
        throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_RECOVERY_STATE_INVALID'
      }
      $expectedCurrent = Convert-ProductionWebRequestCommonIni -Bytes ([byte[]]$backupState.Bytes) -ExpectedOrigin $ExpectedOrigin
      if (-not (Test-ProductionByteArrayEqual -Left ([byte[]]$currentState.Bytes) -Right ([byte[]]$expectedCurrent.Bytes))) {
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
      $currentState = Read-ProductionWebRequestCommonIni -Path $CommonIniPath -ExpectedOrigin $ExpectedOrigin
      $currentSddl = Get-ProductionAclSddl -Path $CommonIniPath
      $conversion = Convert-ProductionWebRequestCommonIni -Bytes ([byte[]]$currentState.Bytes) -ExpectedOrigin $ExpectedOrigin
      if ([string]$conversion.Status -ceq 'UNCHANGED') {
        $snapshotBytes = [byte[]]$currentState.Bytes
        $snapshotHash = [string]$currentState.Hash
        $snapshotSddl = $currentSddl
        $status = 'UNCHANGED'
      } else {
        $replacement = Invoke-ProductionAtomicCommonIniReplace -CommonIniPath $CommonIniPath -DesiredBytes ([byte[]]$conversion.Bytes)
        $snapshotBytes = [byte[]]$replacement.SnapshotBytes
        $snapshotHash = [string]$replacement.SnapshotHash
        $snapshotSddl = [string]$replacement.SnapshotSddl
        $hasRollbackSnapshot = $true
        $status = 'APPLIED'
        $afterWrite = Read-ProductionWebRequestCommonIni -Path $CommonIniPath -ExpectedOrigin $ExpectedOrigin
        $idempotent = Convert-ProductionWebRequestCommonIni -Bytes ([byte[]]$afterWrite.Bytes) -ExpectedOrigin $ExpectedOrigin
        if ([string]$idempotent.Status -cne 'UNCHANGED' -or
            [string]$idempotent.DesiredHash -cne [string]$afterWrite.Hash) {
          throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_IDEMPOTENCY_INVALID'
        }
      }
    }

    $probeResult = & $ProbeAction
    if ($probeResult -ne $true) {
      throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_PROBE_INVALID'
    }
    & $QuiesceAction
    $postProbe = Read-ProductionWebRequestCommonIni -Path $CommonIniPath -ExpectedOrigin $ExpectedOrigin
    if (-not [bool]$postProbe.IsDesired -or
        (Get-ProductionAclSddl -Path $CommonIniPath) -cne $snapshotSddl) {
      throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_POST_PROBE_INVALID'
    }
    if ($hasRollbackSnapshot) {
      $expectedPostProbe = Convert-ProductionWebRequestCommonIni -Bytes $snapshotBytes -ExpectedOrigin $ExpectedOrigin
      if (-not (Test-ProductionByteArrayEqual -Left ([byte[]]$postProbe.Bytes) -Right ([byte[]]$expectedPostProbe.Bytes))) {
        throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_POST_PROBE_INVALID'
      }
      Remove-Item -LiteralPath $backupPath -Force
    } elseif ([string]$postProbe.Hash -cne $snapshotHash) {
      throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_POST_PROBE_INVALID'
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
        $emergencySnapshot = Read-ProductionWebRequestCommonIni -Path $backupPath -ExpectedOrigin $ExpectedOrigin
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
      )) {
      try {
        & $QuiesceAction
        $rollbackResult = & $RollbackAction $CommonIniPath $backupPath $snapshotBytes $snapshotHash $snapshotSddl
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

function Invoke-ProductionAllowlistProbe {
  [CmdletBinding()]
  param()
  $probeOutput = @(
    & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $probeDriver 2>&1 |
      ForEach-Object { [string]$_ }
  )
  if ($LASTEXITCODE -ne 0) {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_PROBE_FAILED'
  }
  $passes = @($probeOutput | Where-Object {
      $_ -match '^PRODUCTION_WEBREQUEST_PROBE=PASS proof=.+$'
    })
  if ($passes.Count -ne 1) {
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

function New-ContractFixtureBytes {
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
    'Secret=SuperSecretSentinel-v27' + $outside + $crlf
  )
  return ,(New-ProductionUtf16LeBomBytes -Text $text)
}

function Invoke-ProductionAllowlistContractTests {
  [CmdletBinding()]
  param()
  $contractRoot = Join-Path ([IO.Path]::GetTempPath()) (
    'marketlens-v27-' + [guid]::NewGuid().ToString('N')
  )
  $null = [IO.Directory]::CreateDirectory($contractRoot)
  $commonPath = Join-Path $contractRoot 'common.ini'
  try {
    $priorBytes = New-ContractFixtureBytes -WebValue '0' -UrlValue ''
    $conversion = Convert-ProductionWebRequestCommonIni -Bytes $priorBytes -ExpectedOrigin $expectedOrigin
    Assert-ProductionAllowlistTrue (
      [string]$conversion.Status -ceq 'APPLIED'
    ) 'PROVISIONING_WEBREQUEST_ALLOWLIST_CONTRACT_FAILED'
    Assert-ProductionAllowlistTrue (
      Read-ProductionWebRequestCommonIniFromBytesForContract -Bytes ([byte[]]$conversion.Bytes)
    ) 'PROVISIONING_WEBREQUEST_ALLOWLIST_CONTRACT_FAILED'

    Assert-ContractFailure -ExpectedCode 'PROVISIONING_WEBREQUEST_ALLOWLIST_SCHEMA_INVALID' -Action {
      $duplicate = New-ContractFixtureBytes -WebValue '0' -UrlValue '' -DuplicateWeb
      Convert-ProductionWebRequestCommonIni -Bytes $duplicate -ExpectedOrigin $expectedOrigin
    }
    Assert-ContractFailure -ExpectedCode 'PROVISIONING_WEBREQUEST_ALLOWLIST_SCHEMA_INVALID' -Action {
      $moved = New-ContractFixtureBytes -WebValue '0' -UrlValue '' -MoveUrlOutsideExperts
      Convert-ProductionWebRequestCommonIni -Bytes $moved -ExpectedOrigin $expectedOrigin
    }
    Assert-ContractFailure -ExpectedCode 'PROVISIONING_WEBREQUEST_ALLOWLIST_SCHEMA_INVALID' -Action {
      $utf8 = [Text.Encoding]::UTF8.GetBytes('[Experts]')
      Convert-ProductionWebRequestCommonIni -Bytes $utf8 -ExpectedOrigin $expectedOrigin
    }
    Assert-ContractFailure -ExpectedCode 'PROVISIONING_WEBREQUEST_ALLOWLIST_PRIOR_STATE_INVALID' -Action {
      $wrong = New-ContractFixtureBytes -WebValue '1' -UrlValue 'http://127.0.0.1:9999'
      Convert-ProductionWebRequestCommonIni -Bytes $wrong -ExpectedOrigin $expectedOrigin
    }
    Assert-ContractFailure -ExpectedCode 'PROVISIONING_WEBREQUEST_ALLOWLIST_SCHEMA_INVALID' -Action {
      $oversized = New-Object byte[] ($maximumCommonIniBytes + 1)
      Convert-ProductionWebRequestCommonIni -Bytes $oversized -ExpectedOrigin $expectedOrigin
    }

    [IO.File]::WriteAllBytes($commonPath, $priorBytes)
    $rollbackAction = {
      param($target, $backup, $bytes, $hash, $sddl)
      Restore-ProductionWebRequestCommonIniSnapshot -CommonIniPath $target -BackupPath $backup -SnapshotBytes $bytes -SnapshotHash $hash -SnapshotSddl $sddl
      return $true
    }
    $applied = Invoke-ProductionWebRequestCommonIniTransaction -CommonIniPath $commonPath -ExpectedOrigin $expectedOrigin -PreconditionAction {} -ProbeAction { return $true } -QuiesceAction {} -RollbackAction $rollbackAction
    Assert-ProductionAllowlistTrue (
      [string]$applied.status -ceq 'APPLIED' -and
      -not (Test-Path -LiteralPath ($commonPath + '.marketlens-v27.bak'))
    ) 'PROVISIONING_WEBREQUEST_ALLOWLIST_CONTRACT_FAILED'
    $firstHash = (Read-ProductionWebRequestCommonIni -Path $commonPath -ExpectedOrigin $expectedOrigin).Hash
    $unchanged = Invoke-ProductionWebRequestCommonIniTransaction -CommonIniPath $commonPath -ExpectedOrigin $expectedOrigin -PreconditionAction {} -ProbeAction { return $true } -QuiesceAction {} -RollbackAction $rollbackAction
    $secondHash = (Read-ProductionWebRequestCommonIni -Path $commonPath -ExpectedOrigin $expectedOrigin).Hash
    Assert-ProductionAllowlistTrue (
      [string]$unchanged.status -ceq 'UNCHANGED' -and $firstHash -ceq $secondHash
    ) 'PROVISIONING_WEBREQUEST_ALLOWLIST_CONTRACT_FAILED'
    Write-Output 'PRODUCTION_WEBREQUEST_ALLOWLIST_CONFIG_CONTRACTS=PASS'

    [IO.File]::WriteAllBytes($commonPath, $priorBytes)
    Assert-ContractFailure -ExpectedCode 'PROVISIONING_WEBREQUEST_ALLOWLIST_PROBE_FAILED' -Action {
      Invoke-ProductionWebRequestCommonIniTransaction -CommonIniPath $commonPath -ExpectedOrigin $expectedOrigin -PreconditionAction {} -ProbeAction {
        throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_PROBE_FAILED'
      } -QuiesceAction {} -RollbackAction $rollbackAction
    }
    $restored = [IO.File]::ReadAllBytes($commonPath)
    Assert-ProductionAllowlistTrue (
      Test-ProductionByteArrayEqual -Left $priorBytes -Right $restored
    ) 'PROVISIONING_WEBREQUEST_ALLOWLIST_CONTRACT_FAILED'
    Assert-ProductionAllowlistTrue (
      -not (Test-Path -LiteralPath ($commonPath + '.marketlens-v27.bak'))
    ) 'PROVISIONING_WEBREQUEST_ALLOWLIST_CONTRACT_FAILED'

    [IO.File]::WriteAllBytes($commonPath, $priorBytes)
    Assert-ContractFailure -ExpectedCode 'PROVISIONING_WEBREQUEST_ALLOWLIST_ROLLBACK_FAILED' -Action {
      Invoke-ProductionWebRequestCommonIniTransaction -CommonIniPath $commonPath -ExpectedOrigin $expectedOrigin -PreconditionAction {} -ProbeAction {
        throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_PROBE_FAILED'
      } -QuiesceAction {} -RollbackAction { return $false }
    }
    Write-Output 'PRODUCTION_WEBREQUEST_ALLOWLIST_ROLLBACK_CONTRACTS=PASS'

    $backupPath = $commonPath + '.marketlens-v27.bak'
    if (Test-Path -LiteralPath $backupPath -PathType Leaf) {
      Remove-Item -LiteralPath $backupPath -Force
    }
    [IO.File]::WriteAllBytes($commonPath, $priorBytes)
    $priorAcl = Get-Acl -LiteralPath $commonPath
    $desiredBytes = [byte[]](Convert-ProductionWebRequestCommonIni -Bytes $priorBytes -ExpectedOrigin $expectedOrigin).Bytes
    [IO.File]::WriteAllBytes($backupPath, $priorBytes)
    Set-Acl -LiteralPath $backupPath -AclObject $priorAcl
    [IO.File]::WriteAllBytes($commonPath, $desiredBytes)
    Set-Acl -LiteralPath $commonPath -AclObject $priorAcl
    $recovered = Invoke-ProductionWebRequestCommonIniTransaction -CommonIniPath $commonPath -ExpectedOrigin $expectedOrigin -PreconditionAction {} -ProbeAction { return $true } -QuiesceAction {} -RollbackAction $rollbackAction
    Assert-ProductionAllowlistTrue (
      [string]$recovered.status -ceq 'RECOVERED' -and
      -not (Test-Path -LiteralPath $backupPath)
    ) 'PROVISIONING_WEBREQUEST_ALLOWLIST_CONTRACT_FAILED'

    [IO.File]::WriteAllBytes($backupPath, $priorBytes)
    Set-Acl -LiteralPath $backupPath -AclObject $priorAcl
    [IO.File]::WriteAllBytes($commonPath, $priorBytes)
    Set-Acl -LiteralPath $commonPath -AclObject $priorAcl
    Assert-ContractFailure -ExpectedCode 'PROVISIONING_WEBREQUEST_ALLOWLIST_RECOVERY_STATE_INVALID' -Action {
      Invoke-ProductionWebRequestCommonIniTransaction -CommonIniPath $commonPath -ExpectedOrigin $expectedOrigin -PreconditionAction {} -ProbeAction { return $true } -QuiesceAction {} -RollbackAction $rollbackAction
    }
    Write-Output 'PRODUCTION_WEBREQUEST_ALLOWLIST_RECOVERY_CONTRACTS=PASS'
    Write-Output 'PRODUCTION_WEBREQUEST_ALLOWLIST_CONTRACTS=PASS'
  } finally {
    if (Test-Path -LiteralPath $contractRoot -PathType Container) {
      Remove-Item -LiteralPath $contractRoot -Recurse -Force
    }
  }
}

if ($ContractTestsOnly) {
  if ($KnownBadControl) {
    $duplicate = New-ContractFixtureBytes -WebValue '0' -UrlValue '' -DuplicateWeb
    Convert-ProductionWebRequestCommonIni -Bytes $duplicate -ExpectedOrigin $expectedOrigin
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_KNOWN_BAD_FAILED_OPEN'
  }
  if ($UnreadableInputControl) {
    $controlRoot = Join-Path ([IO.Path]::GetTempPath()) (
      'marketlens-v27-unreadable-' + [guid]::NewGuid().ToString('N')
    )
    $null = [IO.Directory]::CreateDirectory($controlRoot)
    $controlPath = Join-Path $controlRoot 'common.ini'
    [IO.File]::WriteAllBytes($controlPath, (New-ContractFixtureBytes -WebValue '0' -UrlValue ''))
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
        Read-ProductionWebRequestCommonIni -Path $controlPath -ExpectedOrigin $expectedOrigin
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
  Invoke-ProductionAllowlistContractTests
  exit 0
}

Assert-ProductionSelectedTerminalAndProfile
Assert-ProductionSelectedTerminalAbsent
$commonIniPath = Join-Path $selectedProfileRoot $commonIniRelativePath
$productionRollback = {
  param($target, $backup, $bytes, $hash, $sddl)
  Restore-ProductionWebRequestCommonIniSnapshot -CommonIniPath $target -BackupPath $backup -SnapshotBytes $bytes -SnapshotHash $hash -SnapshotSddl $sddl
  return $true
}
$result = Invoke-ProductionWebRequestCommonIniTransaction -CommonIniPath $commonIniPath -ExpectedOrigin $expectedOrigin -PreconditionAction {
  Assert-ProductionSelectedTerminalAbsent
} -ProbeAction {
  return [bool](Invoke-ProductionAllowlistProbe)
} -QuiesceAction {
  Wait-ProductionSelectedTerminalAbsent
} -RollbackAction $productionRollback
Write-Output (
  'PRODUCTION_WEBREQUEST_ALLOWLIST=PASS status={0} enabled={1} non_empty_count={2} probe_verified={3}' -f
    [string]$result.status,
    [bool]$result.enabled,
    [int]$result.non_empty_count,
    [bool]$result.probe_verified
)
