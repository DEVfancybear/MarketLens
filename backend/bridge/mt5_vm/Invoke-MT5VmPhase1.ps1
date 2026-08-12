[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$')]
  [string]$AccountAlias,

  [string]$CredentialPath,
  [string]$AgentPath,
  [string]$DataRoot,
  [string]$TerminalPath = 'C:\Program Files\MetaTrader 5\terminal64.exe',
  [string]$PythonPath,
  [ValidateLength(0, 64)]
  [string]$Symbol = '',
  [switch]$IndependentWebMatchConfirmed,
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
$defaultAgent = Join-Path $repoRoot 'backend\execution\target\debug\mt5-vm-agent.exe'
$defaultPython = Join-Path $repoRoot 'backend\.venv-mt5\Scripts\python.exe'
$adapterPath = Join-Path $PSScriptRoot 'phase1_adapter.py'
$harnessPath = Join-Path $PSScriptRoot 'phase1_control_harness.py'
$aclHelperPath = Join-Path $PSScriptRoot 'Set-MT5VmPhase1RuntimeAcl.ps1'
$powershellPath = Join-Path $PSHOME 'powershell.exe'

if ([string]::IsNullOrWhiteSpace($CredentialPath)) {
  $CredentialPath = Join-Path $credentialRoot "mt5-vm-phase0-$AccountAlias.dpapi.json"
}
if ([string]::IsNullOrWhiteSpace($AgentPath)) {
  $AgentPath = $defaultAgent
}
if ([string]::IsNullOrWhiteSpace($DataRoot)) {
  $DataRoot = Join-Path $credentialRoot 'phase1-runtimes'
}
if ([string]::IsNullOrWhiteSpace($PythonPath)) {
  $PythonPath = $defaultPython
}

$fullCredentialPath = [System.IO.Path]::GetFullPath($CredentialPath)
$fullAgentPath = [System.IO.Path]::GetFullPath($AgentPath)
$fullDataRoot = [System.IO.Path]::GetFullPath($DataRoot)
$fullTerminalPath = [System.IO.Path]::GetFullPath($TerminalPath)
$fullPythonPath = [System.IO.Path]::GetFullPath($PythonPath)

$credentialPrefix = $credentialRoot + [System.IO.Path]::DirectorySeparatorChar
if (-not $fullCredentialPath.StartsWith($credentialPrefix, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'CredentialPath must remain under the current user LocalAppData\MarketLens directory.'
}
if (-not $fullDataRoot.StartsWith($credentialPrefix, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'DataRoot must remain under the current user LocalAppData\MarketLens directory for Phase 1 validation.'
}
foreach ($requiredPath in @(
  $fullCredentialPath,
  $fullAgentPath,
  $fullTerminalPath,
  $fullPythonPath,
  $adapterPath,
  $harnessPath,
  $aclHelperPath,
  $powershellPath
)) {
  if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
    throw 'A required Phase 1 artifact is missing. Build the Rust agent and provision managed Python first.'
  }
  $item = Get-Item -LiteralPath $requiredPath -Force
  if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
    throw 'Phase 1 artifacts cannot be reparse points.'
  }
}

$credentialItem = Get-Item -LiteralPath $fullCredentialPath -Force
$credentialAcl = Get-Acl -LiteralPath $fullCredentialPath
$currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$ownerSid = try {
  ([Security.Principal.NTAccount]$credentialAcl.Owner).Translate(
    [Security.Principal.SecurityIdentifier]
  ).Value
} catch {
  [string]$credentialAcl.Owner
}
if ($ownerSid -ne $currentSid) {
  throw 'Credential file must be owned by the current Windows user.'
}
$broadSids = @('S-1-1-0', 'S-1-5-11', 'S-1-5-32-545')
foreach ($rule in $credentialAcl.Access) {
  $ruleSid = try {
    $rule.IdentityReference.Translate(
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
$requestJson = $null
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

  $terminalHash = (Get-FileHash -LiteralPath $fullTerminalPath -Algorithm SHA256).Hash.ToLowerInvariant()
  $terminalConfigRoot = Join-Path (Split-Path -Parent $fullTerminalPath) 'Config'
  $serversPath = Join-Path $terminalConfigRoot 'servers.dat'
  $terminalLicensePath = Join-Path $terminalConfigRoot 'terminal.lic'
  foreach ($requiredConfigPath in @($serversPath, $terminalLicensePath)) {
    if (-not (Test-Path -LiteralPath $requiredConfigPath -PathType Leaf)) {
      throw 'The approved MT5 base is missing a required pinned bootstrap artifact.'
    }
    if ((Get-Item -LiteralPath $requiredConfigPath -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
      throw 'MT5 bootstrap artifacts cannot be reparse points.'
    }
  }
  $serversHash = (Get-FileHash -LiteralPath $serversPath -Algorithm SHA256).Hash.ToLowerInvariant()
  $terminalLicenseHash = (Get-FileHash -LiteralPath $terminalLicensePath -Algorithm SHA256).Hash.ToLowerInvariant()
  $pythonHash = (Get-FileHash -LiteralPath $fullPythonPath -Algorithm SHA256).Hash.ToLowerInvariant()
  $adapterHash = (Get-FileHash -LiteralPath $adapterPath -Algorithm SHA256).Hash.ToLowerInvariant()
  $request = [ordered]@{
    schema_version = 1
    agent_path = $fullAgentPath
    worker_id = 'worker-phase1-local'
    account_id = $AccountAlias
    lease_generation = 1
    data_root = $fullDataRoot
    terminal_base = $fullTerminalPath
    python_path = $fullPythonPath
    adapter_path = $adapterPath
    acl_helper_path = $aclHelperPath
    powershell_path = $powershellPath
    terminal_sha256 = $terminalHash
    servers_sha256 = $serversHash
    terminal_license_sha256 = $terminalLicenseHash
    python_sha256 = $pythonHash
    adapter_sha256 = $adapterHash
    login = [string]$secret.login
    password = [string]$secret.password
    server = [string]$secret.server
    symbol = $Symbol
    independent_web_match_confirmed = [bool]$IndependentWebMatchConfirmed
  }
  $requestJson = $request | ConvertTo-Json -Compress

  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $fullPythonPath
  $startInfo.Arguments = '"' + $harnessPath + '"'
  $startInfo.WorkingDirectory = $repoRoot
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardInput = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true

  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $startInfo
  if (-not $process.Start()) {
    throw 'Failed to start the Phase 1 control harness.'
  }
  $process.StandardInput.Write($requestJson)
  $process.StandardInput.Close()
  $request.login = $null
  $request.password = $null
  $request.server = $null
  $requestJson = $null

  $stdout = $process.StandardOutput.ReadToEnd()
  $stderr = $process.StandardError.ReadToEnd()
  $process.WaitForExit()
  $exitCode = $process.ExitCode
  if ([string]::IsNullOrWhiteSpace($stdout)) {
    throw "Phase 1 harness returned no JSON (exit $exitCode)."
  }
  $result = $stdout | ConvertFrom-Json
  if ($result.phase -ne 'mt5_windows_vm_phase1' -or
      $result.status -notin @('PASS', 'CONDITIONAL_PASS', 'BLOCKED')) {
    throw 'Phase 1 harness returned an invalid result.'
  }

  if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $resultDir = Join-Path $credentialRoot 'phase1-results'
    $OutputPath = Join-Path $resultDir "mt5-vm-$AccountAlias.json"
  }
  $fullOutputPath = [System.IO.Path]::GetFullPath($OutputPath)
  $repoPrefix = $repoRoot + [System.IO.Path]::DirectorySeparatorChar
  if ($fullOutputPath.StartsWith($repoPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Phase 1 validation output must remain outside the repository until manually sanitized.'
  }
  if (-not $fullOutputPath.StartsWith($credentialPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'OutputPath must remain under the current user LocalAppData\MarketLens directory.'
  }
  $outputDirectory = Split-Path -Parent $fullOutputPath
  New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
  Set-Content -LiteralPath $fullOutputPath -Value $stdout.Trim() -Encoding UTF8
  Write-Host "Result: $fullOutputPath"
  $stdout.Trim()
  if ($exitCode -ne 0 -or $result.status -eq 'BLOCKED') {
    if (-not [string]::IsNullOrWhiteSpace($stderr)) {
      Write-Warning 'The Phase 1 validation failed; detailed child stderr was intentionally suppressed.'
    }
    exit 2
  }
} finally {
  $plainPayload = $null
  $requestJson = $null
  if ($null -ne $secret) { $secret.password = $null; $secret.login = $null; $secret.server = $null }
  if ($null -ne $request) { $request.password = $null; $request.login = $null; $request.server = $null }
  if ($payloadPointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($payloadPointer)
  }
}
