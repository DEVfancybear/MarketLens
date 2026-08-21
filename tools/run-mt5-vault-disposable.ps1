[CmdletBinding()]
param(
  [string]$VaultPath,
  [string]$GoPath = 'go.exe'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
$artifactRoot = [System.IO.Path]::GetFullPath(
  (Join-Path $repoRoot '.artifacts\mt5-vault-disposable')
).TrimEnd('\')
if ([string]::IsNullOrWhiteSpace($VaultPath)) {
  $VaultPath = Join-Path $repoRoot '.artifacts\vault-2.0.3\vault.exe'
}
$fullVaultPath = [System.IO.Path]::GetFullPath($VaultPath)
if (-not (Test-Path -LiteralPath $fullVaultPath -PathType Leaf)) {
  throw 'MT5_VAULT_BINARY_MISSING'
}
if ((Get-Item -LiteralPath $fullVaultPath -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
  throw 'MT5_VAULT_BINARY_UNSAFE'
}

New-Item -ItemType Directory -Path $artifactRoot -Force | Out-Null
$runDir = [System.IO.Path]::GetFullPath(
  (Join-Path $artifactRoot ('run-' + [Guid]::NewGuid().ToString('N')))
)
$artifactPrefix = $artifactRoot + [System.IO.Path]::DirectorySeparatorChar
if (-not $runDir.StartsWith($artifactPrefix, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'MT5_VAULT_RUN_PATH_UNSAFE'
}
New-Item -ItemType Directory -Path $runDir -Force | Out-Null

$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$listener.Start()
$port = ([Net.IPEndPoint]$listener.LocalEndpoint).Port
$listener.Stop()
$address = "http://127.0.0.1:$port"
$tokenPath = Join-Path $runDir 'vault-token'
$stdoutPath = Join-Path $runDir 'vault.stdout.log'
$stderrPath = Join-Path $runDir 'vault.stderr.log'
$rootToken = $null
$priorGoCache = $env:GOCACHE
$env:GOCACHE = Join-Path $runDir 'go-build-cache'
New-Item -ItemType Directory -Path $env:GOCACHE -Force | Out-Null

$vaultProcess = $null
$status = 'FAIL'
$failure = $null
$failureType = $null
$failureId = $null
$failureLine = $null
$stage = 'START'
$startedAt = [DateTimeOffset]::UtcNow
try {
  $stage = 'PROCESS_START'
  $vaultProcess = Start-Process -FilePath $fullVaultPath `
    -ArgumentList @(
      'server', '-dev', '-dev-no-store-token',
      "-dev-listen-address=127.0.0.1:$port"
    ) `
    -WorkingDirectory $runDir `
    -RedirectStandardOutput $stdoutPath `
    -RedirectStandardError $stderrPath `
    -WindowStyle Hidden `
    -PassThru

  $stage = 'STARTUP_WAIT'
  $healthy = $false
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    if ($vaultProcess.HasExited) {
      throw 'MT5_VAULT_DEV_SERVER_EXITED'
    }
    if ($null -eq $rootToken -and (Test-Path -LiteralPath $stdoutPath)) {
      $startupLog = Get-Content -LiteralPath $stdoutPath -Raw -ErrorAction SilentlyContinue
      $startupLogText = if ($null -eq $startupLog) { [string]::Empty } else { [string]$startupLog }
      $tokenMatch = [regex]::Match($startupLogText, '(?m)^Root Token:\s+(\S+)\s*$')
      if ($tokenMatch.Success) {
        $rootToken = $tokenMatch.Groups[1].Value
        if ($rootToken.Length -lt 16 -or $rootToken.Length -gt 4096 -or
            $rootToken -match '[\x00-\x20\x7f]') {
          throw 'MT5_VAULT_ROOT_TOKEN_INVALID'
        }
      }
      $startupLog = $null
      $startupLogText = $null
      $tokenMatch = $null
    }
    try {
      $health = Invoke-RestMethod -Uri "$address/v1/sys/health" -TimeoutSec 2
      if ($health.initialized -and -not $health.sealed -and $null -ne $rootToken) {
        $healthy = $true
        break
      }
    } catch {
      Start-Sleep -Milliseconds 250
    }
  }
  if (-not $healthy) {
    throw 'MT5_VAULT_DEV_SERVER_UNHEALTHY'
  }

  $stage = 'TOKEN_FILE_ACL'
  [IO.File]::WriteAllText($tokenPath, $rootToken, [Text.UTF8Encoding]::new($false))
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $acl = [Security.AccessControl.FileSecurity]::new()
  $acl.SetOwner($identity.User)
  $acl.SetAccessRuleProtection($true, $false)
  $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
      $identity.User,
      [Security.AccessControl.FileSystemRights]::FullControl,
      [Security.AccessControl.AccessControlType]::Allow
    ))
  Set-Acl -LiteralPath $tokenPath -AclObject $acl

  $stage = 'MOUNT'
  $mountBody = @{ type = 'kv'; options = @{ version = '2' } } | ConvertTo-Json -Compress
  $headers = @{ 'X-Vault-Token' = $rootToken }
  Invoke-RestMethod -Method Post -Uri "$address/v1/sys/mounts/mt5" `
    -Headers $headers -ContentType 'application/json' -Body $mountBody -TimeoutSec 5 | Out-Null
  $headers.Clear()
  $headers = $null
  $mountBody = $null

  $priorIntegration = $env:MT5_VAULT_INTEGRATION
  $priorAddress = $env:MT5_VAULT_ADDR
  $priorTokenFile = $env:MT5_VAULT_TOKEN_FILE
  try {
    $stage = 'GO_TEST'
    $env:MT5_VAULT_INTEGRATION = '1'
    $env:MT5_VAULT_ADDR = $address
    $env:MT5_VAULT_TOKEN_FILE = $tokenPath
    Push-Location (Join-Path $repoRoot 'backend')
    try {
      & $GoPath test ./internal/mt5vault `
        -run '^TestVaultClientDisposableKVV2Lifecycle$' -count=1 -v
      if ($LASTEXITCODE -ne 0) {
        throw 'MT5_VAULT_GO_INTEGRATION_FAILED'
      }
    } finally {
      Pop-Location
    }
  } finally {
    $env:MT5_VAULT_INTEGRATION = $priorIntegration
    $env:MT5_VAULT_ADDR = $priorAddress
    $env:MT5_VAULT_TOKEN_FILE = $priorTokenFile
  }
  $status = 'PASS'
} catch {
  $failureType = $_.Exception.GetType().FullName
  $failureId = $_.FullyQualifiedErrorId
  $failureLine = $_.InvocationInfo.ScriptLineNumber
  $failure = if ([string]$_.Exception.Message -match '^MT5_[A-Z0-9_]+$') {
    [string]$_.Exception.Message
  } else {
    "MT5_VAULT_${stage}_FAILED"
  }
  throw $failure
} finally {
  $env:GOCACHE = $priorGoCache
  $rootToken = $null
  if ($null -ne $vaultProcess -and -not $vaultProcess.HasExited) {
    Stop-Process -Id $vaultProcess.Id -Force -ErrorAction SilentlyContinue
    $vaultProcess.WaitForExit(5000) | Out-Null
  }
  if (Test-Path -LiteralPath $runDir) {
    Remove-Item -LiteralPath $runDir -Recurse -Force
  }
  $summary = [ordered]@{
    schema_version = 1
    phase = 'mt5_windows_vm_phase3_vault'
    status = $status
    vault_version = '2.0.3'
    started_at_utc = $startedAt.ToString('O')
    completed_at_utc = [DateTimeOffset]::UtcNow.ToString('O')
    put_get_rotate_delete = ($status -eq 'PASS')
    token_file_removed = (-not (Test-Path -LiteralPath $tokenPath))
    disposable_runtime_removed = (-not (Test-Path -LiteralPath $runDir))
    error_class = $failure
    diagnostic_type = $failureType
    diagnostic_id = $failureId
    diagnostic_line = $failureLine
  }
  $summary | ConvertTo-Json -Compress | Set-Content `
    -LiteralPath (Join-Path $artifactRoot 'summary.json') -Encoding UTF8
}
