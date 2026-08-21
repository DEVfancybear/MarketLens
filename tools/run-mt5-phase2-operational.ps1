<#
.SYNOPSIS
  Run the MT5 Phase 2 restart, session-rotation, and reassignment gate twice.

.DESCRIPTION
  Builds the execution gateway, starts one loopback-only disposable PostgreSQL cluster,
  and runs two clean attempts. Each attempt starts two gateway processes sequentially
  against one database and uses Playwright API requests for the private HTTP contract.
  Runtime tokens and identifiers live only in a user-ACL temporary directory that is
  removed in finally. The persisted summary contains counts and generations only.
#>
[CmdletBinding()]
param(
  [string]$CargoPath = 'cargo.exe',
  [string]$GoPath = 'go.exe',
  [string]$NodeModulesRoot
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
$artifactRoot = [IO.Path]::GetFullPath(
  (Join-Path $repoRoot '.artifacts\mt5-phase2-operational')
).TrimEnd('\')
$archivePath = [IO.Path]::GetFullPath(
  (Join-Path $repoRoot '.artifacts\postgresql-17.11-windows-x64-binaries.zip')
)
$packageSummaryPath = Join-Path $repoRoot '.artifacts\mt5-phase2-postgres-package.json'
$summaryPath = Join-Path $artifactRoot 'summary.json'
$archiveUrl = 'https://get.enterprisedb.com/postgresql/postgresql-17.11-1-windows-x64-binaries.zip'
$archiveSha256 = '6EABDF00D2893713B75DB4336A23C3FDF505F056E217EC6E2E95D901750CFEA3'
$runDir = [IO.Path]::GetFullPath((Join-Path $artifactRoot ('run-' + [Guid]::NewGuid().ToString('N'))))
$gatewayPath = Join-Path $repoRoot 'backend\execution\target\debug\execution-gateway.exe'
$playwrightConfig = Join-Path $repoRoot 'frontend\playwright.mt5-phase2.config.ts'
if ([string]::IsNullOrWhiteSpace($NodeModulesRoot)) {
  $NodeModulesRoot = Join-Path $repoRoot 'frontend\node_modules'
}
$playwrightPath = Join-Path $NodeModulesRoot '.bin\playwright.cmd'

$postgresProcess = $null
$gatewayProcess = $null
$attemptResults = [Collections.Generic.List[object]]::new()
$status = 'FAIL'
$failure = $null
$failureType = $null
$failureId = $null
$failureLine = $null
$stage = 'START'
$failedStage = $null
$startedAt = [DateTimeOffset]::UtcNow
$priorGoCache = $env:GOCACHE

function Assert-UnderRoot([string]$Path, [string]$Root) {
  $resolved = [IO.Path]::GetFullPath($Path)
  $prefix = [IO.Path]::GetFullPath($Root).TrimEnd('\') + [IO.Path]::DirectorySeparatorChar
  if (-not $resolved.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'MT5_PHASE2_PATH_OUTSIDE_DISPOSABLE_ROOT'
  }
  return $resolved
}

function Assert-NotReparse([string]$Path) {
  if (Test-Path -LiteralPath $Path) {
    $item = Get-Item -LiteralPath $Path -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw 'MT5_PHASE2_REPARSE_PATH_REJECTED'
    }
  }
}

function Set-PrivateAcl([string]$Path) {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $acl = [Security.AccessControl.FileSecurity]::new()
  if (Test-Path -LiteralPath $Path -PathType Container) {
    $acl = [Security.AccessControl.DirectorySecurity]::new()
    $rule = [Security.AccessControl.FileSystemAccessRule]::new(
      $identity.User,
      [Security.AccessControl.FileSystemRights]::FullControl,
      [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit',
      [Security.AccessControl.PropagationFlags]::None,
      [Security.AccessControl.AccessControlType]::Allow
    )
  } else {
    $rule = [Security.AccessControl.FileSystemAccessRule]::new(
      $identity.User,
      [Security.AccessControl.FileSystemRights]::FullControl,
      [Security.AccessControl.AccessControlType]::Allow
    )
  }
  $acl.SetOwner($identity.User)
  $acl.SetAccessRuleProtection($true, $false)
  $acl.AddAccessRule($rule)
  Set-Acl -LiteralPath $Path -AclObject $acl
}

function New-RandomSecret {
  $bytes = [byte[]]::new(32)
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($bytes)
    return ([BitConverter]::ToString($bytes)).Replace('-', '').ToLowerInvariant()
  } finally {
    [Array]::Clear($bytes, 0, $bytes.Length)
    $rng.Dispose()
  }
}

function New-LoopbackPort {
  $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
  try {
    $listener.Start()
    return ([Net.IPEndPoint]$listener.LocalEndpoint).Port
  } finally {
    $listener.Stop()
  }
}

function Invoke-Native(
  [string]$File,
  [string[]]$Arguments,
  [string]$WorkingDirectory,
  [string]$LogPath
) {
  $priorPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  Push-Location $WorkingDirectory
  try {
    $output = & $File @Arguments 2>&1 | ForEach-Object { $_.ToString() }
    $exitCode = $LASTEXITCODE
  } finally {
    Pop-Location
    $ErrorActionPreference = $priorPreference
  }
  $output | Set-Content -LiteralPath $LogPath -Encoding UTF8
  if ($exitCode -ne 0) {
    throw 'MT5_PHASE2_NATIVE_COMMAND_FAILED'
  }
}

function Invoke-Psql(
  [string]$PsqlPath,
  [int]$Port,
  [string]$Database,
  [string]$Sql
) {
  $info = [Diagnostics.ProcessStartInfo]::new()
  $info.FileName = $PsqlPath
  $info.WorkingDirectory = $runDir
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $true
  $info.RedirectStandardInput = $true
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  # Windows PowerShell 5.1 does not expose ProcessStartInfo.ArgumentList;
  # these values are generated/fixed and contain no spaces or shell syntax.
  $info.Arguments = [string]::Join(' ', @(
    '--no-psqlrc', '--quiet', '--tuples-only', '--no-align',
    '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', ([string]$Port),
    '-U', 'mt5_phase2', '-d', $Database
  ))
  $process = [Diagnostics.Process]::new()
  $process.StartInfo = $info
  if (-not $process.Start()) { throw 'MT5_PHASE2_PSQL_START_FAILED' }
  try {
    $process.StandardInput.Write($Sql)
    $process.StandardInput.Close()
    $stdout = $process.StandardOutput.ReadToEnd()
    $stderr = $process.StandardError.ReadToEnd()
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) {
      $stderr = $null
      throw 'MT5_PHASE2_PSQL_FAILED'
    }
    return $stdout.Trim()
  } finally {
    $stdout = $null
    $stderr = $null
    $process.Dispose()
  }
}

function Start-Gateway(
  [string]$DatabaseUrl,
  [int]$EaPort,
  [int]$AdminPort,
  [string]$AdminToken,
  [string]$BootstrapToken
) {
  $info = [Diagnostics.ProcessStartInfo]::new()
  $info.FileName = $gatewayPath
  $info.WorkingDirectory = Join-Path $repoRoot 'backend\execution'
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $true
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  $info.EnvironmentVariables['DATABASE_URL'] = $DatabaseUrl
  $info.EnvironmentVariables['EXECUTION_GATEWAY_BIND'] = "127.0.0.1:$EaPort"
  $info.EnvironmentVariables['EXECUTION_ADMIN_BIND'] = "127.0.0.1:$AdminPort"
  $info.EnvironmentVariables['EXECUTION_ADMIN_TOKEN'] = $AdminToken
  $info.EnvironmentVariables['EXECUTION_MT5_VM_BOOTSTRAP_TOKEN'] = $BootstrapToken
  $info.EnvironmentVariables['EXECUTION_DATABASE_MAX_CONNECTIONS'] = '4'
  $info.EnvironmentVariables['RUST_LOG'] = 'error'
  $process = [Diagnostics.Process]::new()
  $process.StartInfo = $info
  if (-not $process.Start()) { throw 'MT5_PHASE2_GATEWAY_START_FAILED' }
  return $process
}

function Stop-ExactProcess([Diagnostics.Process]$Process) {
  if ($null -eq $Process) { return }
  try {
    if (-not $Process.HasExited) {
      Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
      $Process.WaitForExit(5000) | Out-Null
    }
    if ($Process.StartInfo.RedirectStandardOutput) {
      $Process.StandardOutput.ReadToEnd() | Out-Null
      $Process.StandardError.ReadToEnd() | Out-Null
    }
  } finally {
    $Process.Dispose()
  }
}

function Wait-Gateway([Diagnostics.Process]$Process, [int]$AdminPort) {
  for ($attempt = 0; $attempt -lt 80; $attempt++) {
    if ($Process.HasExited) { throw 'MT5_PHASE2_GATEWAY_EXITED' }
    try {
      $response = Invoke-WebRequest -Uri "http://127.0.0.1:$AdminPort/health" `
        -UseBasicParsing -TimeoutSec 2
      if ($response.StatusCode -eq 200) { return }
    } catch {
      Start-Sleep -Milliseconds 250
    }
  }
  throw 'MT5_PHASE2_GATEWAY_UNHEALTHY'
}

function Wait-Postgres([string]$PgIsReadyPath, [int]$Port) {
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    $priorPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
      & $PgIsReadyPath '-h' '127.0.0.1' '-p' ([string]$Port) '-U' 'mt5_phase2' '-d' 'postgres' 2>$null | Out-Null
      $readyExit = $LASTEXITCODE
    } finally {
      $ErrorActionPreference = $priorPreference
    }
    if ($readyExit -eq 0) { return }
    Start-Sleep -Milliseconds 500
  }
  throw 'MT5_PHASE2_POSTGRES_UNHEALTHY'
}

function Write-PrivateText([string]$Path, [string]$Value) {
  [IO.File]::WriteAllText($Path, $Value, [Text.UTF8Encoding]::new($false))
  Set-PrivateAcl $Path
}

function Invoke-PlaywrightStage(
  [string]$Stage,
  [string]$ConfigPath,
  [string]$LogPath
) {
  $priorConfig = $env:MT5_PHASE2_TEST_CONFIG_FILE
  $priorStage = $env:MT5_PHASE2_OPERATIONAL_STAGE
  try {
    $env:MT5_PHASE2_TEST_CONFIG_FILE = $ConfigPath
    $env:MT5_PHASE2_OPERATIONAL_STAGE = $Stage
    Invoke-Native $playwrightPath @(
      'test', '--config', $playwrightConfig, '--workers=1', '--retries=0'
    ) (Join-Path $repoRoot 'frontend') $LogPath
  } finally {
    $env:MT5_PHASE2_TEST_CONFIG_FILE = $priorConfig
    $env:MT5_PHASE2_OPERATIONAL_STAGE = $priorStage
  }
}

try {
  $stage = 'PREFLIGHT'
  New-Item -ItemType Directory -Path $artifactRoot -Force | Out-Null
  $runPrefix = $artifactRoot + [IO.Path]::DirectorySeparatorChar
  if (-not $runDir.StartsWith($runPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'MT5_PHASE2_RUN_PATH_UNSAFE'
  }
  Assert-NotReparse $artifactRoot
  if (-not (Test-Path -LiteralPath $playwrightPath -PathType Leaf)) {
    throw 'MT5_PHASE2_PLAYWRIGHT_MISSING'
  }
  if (-not (Test-Path -LiteralPath $playwrightConfig -PathType Leaf)) {
    throw 'MT5_PHASE2_PLAYWRIGHT_CONFIG_MISSING'
  }
  New-Item -ItemType Directory -Path $runDir | Out-Null
  Set-PrivateAcl $runDir
  $env:GOCACHE = Join-Path $runDir 'go-build-cache'
  New-Item -ItemType Directory -Path $env:GOCACHE -Force | Out-Null
  $logDir = Join-Path $runDir 'logs'
  New-Item -ItemType Directory -Path $logDir | Out-Null

  $stage = 'POSTGRES_PACKAGE'
  if (-not (Test-Path -LiteralPath $archivePath -PathType Leaf)) {
    $curl = (Get-Command 'curl.exe' -ErrorAction Stop).Source
    Invoke-Native $curl @(
      '--fail-with-body', '--http1.1', '--tlsv1.2', '--ssl-no-revoke',
      '--location', '--retry', '3', '--retry-delay', '2',
      '--output', $archivePath, $archiveUrl
    ) $repoRoot (Join-Path $logDir 'postgres-download.log')
  }
  Assert-NotReparse $archivePath
  $actualHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash
  if ($actualHash -ne $archiveSha256) { throw 'MT5_PHASE2_POSTGRES_HASH_MISMATCH' }
  [ordered]@{
    source = 'EDB PostgreSQL binaries'
    version = '17.11'
    url = $archiveUrl
    sha256 = $actualHash
    bytes = (Get-Item -LiteralPath $archivePath).Length
  } | ConvertTo-Json -Compress | Set-Content -LiteralPath $packageSummaryPath -Encoding UTF8

  $stage = 'POSTGRES_EXTRACT'
  $installRoot = Join-Path $runDir 'postgres'
  New-Item -ItemType Directory -Path $installRoot | Out-Null
  $tar = (Get-Command 'tar.exe' -ErrorAction Stop).Source
  Invoke-Native $tar @(
    '-xf', $archivePath, '-C', $installRoot, 'pgsql/bin', 'pgsql/lib', 'pgsql/share'
  ) $repoRoot (Join-Path $logDir 'postgres-extract.log')
  $postgresBin = Join-Path $installRoot 'pgsql\bin'
  $initdbPath = Join-Path $postgresBin 'initdb.exe'
  $postgresPath = Join-Path $postgresBin 'postgres.exe'
  $pgIsReadyPath = Join-Path $postgresBin 'pg_isready.exe'
  $createdbPath = Join-Path $postgresBin 'createdb.exe'
  $psqlPath = Join-Path $postgresBin 'psql.exe'
  foreach ($path in @($initdbPath, $postgresPath, $pgIsReadyPath, $createdbPath, $psqlPath)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
      throw 'MT5_PHASE2_POSTGRES_BINARY_MISSING'
    }
  }
  $reparse = @(Get-ChildItem -LiteralPath $installRoot -Force -Recurse |
      Where-Object { ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 })
  if ($reparse.Count -ne 0) { throw 'MT5_PHASE2_POSTGRES_ARCHIVE_UNSAFE' }

  $stage = 'POSTGRES_START'
  $dataRoot = Join-Path $runDir 'pgdata'
  New-Item -ItemType Directory -Path $dataRoot | Out-Null
  Invoke-Native $initdbPath @(
    '-D', $dataRoot, '-U', 'mt5_phase2', '--auth=trust', '--auth-host=trust',
    '--auth-local=trust', '--no-locale', '--encoding=UTF8'
  ) $runDir (Join-Path $logDir 'initdb.log')
  $postgresPort = New-LoopbackPort
  $postgresProcess = Start-Process -FilePath $postgresPath `
    -ArgumentList @(
      '-D', $dataRoot, '-h', '127.0.0.1', '-p', ([string]$postgresPort),
      '-c', 'listen_addresses=127.0.0.1'
    ) `
    -WorkingDirectory $runDir `
    -RedirectStandardOutput (Join-Path $logDir 'postgres.stdout.log') `
    -RedirectStandardError (Join-Path $logDir 'postgres.stderr.log') `
    -WindowStyle Hidden `
    -PassThru
  Wait-Postgres $pgIsReadyPath $postgresPort

  $stage = 'BUILD_GATEWAY'
  Invoke-Native $CargoPath @(
    'build', '--manifest-path', (Join-Path $repoRoot 'backend\execution\Cargo.toml'),
    '-p', 'execution-gateway'
  ) $repoRoot (Join-Path $logDir 'cargo-build.log')
  if (-not (Test-Path -LiteralPath $gatewayPath -PathType Leaf)) {
    throw 'MT5_PHASE2_GATEWAY_BINARY_MISSING'
  }

  for ($attempt = 1; $attempt -le 2; $attempt++) {
    $attemptDir = Join-Path $runDir "attempt-$attempt"
    New-Item -ItemType Directory -Path $attemptDir | Out-Null
    $databaseName = "mt5_phase2_attempt_$attempt"
    $stage = "ATTEMPT_${attempt}_DATABASE"
    Invoke-Native $createdbPath @(
      '-h', '127.0.0.1', '-p', ([string]$postgresPort), '-U', 'mt5_phase2', $databaseName
    ) $runDir (Join-Path $logDir "createdb-$attempt.log")
    $databaseUrl = "postgresql://mt5_phase2@127.0.0.1:$postgresPort/${databaseName}?sslmode=disable"
    $priorDatabaseUrl = $env:DATABASE_URL
    try {
      $env:DATABASE_URL = $databaseUrl
      Invoke-Native $GoPath @('run', './cmd/migrate', 'up') `
        (Join-Path $repoRoot 'backend') (Join-Path $logDir "migrate-$attempt.log")
    } finally {
      $env:DATABASE_URL = $priorDatabaseUrl
    }

    $workerId = 'phase2-worker-' + [Guid]::NewGuid().ToString('N').Substring(0, 12)
    $accountId = 'mt5test_' + [Guid]::NewGuid().ToString('N')
    $ownerId = [Guid]::NewGuid().ToString()
    $secretRef = 'mt5-' + [Guid]::NewGuid().ToString('N')
    $fixtureSql = @"
INSERT INTO users (id, email, email_verified, status)
VALUES ('$ownerId', 'phase2-$ownerId@invalid.example', true, 'active');
INSERT INTO execution_accounts (
  id, user_id, venue_kind, broker_code, external_account_ref, server,
  label, mode, status, connector_kind, secret_ref
) VALUES (
  '$accountId', '$ownerId', 'metatrader5', 'disposable', 'opaque-fixture',
  'disposable.invalid', 'Phase 2 disposable', 'demo', 'offline', 'windows_vm', '$secretRef'
);
INSERT INTO execution_mt5_vm_accounts (
  user_id, account_id, normalized_server, persistence_mode,
  connection_status, required_protocol_version, required_runtime_version
) VALUES (
  '$ownerId', '$accountId', 'disposable.invalid', 'managed',
  'queued', 1, 'mt5-python-v1'
);
"@
    Invoke-Psql $psqlPath $postgresPort $databaseName $fixtureSql | Out-Null
    $fixtureSql = $null
    $ownerId = $null
    $secretRef = $null

    $adminToken = New-RandomSecret
    $bootstrapToken = New-RandomSecret
    if ($adminToken -eq $bootstrapToken) { throw 'MT5_PHASE2_TOKEN_COLLISION' }
    $bootstrapPath = Join-Path $attemptDir 'bootstrap-token'
    $statePath = Join-Path $attemptDir 'worker-state.json'
    $configPath = Join-Path $attemptDir 'playwright-config.json'
    Write-PrivateText $bootstrapPath $bootstrapToken
    Write-PrivateText $statePath ''
    $eaPort = New-LoopbackPort
    $adminPort = New-LoopbackPort
    if ($eaPort -eq $adminPort) { throw 'MT5_PHASE2_PORT_COLLISION' }
    Write-PrivateText $configPath ([ordered]@{
        accountId = $accountId
        baseURL = "http://127.0.0.1:$adminPort"
        bootstrapTokenFile = $bootstrapPath
        stateFile = $statePath
        workerId = $workerId
      } | ConvertTo-Json -Compress)

    $stage = "ATTEMPT_${attempt}_GATEWAY_ONE"
    $gatewayProcess = Start-Gateway $databaseUrl $eaPort $adminPort $adminToken $bootstrapToken
    Wait-Gateway $gatewayProcess $adminPort
    $stage = "ATTEMPT_${attempt}_PLAYWRIGHT_PRIME"
    Invoke-PlaywrightStage 'prime' $configPath (Join-Path $logDir "playwright-prime-$attempt.log")
    Stop-ExactProcess $gatewayProcess
    $gatewayProcess = $null

    $stage = "ATTEMPT_${attempt}_GATEWAY_TWO"
    $gatewayProcess = Start-Gateway $databaseUrl $eaPort $adminPort $adminToken $bootstrapToken
    Wait-Gateway $gatewayProcess $adminPort
    $stage = "ATTEMPT_${attempt}_PLAYWRIGHT_ROTATE"
    Invoke-PlaywrightStage 'rotate' $configPath (Join-Path $logDir "playwright-rotate-$attempt.log")
    Stop-ExactProcess $gatewayProcess
    $gatewayProcess = $null

    $stage = "ATTEMPT_${attempt}_DATABASE_ASSERT"
    $assertionSql = @"
SELECT json_build_object(
  'schema_version', (SELECT version FROM schema_migrations WHERE dirty = false),
  'worker_session_generation', (SELECT session_generation FROM execution_mt5_vm_workers WHERE worker_id = '$workerId'),
  'lease_generation', (SELECT generation FROM execution_mt5_vm_account_leases WHERE account_id = '$accountId'),
  'active_lease_count', (SELECT count(*) FROM execution_mt5_vm_account_leases WHERE account_id = '$accountId' AND status = 'active'),
  'old_fenced_count', (SELECT count(*) FROM execution_mt5_vm_control_commands WHERE account_id = '$accountId' AND worker_session_generation = 1 AND status = 'fenced'),
  'current_provision_count', (SELECT count(*) FROM execution_mt5_vm_control_commands WHERE account_id = '$accountId' AND worker_session_generation = 2 AND command_kind = 'provision_account')
);
"@
    $databaseEvidence = Invoke-Psql $psqlPath $postgresPort $databaseName $assertionSql |
      ConvertFrom-Json
    $assertionSql = $null
    if ($databaseEvidence.schema_version -ne 41 -or
        $databaseEvidence.worker_session_generation -ne 2 -or
        $databaseEvidence.lease_generation -ne 2 -or
        $databaseEvidence.active_lease_count -ne 1 -or
        $databaseEvidence.old_fenced_count -ne 1 -or
        $databaseEvidence.current_provision_count -ne 1) {
      throw 'MT5_PHASE2_DATABASE_ASSERTION_FAILED'
    }
    $attemptResults.Add([ordered]@{
        attempt = $attempt
        status = 'PASS'
        gateway_processes = 2
        schema_version = [int]$databaseEvidence.schema_version
        worker_session_generation = [int]$databaseEvidence.worker_session_generation
        lease_generation = [int]$databaseEvidence.lease_generation
        active_lease_count = [int]$databaseEvidence.active_lease_count
        old_fenced_count = [int]$databaseEvidence.old_fenced_count
        current_provision_count = [int]$databaseEvidence.current_provision_count
        stale_http_surfaces_rejected = 5
      })
    $databaseEvidence = $null
    $adminToken = $null
    $bootstrapToken = $null
    $workerId = $null
    $accountId = $null
  }
  $status = 'PASS'
} catch {
  $failedStage = $stage
  $failureType = $_.Exception.GetType().FullName
  $failureId = $_.FullyQualifiedErrorId
  $failureLine = $_.InvocationInfo.ScriptLineNumber
  $failure = if ([string]$_.Exception.Message -match '^MT5_[A-Z0-9_]+$') {
    [string]$_.Exception.Message
  } else {
    "MT5_PHASE2_${stage}_FAILED"
  }
  throw $failure
} finally {
  $env:GOCACHE = $priorGoCache
  $adminToken = $null
  $bootstrapToken = $null
  if ($null -ne $gatewayProcess) {
    Stop-ExactProcess $gatewayProcess
    $gatewayProcess = $null
  }
  if ($null -ne $postgresProcess -and -not $postgresProcess.HasExited) {
    Stop-Process -Id $postgresProcess.Id -Force -ErrorAction SilentlyContinue
    $postgresProcess.WaitForExit(5000) | Out-Null
  }
  if ($null -ne $postgresProcess) { $postgresProcess.Dispose() }
  if (Test-Path -LiteralPath $runDir) {
    Assert-UnderRoot $runDir $artifactRoot | Out-Null
    Assert-NotReparse $runDir
    Remove-Item -LiteralPath $runDir -Recurse -Force
  }
  $summary = [ordered]@{
    schema_version = 1
    phase = 'mt5_windows_vm_phase2_operational'
    status = $status
    started_at_utc = $startedAt.ToString('O')
    completed_at_utc = [DateTimeOffset]::UtcNow.ToString('O')
    deterministic_attempts = $attemptResults.Count
    attempts = @($attemptResults)
    postgres_version = '17.11'
    loopback_only = $true
    playwright_trace_disabled_for_secret_headers = $true
    token_files_removed = (-not (Test-Path -LiteralPath $runDir))
    disposable_runtime_removed = (-not (Test-Path -LiteralPath $runDir))
    error_class = $failure
    failed_stage = $failedStage
    diagnostic_type = $failureType
    diagnostic_id = $failureId
    diagnostic_line = $failureLine
  }
  $summary | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $summaryPath -Encoding UTF8
}
