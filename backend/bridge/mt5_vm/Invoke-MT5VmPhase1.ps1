[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$')]
  [string]$AccountAlias,

  [string]$CredentialPath,
  [string]$AgentPath,
  [string]$DataRoot,
  [Parameter(Mandatory = $true)]
  [string[]]$TerminalPath,
  [string]$PythonPath,
  [ValidateLength(0, 64)]
  [string]$Symbol = '',
  [switch]$IndependentWebMatchConfirmed,
  [switch]$ApplicationControlTestHost,
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
$adapterPath = Join-Path $PSScriptRoot 'phase1_adapter.py'
$harnessPath = Join-Path $PSScriptRoot 'phase1_control_harness.py'
$aclHelperPath = Join-Path $PSScriptRoot 'Set-MT5VmPhase1RuntimeAcl.ps1'
$processHelperPath = Join-Path $PSScriptRoot 'Mt5VmProcess.ps1'
$powershellPath = Join-Path $PSHOME 'powershell.exe'
$cargoPath = Join-Path $env:USERPROFILE '.cargo\bin\cargo.exe'
. $processHelperPath

if ([string]::IsNullOrWhiteSpace($CredentialPath)) {
  $CredentialPath = Join-Path $credentialRoot "mt5-vm-phase0-$AccountAlias.dpapi.json"
}
if ($ApplicationControlTestHost) {
  if (-not [string]::IsNullOrWhiteSpace($AgentPath)) {
    throw 'AgentPath cannot be combined with ApplicationControlTestHost; the live-test host is built and run only through Cargo.'
  }
} elseif ([string]::IsNullOrWhiteSpace($AgentPath)) {
  throw 'AgentPath is required for the normal Phase 1 path and must identify a valid Authenticode-signed agent.'
}
if ([string]::IsNullOrWhiteSpace($DataRoot)) {
  $DataRoot = Join-Path $credentialRoot 'phase1-runtimes'
}
if ([string]::IsNullOrWhiteSpace($PythonPath)) {
  $PythonPath = $defaultPython
}

$fullCredentialPath = [System.IO.Path]::GetFullPath($CredentialPath)
$fullAgentPath = if ($ApplicationControlTestHost) {
  [System.IO.Path]::GetFullPath($cargoPath)
} else {
  [System.IO.Path]::GetFullPath($AgentPath)
}
$fullDataRoot = [System.IO.Path]::GetFullPath($DataRoot)
$fullTerminalPaths = @($TerminalPath | ForEach-Object {
  [System.IO.Path]::GetFullPath($_)
})
if ($fullTerminalPaths.Count -eq 0 -or $fullTerminalPaths.Count -gt 32) {
  throw 'Provide between one and 32 separately installed terminal slots.'
}
if (@($fullTerminalPaths | Sort-Object -Unique).Count -ne $fullTerminalPaths.Count) {
  throw 'TerminalPath entries must be unique installed slots.'
}
$fullPythonPath = [System.IO.Path]::GetFullPath($PythonPath)

$credentialPrefix = $credentialRoot + [System.IO.Path]::DirectorySeparatorChar
if (-not $fullCredentialPath.StartsWith($credentialPrefix, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'CredentialPath must remain under the current user LocalAppData\MarketLens directory.'
}
if (-not $fullDataRoot.StartsWith($credentialPrefix, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'DataRoot must remain under the current user LocalAppData\MarketLens directory for Phase 1 validation.'
}
$requiredArtifacts = @($fullCredentialPath, $fullAgentPath) + $fullTerminalPaths + @(
  $fullPythonPath, $adapterPath, $harnessPath, $aclHelperPath, $powershellPath
)
foreach ($requiredPath in $requiredArtifacts) {
  if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
    throw 'A required Phase 1 artifact is missing. Build the Rust agent and provision managed Python first.'
  }
  $item = Get-Item -LiteralPath $requiredPath -Force
  if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
    throw 'Phase 1 artifacts cannot be reparse points.'
  }
}
if (-not $ApplicationControlTestHost) {
  $agentSignature = Get-AuthenticodeSignature -FilePath $fullAgentPath
  if ($agentSignature.Status -ne [System.Management.Automation.SignatureStatus]::Valid -or
      $null -eq $agentSignature.SignerCertificate) {
    throw 'The normal Phase 1 path requires a valid Authenticode-signed agent.'
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
      throw 'Every terminal slot must be stopped before Phase 1 validation.'
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
    foreach ($requiredConfigPath in @($serversPath, $terminalLicensePath)) {
      if (-not (Test-Path -LiteralPath $requiredConfigPath -PathType Leaf)) {
        throw 'A terminal slot is missing its enrolled server catalog or terminal license.'
      }
      if ((Get-Item -LiteralPath $requiredConfigPath -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw 'MT5 slot artifacts cannot be reparse points.'
      }
    }
    $terminalSlots += [ordered]@{
      terminal_path = $slotPath
      terminal_sha256 = (Get-FileHash -LiteralPath $slotPath -Algorithm SHA256).Hash.ToLowerInvariant()
      servers_sha256 = (Get-FileHash -LiteralPath $serversPath -Algorithm SHA256).Hash.ToLowerInvariant()
      terminal_license_sha256 = (Get-FileHash -LiteralPath $terminalLicensePath -Algorithm SHA256).Hash.ToLowerInvariant()
    }
  }
  $pythonHash = (Get-FileHash -LiteralPath $fullPythonPath -Algorithm SHA256).Hash.ToLowerInvariant()
  $adapterHash = (Get-FileHash -LiteralPath $adapterPath -Algorithm SHA256).Hash.ToLowerInvariant()
  $request = [ordered]@{
    schema_version = 1
    agent_path = $fullAgentPath
    worker_id = 'worker-phase1-local'
    account_id = $AccountAlias
    lease_generation = 1
    data_root = $fullDataRoot
    terminal_slots = @($terminalSlots)
    python_path = $fullPythonPath
    adapter_path = $adapterPath
    acl_helper_path = $aclHelperPath
    powershell_path = $powershellPath
    python_sha256 = $pythonHash
    adapter_sha256 = $adapterHash
    login = [string]$secret.login
    password = [string]$secret.password
    server = [string]$secret.server
    symbol = $Symbol
    independent_web_match_confirmed = [bool]$IndependentWebMatchConfirmed
  }
  $requestJson = $request | ConvertTo-Json -Compress

  if ($ApplicationControlTestHost) {
    $manifestPath = Join-Path $repoRoot 'backend\execution\Cargo.toml'
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $cargoPath
    $startInfo.Arguments = 'test --manifest-path "' + $manifestPath +
      '" -p mt5-vm-agent --lib process::tests::live_installed_slot_lifecycle_from_stdin' +
      ' -- --ignored --exact --nocapture --test-threads=1'
    $startInfo.WorkingDirectory = $repoRoot
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardInput = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    if (-not (Start-MT5VmProcessWithUtf8NoBomStandardInput -Process $process)) {
      throw 'Failed to start the Application Control live-test host.'
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
    $matches = [Regex]::Matches(
      $stdout,
      'PHASE1_LIVE_RESULT=(\{[^\r\n]+\})'
    )
    if ($matches.Count -ne 1) {
      throw 'The Application Control live-test host returned no unique safe result.'
    }
    $safeResultJson = $matches[0].Groups[1].Value
    $result = $safeResultJson | ConvertFrom-Json
    if ($result.phase -ne 'mt5_windows_vm_phase1' -or
        $result.status -notin @('PASS', 'CONDITIONAL_PASS', 'BLOCKED')) {
      throw 'The Application Control live-test host returned an invalid result.'
    }
    if ([string]::IsNullOrWhiteSpace($OutputPath)) {
      $resultDir = Join-Path $credentialRoot 'phase1-results'
      $OutputPath = Join-Path $resultDir "mt5-vm-$AccountAlias.json"
    }
    $fullOutputPath = [System.IO.Path]::GetFullPath($OutputPath)
    $repoPrefix = $repoRoot + [System.IO.Path]::DirectorySeparatorChar
    if ($fullOutputPath.StartsWith($repoPrefix, [StringComparison]::OrdinalIgnoreCase) -or
        -not $fullOutputPath.StartsWith($credentialPrefix, [StringComparison]::OrdinalIgnoreCase)) {
      throw 'Phase 1 validation output must remain under LocalAppData\MarketLens and outside the repository.'
    }
    $outputDirectory = Split-Path -Parent $fullOutputPath
    New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
    Set-Content -LiteralPath $fullOutputPath -Value $safeResultJson -Encoding UTF8
    Write-Host "Result: $fullOutputPath"
    $safeResultJson
    if ($process.ExitCode -ne 0 -or $result.status -eq 'BLOCKED') {
      if (-not [string]::IsNullOrWhiteSpace($stderr)) {
        Write-Warning 'The live-test host failed; detailed cargo stderr was intentionally suppressed.'
      }
      exit 2
    }
    exit 0
  }

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
  if (-not (Start-MT5VmProcessWithUtf8NoBomStandardInput -Process $process)) {
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
