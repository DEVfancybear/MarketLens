[CmdletBinding()]
param(
  [switch]$ContractTestsOnly,
  [switch]$KnownBadControl
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$terminalPath = 'C:\Program Files\MetaTrader 5\terminal64.exe'
$stateRoot = 'C:\Users\Duong\AppData\Roaming\MetaQuotes\Terminal\D0E8209F77C8CF37AD8BF550E51FF075'
$metaEditorPath = 'C:\Program Files\MetaTrader 5\metaeditor64.exe'
$gatewayPath = Join-Path $repoRoot 'backend\bin\execution-gateway.exe'
$gatewayHealthUrl = 'http://127.0.0.1/health'
$gatewayOrigin = 'http://127.0.0.1'
$expectedPublisher = 'CN=MetaQuotes Ltd., O=MetaQuotes Ltd., S=Lemesos, C=CY'
$probeSource = Join-Path $PSScriptRoot 'MarketLensWebRequestProbe.mq5'
$reportRoot = Join-Path $repoRoot '.artifacts\production-worker-host-provision'
$slotInputRoot = 'C:\ProgramData\MarketLens\slot-inputs\slot-01'
$commonFilesRoot = Join-Path $env:APPDATA 'MetaQuotes\Terminal\Common\Files'
$commonIniPath = Join-Path $stateRoot 'config\common.ini'
$maximumCommonIniBytes = 1048576
$probeConfigPath = Join-Path (Split-Path -Parent $commonIniPath) `
  '.marketlens-v39-probe.ini'

function Assert-ProbeTrue {
  param(
    [Parameter(Mandatory = $true)][bool]$Condition,
    [Parameter(Mandatory = $true)][string]$Code
  )
  if (-not $Condition) { throw $Code }
}

function Assert-ProbeCompileResult {
  param(
    [Parameter(Mandatory = $true)][int]$ExitCode,
    [Parameter(Mandatory = $true)][bool]$BinaryExists,
    [Parameter(Mandatory = $true)][AllowEmptyString()][string]$CompileText
  )
  $resultLines = @(
    $CompileText -split '\r?\n' | Where-Object { $_ -match '^\s*Result:' }
  )
  $isSuccessful = (
    $ExitCode -eq 1 -and
    $BinaryExists -and
    $resultLines.Count -eq 1 -and
    $resultLines[0] -match '^\s*Result:\s+0 errors,\s+0 warnings(?:,\s+.*)?\s*$'
  )
  Assert-ProbeTrue ([bool]$isSuccessful) 'PROVISIONING_PROBE_COMPILE_FAILED'
}

function Assert-ProbeCompileFixtureRejected {
  param(
    [Parameter(Mandatory = $true)][int]$ExitCode,
    [Parameter(Mandatory = $true)][bool]$BinaryExists,
    [Parameter(Mandatory = $true)][AllowEmptyString()][string]$CompileText
  )
  try {
    Assert-ProbeCompileResult -ExitCode $ExitCode -BinaryExists $BinaryExists `
      -CompileText $CompileText
  } catch {
    if ($_.Exception.Message -ceq 'PROVISIONING_PROBE_COMPILE_FAILED') { return }
    throw
  }
  throw 'PROVISIONING_PROBE_COMPILE_CONTROL_FAILED_OPEN'
}

function Convert-BytesToLowerHex {
  param([Parameter(Mandatory = $true)][byte[]]$Bytes)
  return ([BitConverter]::ToString($Bytes) -replace '-', '').ToLowerInvariant()
}

function Assert-ProbeNonceShape {
  param([Parameter(Mandatory = $true)][string]$Nonce)
  Assert-ProbeTrue ($Nonce -cmatch '^[0-9a-f]{32}$') 'PROVISIONING_PROBE_NONCE_INVALID'
}

function Assert-ProbeNonceFixtureRejected {
  param([Parameter(Mandatory = $true)][string]$Nonce)
  try {
    Assert-ProbeNonceShape -Nonce $Nonce
  } catch {
    if ($_.Exception.Message -ceq 'PROVISIONING_PROBE_NONCE_INVALID') { return }
    throw
  }
  throw 'PROVISIONING_PROBE_NONCE_CONTROL_FAILED_OPEN'
}

function New-CryptographicProbeNonce {
  $nonceBytes = New-Object byte[] 16
  $random = [Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $random.GetBytes($nonceBytes)
  } finally {
    $random.Dispose()
  }
  $nonce = Convert-BytesToLowerHex -Bytes $nonceBytes
  Assert-ProbeNonceShape -Nonce $nonce
  return $nonce
}

function Get-Sha256Hex {
  param([Parameter(Mandatory = $true)][byte[]]$Bytes)
  $sha256 = [Security.Cryptography.SHA256]::Create()
  try {
    $digest = $sha256.ComputeHash($Bytes)
  } finally {
    $sha256.Dispose()
  }
  return Convert-BytesToLowerHex -Bytes $digest
}

