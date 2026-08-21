[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateCount(2, 2)]
  [string[]]$AccountAlias,

  [string[]]$CredentialPath,
  [Parameter(Mandatory = $true)]
  [string]$AgentPath,
  [string]$DataRoot,
  [Parameter(Mandatory = $true)]
  [ValidateCount(2, 2)]
  [string[]]$TerminalPath,
  [string]$PythonPath,
  [ValidateCount(2, 2)]
  [string[]]$Symbol = @('EURUSD', 'EURUSD'),
  [switch]$IndependentWebMatchConfirmed,
  [string]$OutputPath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..')).TrimEnd('\')
$credentialRoot = [System.IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'MarketLens')).TrimEnd('\')
$credentialPrefix = $credentialRoot + [System.IO.Path]::DirectorySeparatorChar
$defaultPython = Join-Path $repoRoot 'backend\.venv-mt5\Scripts\python.exe'
$adapterPath = Join-Path $PSScriptRoot 'phase1_adapter.py'
$harnessPath = Join-Path $PSScriptRoot 'phase1_control_harness.py'
$aclHelperPath = Join-Path $PSScriptRoot 'Set-MT5VmPhase1RuntimeAcl.ps1'
$processHelperPath = Join-Path $PSScriptRoot 'Mt5VmProcess.ps1'
$powershellPath = Join-Path $PSHOME 'powershell.exe'
. $processHelperPath

if ($AccountAlias[0] -eq $AccountAlias[1] -or
    $AccountAlias.Where({ $_ -notmatch '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$' }).Count -gt 0) {
  throw 'AccountAlias must contain two distinct safe aliases.'
}
if ($TerminalPath[0] -eq $TerminalPath[1]) {
  throw 'TerminalPath must contain two separately installed terminal slots.'
}
if ($Symbol.Where({ $_.Length -gt 64 -or $_ -match '[\x00-\x1f\x7f]' }).Count -gt 0) {
  throw 'Symbol entries are invalid.'
}
if ($null -eq $CredentialPath -or $CredentialPath.Count -eq 0) {
  $CredentialPath = @(
    $AccountAlias | ForEach-Object { Join-Path $credentialRoot "mt5-vm-phase0-$_.dpapi.json" }
  )
}
if ($CredentialPath.Count -ne 2) {
  throw 'CredentialPath must contain exactly two DPAPI credential files.'
}
if ([string]::IsNullOrWhiteSpace($DataRoot)) {
  $DataRoot = Join-Path $credentialRoot 'phase1-two-account-runtimes'
}
if ([string]::IsNullOrWhiteSpace($PythonPath)) {
  $PythonPath = $defaultPython
}

$fullAgentPath = [System.IO.Path]::GetFullPath($AgentPath)
$fullDataRoot = [System.IO.Path]::GetFullPath($DataRoot)
$fullPythonPath = [System.IO.Path]::GetFullPath($PythonPath)
$fullTerminalPaths = @($TerminalPath | ForEach-Object { [System.IO.Path]::GetFullPath($_) })
$fullCredentialPaths = @($CredentialPath | ForEach-Object { [System.IO.Path]::GetFullPath($_) })
$repoPrefix = $repoRoot + [System.IO.Path]::DirectorySeparatorChar

if (-not $fullDataRoot.StartsWith($credentialPrefix, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'DataRoot must remain under the current user LocalAppData\MarketLens directory.'
}
foreach ($credentialFile in $fullCredentialPaths) {
  if (-not $credentialFile.StartsWith($credentialPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'CredentialPath must remain under the current user LocalAppData\MarketLens directory.'
  }
}
foreach ($requiredPath in @(
    $fullAgentPath, $fullPythonPath, $adapterPath, $harnessPath,
    $aclHelperPath, $powershellPath
  ) + $fullTerminalPaths + $fullCredentialPaths) {
  if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
    throw 'A required two-account Phase 1 artifact is missing.'
  }
  if ((Get-Item -LiteralPath $requiredPath -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
    throw 'Two-account Phase 1 artifacts cannot be reparse points.'
  }
}

$agentSignature = Get-AuthenticodeSignature -FilePath $fullAgentPath
if ($agentSignature.Status -ne [System.Management.Automation.SignatureStatus]::Valid -or
    $null -eq $agentSignature.SignerCertificate) {
  throw 'The two-account gate requires a valid Authenticode-signed agent.'
}

$terminalSlots = @()
foreach ($slotPath in $fullTerminalPaths) {
  $signature = Get-AuthenticodeSignature -FilePath $slotPath
  if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid -or
      $null -eq $signature.SignerCertificate -or
      $signature.SignerCertificate.Subject -notmatch 'MetaQuotes') {
    throw 'Every terminal slot must have a valid MetaQuotes Authenticode signature.'
  }
  $runningSlot = Get-CimInstance Win32_Process -Filter "Name='terminal64.exe'" |
    Where-Object { $_.ExecutablePath -eq $slotPath }
  if ($null -ne $runningSlot) {
    throw 'Every terminal slot must be stopped before the two-account gate.'
  }
  $terminalDirectory = Split-Path -Parent $slotPath
  $terminalLicensePath = Join-Path $terminalDirectory 'Config\terminal.lic'
  $instanceBytes = [Text.Encoding]::Unicode.GetBytes($terminalDirectory.ToUpperInvariant())
  $md5 = [Security.Cryptography.MD5]::Create()
  try {
    $instanceId = ([BitConverter]::ToString($md5.ComputeHash($instanceBytes))).Replace('-', '')
  } finally {
    $md5.Dispose()
    [Array]::Clear($instanceBytes, 0, $instanceBytes.Length)
  }
  $serversPath = Join-Path $env:APPDATA "MetaQuotes\Terminal\$instanceId\Config\servers.dat"
  foreach ($configPath in @($terminalLicensePath, $serversPath)) {
    if (-not (Test-Path -LiteralPath $configPath -PathType Leaf) -or
        ((Get-Item -LiteralPath $configPath -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
      throw 'A terminal slot is missing a safe enrolled server catalog or terminal license.'
    }
  }
  $terminalSlots += [ordered]@{
    terminal_path = $slotPath
    terminal_sha256 = (Get-FileHash -LiteralPath $slotPath -Algorithm SHA256).Hash.ToLowerInvariant()
    servers_sha256 = (Get-FileHash -LiteralPath $serversPath -Algorithm SHA256).Hash.ToLowerInvariant()
    terminal_license_sha256 = (Get-FileHash -LiteralPath $terminalLicensePath -Algorithm SHA256).Hash.ToLowerInvariant()
  }
}

$currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$broadSids = @('S-1-1-0', 'S-1-5-11', 'S-1-5-32-545')
$accounts = @()
$request = $null
$requestJson = $null
try {
  for ($index = 0; $index -lt 2; $index++) {
    $credentialFile = $fullCredentialPaths[$index]
    $credentialAcl = Get-Acl -LiteralPath $credentialFile
    $ownerSid = try {
      ([Security.Principal.NTAccount]$credentialAcl.Owner).Translate(
        [Security.Principal.SecurityIdentifier]
      ).Value
    } catch {
      [string]$credentialAcl.Owner
    }
    if ($ownerSid -ne $currentSid) {
      throw 'Every credential file must be owned by the current Windows user.'
    }
    foreach ($rule in $credentialAcl.Access) {
      $ruleSid = try {
        $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
      } catch {
        continue
      }
      if ($rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and
          $broadSids -contains $ruleSid) {
        throw 'A credential file ACL grants access to a broad Windows principal.'
      }
    }
    $credential = Get-Content -LiteralPath $credentialFile -Raw | ConvertFrom-Json
    if ($credential.schema_version -ne 2 -or
        $credential.account_alias -ne $AccountAlias[$index] -or
        [string]::IsNullOrWhiteSpace([string]$credential.encrypted_payload)) {
      throw 'A DPAPI credential file is malformed or belongs to another alias.'
    }
    $securePayload = ConvertTo-SecureString -String $credential.encrypted_payload
    $payloadPointer = [IntPtr]::Zero
    $plainPayload = $null
    try {
      $payloadPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePayload)
      $plainPayload = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($payloadPointer)
      $secret = $plainPayload | ConvertFrom-Json
      if ($secret.schema_version -ne 1 -or
          [string]::IsNullOrWhiteSpace([string]$secret.login) -or
          [string]::IsNullOrWhiteSpace([string]$secret.server) -or
          [string]::IsNullOrWhiteSpace([string]$secret.password)) {
        throw 'A decrypted MT5 credential payload is malformed.'
      }
      $accounts += [ordered]@{
        account_id = $AccountAlias[$index]
        lease_generation = 1
        login = [string]$secret.login
        password = [string]$secret.password
        server = [string]$secret.server
        symbol = $Symbol[$index]
        independent_web_match_confirmed = [bool]$IndependentWebMatchConfirmed
      }
    } finally {
      if ($payloadPointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($payloadPointer)
      }
      $plainPayload = $null
      $secret = $null
      $securePayload.Dispose()
    }
  }

  $request = [ordered]@{
    schema_version = 1
    agent_path = $fullAgentPath
    worker_id = 'worker-phase1-two-account'
    data_root = $fullDataRoot
    terminal_slots = @($terminalSlots)
    python_path = $fullPythonPath
    adapter_path = $adapterPath
    acl_helper_path = $aclHelperPath
    powershell_path = $powershellPath
    python_sha256 = (Get-FileHash -LiteralPath $fullPythonPath -Algorithm SHA256).Hash.ToLowerInvariant()
    adapter_sha256 = (Get-FileHash -LiteralPath $adapterPath -Algorithm SHA256).Hash.ToLowerInvariant()
    accounts = @($accounts)
  }
  $requestJson = $request | ConvertTo-Json -Compress -Depth 8
  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $fullPythonPath
  $startInfo.Arguments = '"' + $harnessPath + '" --two-account-stdio'
  $startInfo.WorkingDirectory = $repoRoot
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardInput = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $startInfo
  if (-not (Start-MT5VmProcessWithUtf8NoBomStandardInput -Process $process)) {
    throw 'Failed to start the two-account Phase 1 harness.'
  }
  $process.StandardInput.Write($requestJson)
  $process.StandardInput.Close()
  foreach ($account in $request.accounts) {
    $account.login = $null
    $account.password = $null
    $account.server = $null
  }
  $requestJson = $null
  $stdout = $process.StandardOutput.ReadToEnd()
  $null = $process.StandardError.ReadToEnd()
  $process.WaitForExit()
  $exitCode = $process.ExitCode
  if ([string]::IsNullOrWhiteSpace($stdout) -or $stdout.Length -gt 65536) {
    throw 'The two-account Phase 1 harness returned no bounded safe result.'
  }
  $result = $stdout | ConvertFrom-Json
  if ($result.phase -ne 'mt5_windows_vm_phase1_two_account' -or
      $result.status -notin @('PASS', 'CONDITIONAL_PASS', 'BLOCKED')) {
    throw 'The two-account Phase 1 harness returned an invalid result.'
  }
  if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $OutputPath = Join-Path $credentialRoot 'phase1-results\mt5-vm-two-account.json'
  }
  $fullOutputPath = [System.IO.Path]::GetFullPath($OutputPath)
  if ($fullOutputPath.StartsWith($repoPrefix, [StringComparison]::OrdinalIgnoreCase) -or
      -not $fullOutputPath.StartsWith($credentialPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Two-account validation output must remain under LocalAppData\MarketLens and outside Git.'
  }
  New-Item -ItemType Directory -Path (Split-Path -Parent $fullOutputPath) -Force | Out-Null
  Set-Content -LiteralPath $fullOutputPath -Value $stdout.Trim() -Encoding UTF8
  Write-Host "Result: $fullOutputPath"
  $stdout.Trim()
  if ($exitCode -ne 0 -or $result.status -eq 'BLOCKED') {
    exit 2
  }
} finally {
  foreach ($account in $accounts) {
    $account.login = $null
    $account.password = $null
    $account.server = $null
  }
  if ($null -ne $request) {
    foreach ($account in $request.accounts) {
      $account.login = $null
      $account.password = $null
      $account.server = $null
    }
  }
  $requestJson = $null
}
