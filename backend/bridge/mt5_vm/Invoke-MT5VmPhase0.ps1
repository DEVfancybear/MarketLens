[CmdletBinding()]
param(
  [ValidateSet('Host', 'Account')]
  [string]$Mode = 'Host',

  [string]$TerminalPath = 'C:\Program Files\MetaTrader 5\terminal64.exe',
  [string]$PythonPath,

  [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$')]
  [string]$AccountAlias = 'phase0-demo',

  [string]$CredentialPath,

  [ValidateLength(0, 64)]
  [string]$Symbol = '',

  [string]$OutputPath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = [System.IO.Path]::GetFullPath(
  (Join-Path $PSScriptRoot '..\..\..')
).TrimEnd('\')
$credentialRoot = [System.IO.Path]::GetFullPath(
  (Join-Path $env:LOCALAPPDATA 'MarketLens')
).TrimEnd('\')
$defaultPython = Join-Path $repoRoot 'backend\.venv-mt5\Scripts\python.exe'
$probePath = Join-Path $PSScriptRoot 'phase0_probe.py'
$runtimeProbePath = Join-Path $PSScriptRoot 'runtime_probe.py'

if ([string]::IsNullOrWhiteSpace($PythonPath)) {
  $PythonPath = $defaultPython
}

$fullTerminalPath = [System.IO.Path]::GetFullPath($TerminalPath)
$fullPythonPath = [System.IO.Path]::GetFullPath($PythonPath)

function Test-PythonImports {
  param([Parameter(Mandatory = $true)][string]$Executable)

  if (-not (Test-Path -LiteralPath $Executable -PathType Leaf)) {
    return [ordered]@{
      ok = $false
      python = $null
      bits = $null
      metatrader5 = $null
      websockets = $null
      error_class = 'PYTHON_NOT_FOUND'
    }
  }

  if (-not (Test-Path -LiteralPath $runtimeProbePath -PathType Leaf)) {
    return [ordered]@{
      ok = $false
      python = $null
      bits = $null
      metatrader5 = $null
      websockets = $null
      error_class = 'RUNTIME_PROBE_NOT_FOUND'
    }
  }

  $raw = & $Executable $runtimeProbePath
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace(($raw -join ''))) {
    return [ordered]@{
      ok = $false
      python = $null
      bits = $null
      metatrader5 = $null
      websockets = $null
      error_class = 'PYTHON_IMPORT_PROBE_FAILED'
    }
  }
  return (($raw -join '') | ConvertFrom-Json)
}

function Write-Result {
  param(
    [Parameter(Mandatory = $true)][string]$Json,
    [string]$Destination,
    [switch]$SensitiveAccountResult
  )

  if (-not [string]::IsNullOrWhiteSpace($Destination)) {
    $fullOutputPath = [System.IO.Path]::GetFullPath($Destination)
    $repoPrefix = $repoRoot + [System.IO.Path]::DirectorySeparatorChar
    if ($SensitiveAccountResult -and
        $fullOutputPath.StartsWith($repoPrefix, [StringComparison]::OrdinalIgnoreCase)) {
      throw 'Account probe output must remain outside the repository until manually sanitized.'
    }
    $outputDirectory = Split-Path -Parent $fullOutputPath
    if ([string]::IsNullOrWhiteSpace($outputDirectory)) {
      throw 'OutputPath must include a parent directory.'
    }
    New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
    Set-Content -LiteralPath $fullOutputPath -Value $Json -Encoding UTF8
    Write-Host "Result: $fullOutputPath"
  }
  $Json
}

$terminalExists = Test-Path -LiteralPath $fullTerminalPath -PathType Leaf
$terminalVersion = $null
$terminalCompany = $null
if ($terminalExists) {
  $versionInfo = (Get-Item -LiteralPath $fullTerminalPath).VersionInfo
  $terminalVersion = $versionInfo.ProductVersion
  $terminalCompany = $versionInfo.CompanyName
}

$pythonInfo = Test-PythonImports -Executable $fullPythonPath

if ($Mode -eq 'Host') {
  $tests = @(
    [ordered]@{ id = 'HST-01'; status = if ($env:OS -eq 'Windows_NT') { 'PASS' } else { 'FAIL' } },
    [ordered]@{ id = 'HST-02'; status = if ($terminalExists -and $terminalCompany -match 'MetaQuotes') { 'PASS' } else { 'FAIL' } },
    [ordered]@{ id = 'HST-03'; status = if (Test-Path -LiteralPath $fullPythonPath -PathType Leaf) { 'PASS' } else { 'FAIL' } },
    [ordered]@{ id = 'HST-04'; status = if ($pythonInfo.ok -and $pythonInfo.bits -eq 64) { 'PASS' } else { 'FAIL' } }
  )
  $allPassed = @($tests | Where-Object { $_.status -ne 'PASS' }).Count -eq 0
  $result = [ordered]@{
    schema_version = 1
    phase = 'mt5_windows_vm_phase0'
    mode = 'host'
    generated_at = (Get-Date).ToUniversalTime().ToString('o')
    status = if ($allPassed) { 'PASS' } else { 'BLOCKED' }
    host = [ordered]@{
      windows = [System.Environment]::OSVersion.VersionString
      powershell = $PSVersionTable.PSVersion.ToString()
      architecture = $env:PROCESSOR_ARCHITECTURE
    }
    terminal = [ordered]@{
      found = $terminalExists
      version = $terminalVersion
      company = $terminalCompany
      running_processes = @(Get-Process -Name terminal64 -ErrorAction SilentlyContinue).Count
    }
    runtime = [ordered]@{
      found = Test-Path -LiteralPath $fullPythonPath -PathType Leaf
      python = $pythonInfo.python
      bits = $pythonInfo.bits
      metatrader5 = $pythonInfo.metatrader5
      websockets = $pythonInfo.websockets
      error_class = $pythonInfo.error_class
    }
    tests = $tests
  }
  $json = $result | ConvertTo-Json -Depth 8
  Write-Result -Json $json -Destination $OutputPath
  if (-not $allPassed) { exit 2 }
  exit 0
}

if (-not $terminalExists) {
  throw "MT5 terminal was not found at the configured path."
}
if (-not $pythonInfo.ok -or $pythonInfo.bits -ne 64) {
  throw 'Managed 64-bit Python cannot import the required MT5 dependencies.'
}
if (-not (Test-Path -LiteralPath $probePath -PathType Leaf)) {
  throw 'Phase 0 Python probe is missing.'
}

if ([string]::IsNullOrWhiteSpace($CredentialPath)) {
  $CredentialPath = Join-Path $credentialRoot "mt5-vm-phase0-$AccountAlias.dpapi.json"
}
$fullCredentialPath = [System.IO.Path]::GetFullPath($CredentialPath)
$repoPrefix = $repoRoot + [System.IO.Path]::DirectorySeparatorChar
if ($fullCredentialPath.StartsWith($repoPrefix, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'CredentialPath must be outside the repository.'
}
$credentialPrefix = $credentialRoot + [System.IO.Path]::DirectorySeparatorChar
if (-not $fullCredentialPath.StartsWith($credentialPrefix, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'CredentialPath must remain under the current user LocalAppData\MarketLens directory.'
}
if (-not (Test-Path -LiteralPath $fullCredentialPath -PathType Leaf)) {
  throw 'DPAPI credential file was not found. Run Save-MT5VmPhase0Credential.ps1 first.'
}
$credentialItem = Get-Item -LiteralPath $fullCredentialPath -Force
if ($credentialItem.Attributes -band [IO.FileAttributes]::ReparsePoint) {
  throw 'CredentialPath cannot be a reparse point.'
}
$credentialAcl = Get-Acl -LiteralPath $fullCredentialPath
$currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$ownerSid = $credentialAcl.Owner
try {
  $ownerSid = ([Security.Principal.NTAccount]$credentialAcl.Owner).Translate(
    [Security.Principal.SecurityIdentifier]
  ).Value
} catch {
  $ownerSid = [string]$credentialAcl.Owner
}
if ($ownerSid -ne $currentSid) {
  throw 'Credential file must be owned by the current Windows user.'
}
$broadSids = @('S-1-1-0', 'S-1-5-11', 'S-1-5-32-545')
foreach ($rule in $credentialAcl.Access) {
  $ruleSid = $null
  try {
    $ruleSid = $rule.IdentityReference.Translate(
      [Security.Principal.SecurityIdentifier]
    ).Value
  } catch {
    continue
  }
  if ($rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and
      $broadSids -contains $ruleSid) {
    throw 'Credential file ACL grants access to a broad Windows principal.'
  }
}

$credential = Get-Content -LiteralPath $fullCredentialPath -Raw | ConvertFrom-Json
if ($credential.schema_version -ne 2 -or
    $credential.account_alias -ne $AccountAlias -or
    [string]::IsNullOrWhiteSpace([string]$credential.encrypted_payload)) {
  throw 'DPAPI credential file is malformed or belongs to another account alias.'
}

$securePayload = ConvertTo-SecureString -String $credential.encrypted_payload
$payloadPointer = [IntPtr]::Zero
$plainPayload = $null
$secret = $null
$request = $null
try {
  $payloadPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePayload)
  $plainPayload = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($payloadPointer)
  $secret = $plainPayload | ConvertFrom-Json
  if ($secret.schema_version -ne 1 -or
      [string]::IsNullOrWhiteSpace([string]$secret.login) -or
      [string]::IsNullOrWhiteSpace([string]$secret.server) -or
      [string]::IsNullOrWhiteSpace([string]$secret.password)) {
    throw 'The decrypted MT5 credential payload is malformed.'
  }

  $request = [ordered]@{
    schema_version = 1
    account_alias = $AccountAlias
    terminal_path = $fullTerminalPath
    login = [string]$secret.login
    password = [string]$secret.password
    server = [string]$secret.server
    symbol = $Symbol
    timeout_ms = 12000
  }
  $requestJson = $request | ConvertTo-Json -Compress

  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $fullPythonPath
  $startInfo.Arguments = '"' + $probePath + '"'
  $startInfo.WorkingDirectory = $repoRoot
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardInput = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true

  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $startInfo
  if (-not $process.Start()) {
    throw 'Failed to start the Phase 0 Python probe.'
  }
  $process.StandardInput.Write($requestJson)
  $process.StandardInput.Close()
  $request.password = $null
  $requestJson = $null

  $stdout = $process.StandardOutput.ReadToEnd()
  $stderr = $process.StandardError.ReadToEnd()
  $process.WaitForExit()
  $exitCode = $process.ExitCode

  if ([string]::IsNullOrWhiteSpace($stdout)) {
    throw "Phase 0 Python probe returned no JSON (exit $exitCode)."
  }
  $null = $stdout | ConvertFrom-Json

  if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $resultDir = Join-Path $env:LOCALAPPDATA 'MarketLens\phase0-results'
    $OutputPath = Join-Path $resultDir "mt5-vm-$AccountAlias.json"
  }
  Write-Result -Json $stdout.Trim() -Destination $OutputPath -SensitiveAccountResult
  if ($exitCode -ne 0) {
    if (-not [string]::IsNullOrWhiteSpace($stderr)) {
      Write-Warning 'The account probe failed; detailed Python stderr was intentionally suppressed.'
    }
    exit $exitCode
  }
} finally {
  $plainPayload = $null
  if ($null -ne $secret) { $secret.password = $null }
  if ($null -ne $request) { $request.password = $null }
  if ($payloadPointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($payloadPointer)
  }
}