function Test-ProbeByteArrayEqual {
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

function New-ProbeUtf16LeBomBytes {
  param([Parameter(Mandatory = $true)][AllowEmptyString()][string]$Text)
  $encoding = New-Object Text.UnicodeEncoding($false, $true, $true)
  $body = $encoding.GetBytes($Text)
  $result = New-Object byte[] ($body.Length + 2)
  $result[0] = 0xFF
  $result[1] = 0xFE
  [Array]::Copy($body, 0, $result, 2, $body.Length)
  return ,$result
}

function Convert-ProbeDefaultConfigStartup {
  param([Parameter(Mandatory = $true)][byte[]]$Bytes)
  if ($Bytes.Length -lt 2 -or $Bytes.Length -gt $maximumCommonIniBytes -or
      $Bytes[0] -ne 0xFF -or $Bytes[1] -ne 0xFE -or
      (($Bytes.Length - 2) % 2) -ne 0) {
    throw 'PROVISIONING_PROBE_DEFAULT_CONFIG_INVALID'
  }
  $encoding = New-Object Text.UnicodeEncoding($false, $true, $true)
  try {
    $text = $encoding.GetString($Bytes, 2, $Bytes.Length - 2)
  } catch {
    throw 'PROVISIONING_PROBE_DEFAULT_CONFIG_INVALID'
  }
  if (-not (Test-ProbeByteArrayEqual `
      -Left $Bytes -Right (New-ProbeUtf16LeBomBytes -Text $text))) {
    throw 'PROVISIONING_PROBE_DEFAULT_CONFIG_INVALID'
  }
  if ([regex]::Matches(
      $text,
      '^\[StartUp\](?:\r)?$',
      [Text.RegularExpressions.RegexOptions]::Multiline
    ).Count -ne 0) {
    throw 'PROVISIONING_PROBE_STARTUP_STATE_INVALID'
  }
  if ([regex]::Matches(
      $text,
      '^WebRequest=1(?:\r)?$',
      [Text.RegularExpressions.RegexOptions]::Multiline
    ).Count -ne 1 -or
      [regex]::Matches(
        $text,
        '^WebRequestUrl=http://127\.0\.0\.1(?:\r)?$',
        [Text.RegularExpressions.RegexOptions]::Multiline
      ).Count -ne 1) {
    throw 'PROVISIONING_PROBE_DEFAULT_CONFIG_INVALID'
  }
  $separator = if ($text.EndsWith("`n", [StringComparison]::Ordinal)) {
    ''
  } else {
    "`r`n"
  }
  $startupText = (
    $separator + '[StartUp]' + "`r`n" +
    'Script=MarketLensWebRequestProbe' + "`r`n" +
    'Symbol=EURUSD' + "`r`n" +
    'Period=M1' + "`r`n" +
    'ShutdownTerminal=1' + "`r`n"
  )
  $desiredBytes = New-ProbeUtf16LeBomBytes -Text ($text + $startupText)
  if ($desiredBytes.Length -le $Bytes.Length) {
    throw 'PROVISIONING_PROBE_STARTUP_TRANSFORM_INVALID'
  }
  $reversedBytes = New-Object byte[] $Bytes.Length
  [Array]::Copy($desiredBytes, 0, $reversedBytes, 0, $Bytes.Length)
  if (-not (Test-ProbeByteArrayEqual -Left $Bytes -Right $reversedBytes)) {
    throw 'PROVISIONING_PROBE_STARTUP_TRANSFORM_INVALID'
  }
  return [pscustomobject][ordered]@{
    OriginalBytes = $Bytes
    OriginalHash = Get-Sha256Hex -Bytes $Bytes
    DesiredBytes = $desiredBytes
    DesiredHash = Get-Sha256Hex -Bytes $desiredBytes
  }
}

function Get-ProbeAclSddl {
  param([Parameter(Mandatory = $true)][string]$Path)
  try {
    return [string](Get-Acl -LiteralPath $Path -ErrorAction Stop).Sddl
  } catch {
    throw 'PROVISIONING_PROBE_DEFAULT_CONFIG_ACL_INVALID'
  }
}

function Write-ProbeCreateNewFile {
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

function New-ProbeCustomConfigSnapshot {
  param(
    [Parameter(Mandatory = $true)][string]$DefaultPath,
    [Parameter(Mandatory = $true)][string]$CustomPath
  )
  if (Test-Path -LiteralPath $CustomPath) {
    throw 'PROVISIONING_PROBE_CUSTOM_CONFIG_RECOVERY_STATE_INVALID'
  }
  $defaultBytes = [IO.File]::ReadAllBytes($DefaultPath)
  $conversion = Convert-ProbeDefaultConfigStartup -Bytes $defaultBytes
  $defaultAcl = Get-Acl -LiteralPath $DefaultPath -ErrorAction Stop
  return [pscustomobject][ordered]@{
    DefaultPath = $DefaultPath
    DefaultBytes = $defaultBytes
    DefaultHash = [string]$conversion.OriginalHash
    DefaultSddl = [string]$defaultAcl.Sddl
    CustomPath = $CustomPath
    CustomBytes = [byte[]]$conversion.DesiredBytes
    CustomHash = [string]$conversion.DesiredHash
    CustomAcl = $defaultAcl
    CustomSddl = [string]$defaultAcl.Sddl
  }
}

function Assert-ProbeDefaultConfigUnchanged {
  param([Parameter(Mandatory = $true)][object]$Snapshot)
  if ((Get-Sha256Hex -Bytes ([IO.File]::ReadAllBytes($Snapshot.DefaultPath))) -cne
        [string]$Snapshot.DefaultHash -or
      (Get-ProbeAclSddl -Path $Snapshot.DefaultPath) -cne
        [string]$Snapshot.DefaultSddl) {
    throw 'PROVISIONING_PROBE_DEFAULT_CONFIG_DRIFTED'
  }
}

function Assert-ProbeOwnedCustomConfig {
  param([Parameter(Mandatory = $true)][object]$Snapshot)
  if (-not (Test-Path -LiteralPath ([string]$Snapshot.CustomPath) -PathType Leaf) -or
      (Get-Sha256Hex -Bytes ([IO.File]::ReadAllBytes($Snapshot.CustomPath))) -cne
        [string]$Snapshot.CustomHash -or
      (Get-ProbeAclSddl -Path $Snapshot.CustomPath) -cne
        [string]$Snapshot.CustomSddl) {
    throw 'PROVISIONING_PROBE_CUSTOM_CONFIG_OWNERSHIP_INVALID'
  }
}

function Remove-ProbeOwnedCustomConfig {
  param([Parameter(Mandatory = $true)][object]$Snapshot)
  Assert-ProbeDefaultConfigUnchanged -Snapshot $Snapshot
  if (-not (Test-Path -LiteralPath ([string]$Snapshot.CustomPath))) { return }
  Assert-ProbeOwnedCustomConfig -Snapshot $Snapshot
  Remove-Item -LiteralPath $Snapshot.CustomPath -Force
  if (Test-Path -LiteralPath $Snapshot.CustomPath) {
    throw 'PROVISIONING_PROBE_CUSTOM_CONFIG_CLEANUP_FAILED'
  }
}

function Invoke-ProbeCustomConfigTransaction {
  param(
    [Parameter(Mandatory = $true)][string]$DefaultPath,
    [Parameter(Mandatory = $true)][string]$CustomPath,
    [Parameter(Mandatory = $true)][scriptblock]$RunAction,
    [Parameter(Mandatory = $true)][scriptblock]$QuiesceAction
  )
  $snapshot = New-ProbeCustomConfigSnapshot `
    -DefaultPath $DefaultPath -CustomPath $CustomPath
  try {
    Write-ProbeCreateNewFile `
      -Path $CustomPath -Bytes ([byte[]]$snapshot.CustomBytes) -Acl $snapshot.CustomAcl
    Assert-ProbeOwnedCustomConfig -Snapshot $snapshot
    Assert-ProbeDefaultConfigUnchanged -Snapshot $snapshot
    $result = & $RunAction $snapshot
    & $QuiesceAction
    Remove-ProbeOwnedCustomConfig -Snapshot $snapshot
    return $result
  } catch {
    $originalFailure = [string]$_.Exception.Message
    try {
      & $QuiesceAction
      Remove-ProbeOwnedCustomConfig -Snapshot $snapshot
    } catch {
      throw 'PROVISIONING_PROBE_CUSTOM_CONFIG_CLEANUP_FAILED'
    }
    throw $originalFailure
  }
}

function Assert-ProbeContractFailure {
  param(
    [Parameter(Mandatory = $true)][string]$ExpectedCode,
    [Parameter(Mandatory = $true)][scriptblock]$Action
  )
  try {
    & $Action
  } catch {
    if ([string]$_.Exception.Message -ceq $ExpectedCode) { return }
    throw
  }
  throw 'PROVISIONING_PROBE_CONTRACT_FAILED_OPEN'
}

function Invoke-ProbeCustomConfigStartupContractTests {
  $contractRoot = Join-Path ([IO.Path]::GetTempPath()) (
    'marketlens-v39-probe-' + [guid]::NewGuid().ToString('N')
  )
  $null = [IO.Directory]::CreateDirectory($contractRoot)
  $path = Join-Path $contractRoot 'common.ini'
  $customPath = Join-Path $contractRoot '.marketlens-v39-probe.ini'
  try {
    $baseText = (
      '[General]' + "`r`n" + 'Untouched=prefix' + "`r`n" +
      '[Experts]' + "`r`n" + 'WebRequest=1' + "`r`n" +
      'WebRequestUrl=http://127.0.0.1' + "`r`n" +
      '[Other]' + "`r`n" + 'Untouched=tail' + "`r`n"
    )
    $baseBytes = New-ProbeUtf16LeBomBytes -Text $baseText
    $conversion = Convert-ProbeDefaultConfigStartup -Bytes $baseBytes
    $desiredText = (New-Object Text.UnicodeEncoding($false, $true, $true)).GetString(
      [byte[]]$conversion.DesiredBytes,
      2,
      ([byte[]]$conversion.DesiredBytes).Length - 2
    )
    Assert-ProbeTrue (
      $desiredText.EndsWith(
        "[StartUp]`r`nScript=MarketLensWebRequestProbe`r`nSymbol=EURUSD`r`nPeriod=M1`r`nShutdownTerminal=1`r`n",
        [StringComparison]::Ordinal
      ) -and
      [string]$conversion.OriginalHash -ceq (Get-Sha256Hex -Bytes $baseBytes)
    ) 'PROVISIONING_PROBE_DEFAULT_CONFIG_CONTRACT_FAILED'

    Assert-ProbeContractFailure `
      -ExpectedCode 'PROVISIONING_PROBE_STARTUP_STATE_INVALID' -Action {
        Convert-ProbeDefaultConfigStartup `
          -Bytes ([byte[]]$conversion.DesiredBytes)
      }
    Assert-ProbeContractFailure `
      -ExpectedCode 'PROVISIONING_PROBE_DEFAULT_CONFIG_INVALID' -Action {
        Convert-ProbeDefaultConfigStartup `
          -Bytes ([Text.Encoding]::UTF8.GetBytes($baseText))
      }

    $events = [Collections.Generic.List[string]]::new()
    [IO.File]::WriteAllBytes($path, $baseBytes)
    $result = Invoke-ProbeCustomConfigTransaction `
      -DefaultPath $path -CustomPath $customPath `
      -RunAction { param($snapshot)
        $events.Add('run')
        Assert-ProbeTrue (
          (Test-ProbeByteArrayEqual -Left $baseBytes `
            -Right ([IO.File]::ReadAllBytes($path))) -and
          (Test-ProbeByteArrayEqual -Left ([byte[]]$snapshot.CustomBytes) `
            -Right ([IO.File]::ReadAllBytes($customPath)))
        ) 'PROVISIONING_PROBE_DEFAULT_CONFIG_CONTRACT_FAILED'
        return 'PASS'
      } `
      -QuiesceAction { $events.Add('quiesce') }
    Assert-ProbeTrue (
      [string]$result -ceq 'PASS' -and
      ($events -join ',') -ceq 'run,quiesce' -and
      (Test-ProbeByteArrayEqual `
        -Left $baseBytes -Right ([IO.File]::ReadAllBytes($path))) -and
      -not (Test-Path -LiteralPath $customPath)
    ) 'PROVISIONING_PROBE_DEFAULT_CONFIG_CONTRACT_FAILED'

    [IO.File]::WriteAllBytes($path, $baseBytes)
    $failureEvents = [Collections.Generic.List[string]]::new()
    Assert-ProbeContractFailure `
      -ExpectedCode 'PROVISIONING_PROBE_CONTRACT_FAILURE' -Action {
        Invoke-ProbeCustomConfigTransaction `
          -DefaultPath $path -CustomPath $customPath `
          -RunAction {
            $failureEvents.Add('run')
            throw 'PROVISIONING_PROBE_CONTRACT_FAILURE'
          } `
          -QuiesceAction { $failureEvents.Add('quiesce') }
      }
    Assert-ProbeTrue (
      ($failureEvents -join ',') -ceq 'run,quiesce' -and
      (Test-ProbeByteArrayEqual `
        -Left $baseBytes -Right ([IO.File]::ReadAllBytes($path))) -and
      -not (Test-Path -LiteralPath $customPath)
    ) 'PROVISIONING_PROBE_DEFAULT_CONFIG_CONTRACT_FAILED'

    [IO.File]::WriteAllBytes($customPath, $baseBytes)
    Assert-ProbeContractFailure `
      -ExpectedCode 'PROVISIONING_PROBE_CUSTOM_CONFIG_RECOVERY_STATE_INVALID' -Action {
        Invoke-ProbeCustomConfigTransaction `
          -DefaultPath $path -CustomPath $customPath `
          -RunAction { return $true } -QuiesceAction {}
      }
    Remove-Item -LiteralPath $customPath -Force

    $mismatchSnapshot = New-ProbeCustomConfigSnapshot `
      -DefaultPath $path -CustomPath $customPath
    Write-ProbeCreateNewFile `
      -Path $customPath -Bytes ([byte[]]$mismatchSnapshot.CustomBytes) `
      -Acl $mismatchSnapshot.CustomAcl
    [IO.File]::WriteAllBytes($customPath, $baseBytes)
    Assert-ProbeContractFailure `
      -ExpectedCode 'PROVISIONING_PROBE_CUSTOM_CONFIG_OWNERSHIP_INVALID' -Action {
        Remove-ProbeOwnedCustomConfig -Snapshot $mismatchSnapshot
      }
    Assert-ProbeTrue (Test-Path -LiteralPath $customPath -PathType Leaf) `
      'PROVISIONING_PROBE_CUSTOM_CONFIG_CONTRACT_FAILED'
    Remove-Item -LiteralPath $customPath -Force
    Write-Output 'PRODUCTION_CUSTOM_CONFIG_STARTUP_CONTRACTS=PASS'
  } finally {
    if (Test-Path -LiteralPath $contractRoot -PathType Container) {
      Remove-Item -LiteralPath $contractRoot -Recurse -Force
    }
  }
}

function Assert-ProbeReceipt {
  param(
    [Parameter(Mandatory = $true)][psobject]$Receipt,
    [Parameter(Mandatory = $true)][string]$ExpectedNonce,
    [Parameter(Mandatory = $true)][long]$ExpectedRequestedAtUnix,
    [Parameter(Mandatory = $true)][long]$MaximumObservedAtUnix
  )
  $required = @(
    'schemaVersion', 'nonce', 'url', 'httpStatus', 'mt5Error', 'terminalBuild',
    'requestedAtUnix', 'observedAtUnix', 'responseOk', 'responseService',
    'responseProtocol', 'probeSucceeded'
  )
  $observed = @($Receipt.PSObject.Properties.Name)
  $shapeIsExact = $observed.Count -eq $required.Count -and
    @($required | Where-Object { $observed -cnotcontains $_ }).Count -eq 0
  Assert-ProbeTrue $shapeIsExact 'PROVISIONING_PROBE_RECEIPT_INVALID'
  Assert-ProbeTrue ([int]$Receipt.schemaVersion -eq 1) 'PROVISIONING_PROBE_RECEIPT_INVALID'
  Assert-ProbeTrue ([string]$Receipt.nonce -ceq $ExpectedNonce) 'PROVISIONING_PROBE_RECEIPT_INVALID'
  Assert-ProbeTrue ([string]$Receipt.url -ceq $gatewayHealthUrl) 'PROVISIONING_PROBE_RECEIPT_INVALID'
  Assert-ProbeTrue ([int]$Receipt.httpStatus -eq 200) 'PROVISIONING_PROBE_RECEIPT_INVALID'
  Assert-ProbeTrue ([int]$Receipt.mt5Error -eq 0) 'PROVISIONING_PROBE_RECEIPT_INVALID'
  Assert-ProbeTrue ([int]$Receipt.terminalBuild -gt 0) 'PROVISIONING_PROBE_RECEIPT_INVALID'
  Assert-ProbeTrue ([long]$Receipt.requestedAtUnix -eq $ExpectedRequestedAtUnix) `
    'PROVISIONING_PROBE_RECEIPT_INVALID'
  Assert-ProbeTrue (
    [long]$Receipt.observedAtUnix -ge $ExpectedRequestedAtUnix -and
    [long]$Receipt.observedAtUnix -le $MaximumObservedAtUnix
  ) 'PROVISIONING_PROBE_RECEIPT_INVALID'
  foreach ($property in @('responseOk', 'responseService', 'responseProtocol', 'probeSucceeded')) {
    Assert-ProbeTrue ($Receipt.$property -is [bool] -and [bool]$Receipt.$property) `
      'PROVISIONING_PROBE_RECEIPT_INVALID'
  }
}

function Invoke-ProbeContractTests {
  $driverText = Get-Content -LiteralPath $PSCommandPath -Raw
  $exactLaunch = (
    '$terminalState.Value = Start-' + 'Process -FilePath $terminalPath `' + "`n" +
    '      -ArgumentList $probeConfigArgument `' + "`n" +
    '      -WindowStyle Hidden -PassThru'
  )
  Assert-ProbeTrue (
    [regex]::Matches($driverText, [regex]::Escape($exactLaunch)).Count -eq 1 -and
    $driverText.Contains("`$probeConfigArgument = '/config:' + `$probeConfigPath") -and
    -not $driverText.Contains(('/pro' + 'file:')) -and
    -not $driverText.Contains(('/port' + 'able'))
  ) 'PROVISIONING_PROBE_CUSTOM_CONFIG_LAUNCH_INVALID'
  $requestedAt = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  $nonce = '0123456789abcdef0123456789abcdef'
  $valid = [pscustomobject][ordered]@{
    schemaVersion = 1
    nonce = $nonce
    url = $gatewayHealthUrl
    httpStatus = 200
    mt5Error = 0
    terminalBuild = 1
    requestedAtUnix = $requestedAt
    observedAtUnix = $requestedAt
    responseOk = $true
    responseService = $true
    responseProtocol = $true
    probeSucceeded = $true
  }
  if ($KnownBadControl) {
    Assert-ProbeReceipt -Receipt $valid -ExpectedNonce ('f' * 32) `
      -ExpectedRequestedAtUnix $requestedAt -MaximumObservedAtUnix ($requestedAt + 1)
    throw 'PROVISIONING_KNOWN_BAD_CONTROL_FAILED_OPEN'
  }
  Assert-ProbeReceipt -Receipt $valid -ExpectedNonce $nonce `
    -ExpectedRequestedAtUnix $requestedAt -MaximumObservedAtUnix ($requestedAt + 1)
  Invoke-ProbeCustomConfigStartupContractTests
  $cleanCompileLog = "Result: 0 errors, 0 warnings, 1 ms elapsed, cpu='X64 Regular'"
  Assert-ProbeCompileResult -ExitCode 1 -BinaryExists $true -CompileText $cleanCompileLog
  Assert-ProbeCompileFixtureRejected -ExitCode 0 -BinaryExists $true `
    -CompileText $cleanCompileLog
  Assert-ProbeCompileFixtureRejected -ExitCode 1 -BinaryExists $false `
    -CompileText $cleanCompileLog
  Assert-ProbeCompileFixtureRejected -ExitCode 1 -BinaryExists $true `
    -CompileText 'Result: 1 errors, 0 warnings'
  Assert-ProbeCompileFixtureRejected -ExitCode 1 -BinaryExists $true `
    -CompileText "$cleanCompileLog`r`n$cleanCompileLog"
  $generatedNonce = New-CryptographicProbeNonce
  Assert-ProbeNonceShape -Nonce $generatedNonce
  Assert-ProbeNonceFixtureRejected -Nonce 'abc'
  Assert-ProbeNonceFixtureRejected -Nonce ('A' * 32)
  Assert-ProbeNonceFixtureRejected -Nonce ('g' * 32)
  $abcDigest = Get-Sha256Hex -Bytes ([Text.Encoding]::UTF8.GetBytes('abc'))
  Assert-ProbeTrue (
    $abcDigest -ceq 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
  ) 'PROVISIONING_PROBE_SHA256_INVALID'
  Write-Output 'PRODUCTION_POWERSHELL51_CRYPTO_CONTRACTS=PASS'
  Write-Output 'PRODUCTION_METAEDITOR_COMPILE_CONTRACTS=PASS'
  Write-Output 'PRODUCTION_WEBREQUEST_PROBE_CONTRACTS=PASS'
}

if ($ContractTestsOnly) {
  Invoke-ProbeContractTests
  exit 0
}

function Assert-NoReparseComponent {
  param([Parameter(Mandatory = $true)][string]$Path)
  $cursor = Get-Item -LiteralPath ([IO.Path]::GetFullPath($Path)) -Force -ErrorAction Stop
  while ($null -ne $cursor) {
    if (($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw 'PROVISIONING_REPARSE_PATH_REJECTED'
    }
    $cursor = if ($cursor -is [IO.FileInfo]) { $cursor.Directory } else { $cursor.Parent }
  }
}

function Assert-SignedSelectedTerminal {
  foreach ($path in @($terminalPath, $metaEditorPath)) {
    Assert-ProbeTrue (Test-Path -LiteralPath $path -PathType Leaf) `
      'PROVISIONING_SELECTED_TERMINAL_MISSING'
    Assert-NoReparseComponent -Path $path
    $signature = Get-AuthenticodeSignature -FilePath $path
    Assert-ProbeTrue ($signature.Status -eq [Management.Automation.SignatureStatus]::Valid) `
      'PROVISIONING_TERMINAL_SIGNATURE_INVALID'
    Assert-ProbeTrue ($null -ne $signature.SignerCertificate) `
      'PROVISIONING_TERMINAL_SIGNATURE_INVALID'
    Assert-ProbeTrue (
      [string]::Equals(
        [string]$signature.SignerCertificate.Subject,
        $expectedPublisher,
        [StringComparison]::Ordinal
      )
    ) 'PROVISIONING_TERMINAL_SIGNER_MISMATCH'
  }
  Assert-ProbeTrue (Test-Path -LiteralPath $stateRoot -PathType Container) `
    'PROVISIONING_SELECTED_STATE_ROOT_MISSING'
  Assert-NoReparseComponent -Path $stateRoot
  $origin = (Get-Content -LiteralPath (Join-Path $stateRoot 'origin.txt') -Raw).Trim().TrimEnd('\')
  Assert-ProbeTrue (
    [string]::Equals(
      $origin,
      (Split-Path -Parent $terminalPath).TrimEnd('\'),
      [StringComparison]::OrdinalIgnoreCase
    )
  ) 'PROVISIONING_TERMINAL_STATE_ORIGIN_MISMATCH'
}

function Assert-ExactGatewayHealth {
  Assert-ProbeTrue (Test-Path -LiteralPath $gatewayPath -PathType Leaf) `
    'PROVISIONING_GATEWAY_BINARY_MISSING'
  Assert-NoReparseComponent -Path $gatewayPath
  $listeners = @(
    Get-NetTCPConnection -State Listen -LocalPort 8790 -ErrorAction Stop |
      Where-Object { $_.LocalAddress -ceq '127.0.0.1' }
  )
  Assert-ProbeTrue ($listeners.Count -eq 1) 'PROVISIONING_GATEWAY_LISTENER_MISMATCH'
  $owner = Get-Process -Id $listeners[0].OwningProcess -ErrorAction Stop
  Assert-ProbeTrue (
    [string]::Equals(
      [IO.Path]::GetFullPath($owner.Path),
      [IO.Path]::GetFullPath($gatewayPath),
      [StringComparison]::OrdinalIgnoreCase
    )
  ) 'PROVISIONING_GATEWAY_LISTENER_MISMATCH'

  $response = Invoke-WebRequest -UseBasicParsing -Uri $gatewayHealthUrl -TimeoutSec 5
  Assert-ProbeTrue ([int]$response.StatusCode -eq 200) 'PROVISIONING_GATEWAY_HEALTH_MISMATCH'
  try {
    $health = $response.Content | ConvertFrom-Json -ErrorAction Stop
  } catch {
    throw 'PROVISIONING_GATEWAY_HEALTH_MISMATCH'
  }
  $properties = @($health.PSObject.Properties.Name)
  $required = @('ok', 'service', 'protocolVersion', 'connectedAccounts')
  Assert-ProbeTrue (
    $properties.Count -eq $required.Count -and
    @($required | Where-Object { $properties -cnotcontains $_ }).Count -eq 0
  ) 'PROVISIONING_GATEWAY_HEALTH_MISMATCH'
  Assert-ProbeTrue (
    $health.ok -is [bool] -and [bool]$health.ok -and
    [string]$health.service -ceq 'execution-gateway' -and
    [int]$health.protocolVersion -eq 1 -and
    [int]$health.connectedAccounts -ge 0
  ) 'PROVISIONING_GATEWAY_HEALTH_MISMATCH'
  [pscustomobject][ordered]@{
    pid = $owner.Id
    binary_sha256 = (Get-FileHash -LiteralPath $gatewayPath -Algorithm SHA256).Hash.ToLowerInvariant()
  }
}

function Get-ExactSelectedTerminalProcesses {
  return @(
    Get-CimInstance Win32_Process -Filter "Name = 'terminal64.exe'" |
      Where-Object {
        $_.ExecutablePath -and [string]::Equals(
          [IO.Path]::GetFullPath($_.ExecutablePath),
          [IO.Path]::GetFullPath($terminalPath),
          [StringComparison]::OrdinalIgnoreCase
        )
      }
  )
}

function Assert-ExactSelectedTerminalAbsent {
  $matches = @(Get-ExactSelectedTerminalProcesses)
  Assert-ProbeTrue ($matches.Count -le 1) 'PROVISIONING_SELECTED_TERMINAL_PROCESS_AMBIGUOUS'
  Assert-ProbeTrue ($matches.Count -eq 0) 'PROVISIONING_SELECTED_TERMINAL_ALREADY_RUNNING'
}

function Wait-ProbeOwnedTerminalExit {
  param([Parameter(Mandatory = $true)][object]$State)
  if ($null -eq $State.Value) { return }
  $process = $State.Value
  $matches = @(Get-ExactSelectedTerminalProcesses)
  Assert-ProbeTrue (
    $matches.Count -le 1 -and
    ($matches.Count -eq 0 -or [int]$matches[0].ProcessId -eq [int]$process.Id)
  ) 'PROVISIONING_SELECTED_TERMINAL_PROCESS_AMBIGUOUS'
  if (-not $process.HasExited -and -not $process.WaitForExit(30000)) {
    $null = $process.CloseMainWindow()
    Assert-ProbeTrue ($process.WaitForExit(15000)) `
      'PROVISIONING_SELECTED_TERMINAL_STOP_FAILED'
  }
  Assert-ProbeTrue ($process.HasExited) 'PROVISIONING_SELECTED_TERMINAL_STOP_FAILED'
  $State.Value = $null
}

function Write-Utf8NoBomFile {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Contents
  )
  $parent = Split-Path -Parent $Path
  $null = [IO.Directory]::CreateDirectory($parent)
  $temporary = Join-Path $parent ('.marketlens-' + [guid]::NewGuid().ToString('N') + '.tmp')
  try {
    [IO.File]::WriteAllText($temporary, $Contents, (New-Object Text.UTF8Encoding($false)))
    Move-Item -LiteralPath $temporary -Destination $Path -Force
  } finally {
    if (Test-Path -LiteralPath $temporary) {
      Remove-Item -LiteralPath $temporary -Force
    }
  }
}

function Protect-ProbeOutputFile {
  param([Parameter(Mandatory = $true)][string]$Path)
  $currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $systemSid = New-Object Security.Principal.SecurityIdentifier('S-1-5-18')
  $administratorsSid = New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')
  $acl = New-Object Security.AccessControl.FileSecurity
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($sid in @($currentSid, $systemSid, $administratorsSid)) {
    $rule = New-Object Security.AccessControl.FileSystemAccessRule(
      $sid,
      [Security.AccessControl.FileSystemRights]::FullControl,
      [Security.AccessControl.AccessControlType]::Allow
    )
    $null = $acl.AddAccessRule($rule)
  }
  Set-Acl -LiteralPath $Path -AclObject $acl
}

function Write-ProvenTopologyInputs {
  $chartPath = Join-Path $slotInputRoot 'chart01.chr'
  $settingsPath = Join-Path $slotInputRoot 'experts.ini'
  $attestationPath = Join-Path $slotInputRoot 'webrequest-attestation.json'
  $chart = @"
<chart>
<expert>
path=Experts\MarketLensExecutionEA.ex5
<inputs>
GatewayUrl=$gatewayOrigin
PairingToken=
BootstrapPipe=marketlens-slot-01
</inputs>
</expert>
</chart>
"@
  $settings = "[Experts]`r`nAllowWebRequest=1`r`nWebRequestUrl=$gatewayOrigin`r`n"
  Write-Utf8NoBomFile -Path $chartPath -Contents $chart
  Write-Utf8NoBomFile -Path $settingsPath -Contents $settings
  $settingsHash = (Get-FileHash -LiteralPath $settingsPath -Algorithm SHA256).Hash.ToLowerInvariant()
  $attestation = [ordered]@{
    schemaVersion = 1
    settingsFileName = 'experts.ini'
    settingsSha256 = $settingsHash
    allowedOrigins = @($gatewayOrigin)
    probeSucceeded = $true
  }
  Write-Utf8NoBomFile -Path $attestationPath `
    -Contents ($attestation | ConvertTo-Json -Compress -Depth 3)
  foreach ($path in @($chartPath, $settingsPath, $attestationPath)) {
    Protect-ProbeOutputFile -Path $path
  }
  [pscustomobject][ordered]@{
    chart_path = $chartPath
    chart_sha256 = (Get-FileHash -LiteralPath $chartPath -Algorithm SHA256).Hash.ToLowerInvariant()
    settings_path = $settingsPath
    settings_sha256 = $settingsHash
    attestation_path = $attestationPath
    attestation_sha256 = (Get-FileHash -LiteralPath $attestationPath -Algorithm SHA256).Hash.ToLowerInvariant()
  }
}

Assert-SignedSelectedTerminal
$gateway = Assert-ExactGatewayHealth
Assert-ProbeTrue (Test-Path -LiteralPath $probeSource -PathType Leaf) 'PROVISIONING_PROBE_SOURCE_MISSING'
$sourceText = Get-Content -LiteralPath $probeSource -Raw
foreach ($forbidden in @('OrderSend(', 'OrderCheck(', 'CTrade', 'AccountInfo', 'PositionSelect', 'HistoryDeal')) {
  Assert-ProbeTrue ($sourceText.IndexOf($forbidden, [StringComparison]::OrdinalIgnoreCase) -lt 0) `
    'PROVISIONING_PROBE_SOURCE_CAN_TRADE'
}

$null = [IO.Directory]::CreateDirectory($reportRoot)
$scriptDirectory = Join-Path $stateRoot 'MQL5\Scripts'
$null = [IO.Directory]::CreateDirectory($scriptDirectory)
$installedSource = Join-Path $scriptDirectory 'MarketLensWebRequestProbe.mq5'
$installedBinary = Join-Path $scriptDirectory 'MarketLensWebRequestProbe.ex5'
$compileLog = Join-Path $reportRoot 'webrequest-probe-metaeditor.log'
Copy-Item -LiteralPath $probeSource -Destination $installedSource -Force
if (Test-Path -LiteralPath $installedBinary) {
  Remove-Item -LiteralPath $installedBinary -Force
}
$compile = Start-Process -FilePath $metaEditorPath `
  -ArgumentList "/compile:`"$installedSource`"", "/log:`"$compileLog`"" `
  -WindowStyle Hidden -Wait -PassThru
$compileText = Get-Content -LiteralPath $compileLog -Raw -ErrorAction SilentlyContinue
Assert-ProbeCompileResult -ExitCode $compile.ExitCode `
  -BinaryExists (Test-Path -LiteralPath $installedBinary -PathType Leaf) `
  -CompileText ([string]$compileText)

$nonce = New-CryptographicProbeNonce
$requestedAt = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$marketLensCommon = Join-Path $commonFilesRoot 'MarketLens'
$null = [IO.Directory]::CreateDirectory($marketLensCommon)
$requestPath = Join-Path $marketLensCommon 'webrequest-probe-request.txt'
$receiptPath = Join-Path $marketLensCommon ("webrequest-probe-$nonce.json")
$request = "schemaVersion=1`r`nnonce=$nonce`r`nurl=$gatewayHealthUrl`r`nrequestedAtUnix=$requestedAt`r`n"
Write-Utf8NoBomFile -Path $requestPath -Contents $request
if (Test-Path -LiteralPath $receiptPath) {
  Remove-Item -LiteralPath $receiptPath -Force
}

Assert-ProbeTrue (Test-Path -LiteralPath $commonIniPath -PathType Leaf) `
  'PROVISIONING_PROBE_DEFAULT_CONFIG_INVALID'
Assert-NoReparseComponent -Path $commonIniPath
Assert-ExactSelectedTerminalAbsent
$terminalState = [pscustomobject]@{ Value = $null }
$probeConfigArgument = '/config:' + $probeConfigPath
$receipt = Invoke-ProbeCustomConfigTransaction `
  -DefaultPath $commonIniPath -CustomPath $probeConfigPath `
  -RunAction { param($snapshot)
    $terminalState.Value = Start-Process -FilePath $terminalPath `
      -ArgumentList $probeConfigArgument `
      -WindowStyle Hidden -PassThru
    $deadline = [DateTime]::UtcNow.AddSeconds(60)
    while (-not (Test-Path -LiteralPath $receiptPath -PathType Leaf) -and
           [DateTime]::UtcNow -lt $deadline) {
      Start-Sleep -Milliseconds 250
    }
    if (-not (Test-Path -LiteralPath $receiptPath -PathType Leaf)) {
      throw 'PROVISIONING_PROBE_RECEIPT_TIMEOUT'
    }
    try {
      $observedReceipt = Get-Content -LiteralPath $receiptPath -Raw |
        ConvertFrom-Json -ErrorAction Stop
    } catch {
      throw 'PROVISIONING_PROBE_RECEIPT_INVALID'
    }
    if ([int]$observedReceipt.httpStatus -eq -1 -and
        [int]$observedReceipt.mt5Error -eq 4014) {
      throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_REQUIRED'
    }
    $maximumObservedAt = [DateTimeOffset]::UtcNow.AddSeconds(5).ToUnixTimeSeconds()
    Assert-ProbeReceipt -Receipt $observedReceipt -ExpectedNonce $nonce `
      -ExpectedRequestedAtUnix $requestedAt -MaximumObservedAtUnix $maximumObservedAt
    return $observedReceipt
  } `
  -QuiesceAction { Wait-ProbeOwnedTerminalExit -State $terminalState }
$inputs = Write-ProvenTopologyInputs

$proof = [ordered]@{
  schema_version = 1
  status = 'PASS'
  probe_url = $gatewayHealthUrl
  terminal_path = $terminalPath
  terminal_sha256 = (Get-FileHash -LiteralPath $terminalPath -Algorithm SHA256).Hash.ToLowerInvariant()
  terminal_build = [int]$receipt.terminalBuild
  gateway_path = $gatewayPath
  gateway_sha256 = $gateway.binary_sha256
  requested_at_unix = $requestedAt
  observed_at_unix = [long]$receipt.observedAtUnix
  nonce_sha256 = Get-Sha256Hex -Bytes ([Text.Encoding]::UTF8.GetBytes($nonce))
  receipt_sha256 = (Get-FileHash -LiteralPath $receiptPath -Algorithm SHA256).Hash.ToLowerInvariant()
  chart_sha256 = $inputs.chart_sha256
  settings_sha256 = $inputs.settings_sha256
  attestation_sha256 = $inputs.attestation_sha256
}
$proofPath = Join-Path $reportRoot 'webrequest-proof.json'
Write-Utf8NoBomFile -Path $proofPath -Contents ($proof | ConvertTo-Json -Compress -Depth 4)
Write-Output "PRODUCTION_WEBREQUEST_PROBE=PASS proof=$proofPath"
