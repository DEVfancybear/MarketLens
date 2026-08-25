[CmdletBinding()]
param(
  [switch]$SkipPull,
  [switch]$SkipBuild,
  [switch]$SkipMigrations,
  [switch]$SkipPublicHealthCheck
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir = Join-Path $repoRoot "backend"
$runtimeLogs = Join-Path $repoRoot ".runtime-logs"
$buildScript = Join-Path $repoRoot "build-production.ps1"
$managedPython = Join-Path $backendDir ".venv-mt5\Scripts\python.exe"
$apiPath = Join-Path $backendDir "bin\api.exe"
$stagedApiPath = Join-Path $backendDir "bin\api.next.exe"
$gatewayPath = Join-Path $backendDir "bin\execution-gateway.exe"
$stagedGatewayPath = Join-Path $backendDir "bin\execution-gateway.next.exe"
$managedWorkerAgentPath = Join-Path $backendDir "execution\target\release\mt5-vm-agent.exe"
$managedWorkerAutoInstallPath = Join-Path $repoRoot "tools\Install-ProductionManagedWorker.ps1"
$backendEnv = Join-Path $backendDir ".env"
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$streamOut = Join-Path $runtimeLogs "mt5-stream-$stamp.out.log"
$streamErr = Join-Path $runtimeLogs "mt5-stream-$stamp.err.log"
$gatewayOut = Join-Path $runtimeLogs "execution-gateway-$stamp.out.log"
$gatewayErr = Join-Path $runtimeLogs "execution-gateway-$stamp.err.log"
$apiOut = Join-Path $runtimeLogs "backend-api-$stamp.out.log"
$apiErr = Join-Path $runtimeLogs "backend-api-$stamp.err.log"

function Get-BackendEnvValue {
  param([Parameter(Mandatory = $true)][string]$Name)

  $processValue = [Environment]::GetEnvironmentVariable($Name)
  if (-not [string]::IsNullOrWhiteSpace($processValue)) {
    return $processValue.Trim()
  }
  if (-not (Test-Path -LiteralPath $backendEnv -PathType Leaf)) { return "" }

  foreach ($line in Get-Content -LiteralPath $backendEnv) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith("#") -or -not $trimmed.Contains("=")) {
      continue
    }
    $parts = $trimmed.Split("=", 2)
    if ($parts[0].Trim() -eq $Name) {
      return $parts[1].Trim().Trim('"').Trim("'")
    }
  }
  return ""
}

function Resolve-ManagedWorkerReceiptFile {
  param(
    [AllowEmptyString()][string]$ReceiptPath,
    [Parameter(Mandatory = $true)][bool]$ArtifactsBuilt
  )

  $installInstruction =
    "Provide a valid receipt or prepare the protected managed-worker install input documented in " +
    "docs\MT5_BAREMETAL_MANAGED_EA_RUNBOOK.md."
  $receiptMissing = [string]::IsNullOrWhiteSpace($ReceiptPath)
  if (-not $receiptMissing -and -not [IO.Path]::IsPathRooted($ReceiptPath)) {
    throw "EXECUTION_MT5_MANAGED_WORKER_RECEIPT_FILE must be an absolute path."
  }

  if (-not $receiptMissing) {
    try {
      $ReceiptPath = [IO.Path]::GetFullPath($ReceiptPath)
      $receiptItem = Get-Item -LiteralPath $ReceiptPath -Force -ErrorAction Stop
    } catch {
      $receiptMissing = $true
    }
  }

  if ($receiptMissing) {
    if ($ArtifactsBuilt) {
      throw "MANAGED_MT5_WORKER_AUTOINSTALL_RESULT_INVALID: Backend artifacts were built and verified but automatic installation did not return a valid receipt. $installInstruction"
    }
    throw "MANAGED_MT5_WORKER_RECEIPT_REQUIRED: A valid managed-worker receipt is required before runtime startup. $installInstruction"
  }

  if ($receiptItem -isnot [IO.FileInfo] -or
      ($receiptItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
      $receiptItem.Length -lt 1 -or
      $receiptItem.Length -gt 65536) {
    throw "EXECUTION_MT5_MANAGED_WORKER_RECEIPT_FILE must name a small non-link regular file."
  }
  return $ReceiptPath
}

function Stop-OwnedListener {
  param(
    [Parameter(Mandatory = $true)][int]$Port,
    [Parameter(Mandatory = $true)][string]$Marker
  )

  $connections = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
  $owners = @($connections | Select-Object -ExpandProperty OwningProcess -Unique)
  foreach ($processId in $owners) {
    $processChain = @()
    $currentProcessId = $processId
    $owned = $false
    for ($depth = 0; $depth -lt 6 -and $currentProcessId -gt 0; $depth++) {
      $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $currentProcessId" -ErrorAction SilentlyContinue
      if ($null -eq $processInfo) { break }
      $processChain += $processInfo
      $identity = "$($processInfo.ExecutablePath) $($processInfo.CommandLine)"
      if ($identity.IndexOf($repoRoot, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
          $identity.IndexOf($Marker, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
        $owned = $true
        break
      }
      if ($processInfo.ParentProcessId -eq $currentProcessId) { break }
      $currentProcessId = $processInfo.ParentProcessId
    }
    if (-not $owned) {
      throw "Refusing to stop PID $processId on port $Port because it is not this repository's $Marker process."
    }
    $chainIds = @($processChain | Select-Object -ExpandProperty ProcessId -Unique)
    Write-Host "Stopping owned listener on port $Port (process chain $($chainIds -join ' -> '))..." -ForegroundColor Yellow
    foreach ($chainProcessId in $chainIds) {
      Stop-Process -Id $chainProcessId -Force -ErrorAction SilentlyContinue
    }
    foreach ($chainProcessId in $chainIds) {
      Wait-Process -Id $chainProcessId -Timeout 10 -ErrorAction SilentlyContinue
    }
  }
}

function Wait-ForPort {
  param(
    [Parameter(Mandatory = $true)][int]$Port,
    [Parameter(Mandatory = $true)][System.Diagnostics.Process]$Process,
    [int]$TimeoutSeconds = 60
  )

  for ($attempt = 0; $attempt -lt $TimeoutSeconds; $attempt++) {
    if ($Process.HasExited) {
      throw "Process PID $($Process.Id) exited before port $Port started listening."
    }
    if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
      return
    }
    Start-Sleep -Seconds 1
  }
  throw "Timed out waiting for port $Port."
}

function Wait-ForJsonEndpoint {
  param(
    [Parameter(Mandatory = $true)][string]$Uri,
    [Parameter(Mandatory = $true)][scriptblock]$Accept,
    [int]$TimeoutSeconds = 45
  )

  $lastFailure = "no response"
  for ($attempt = 0; $attempt -lt $TimeoutSeconds; $attempt++) {
    try {
      $response = Invoke-RestMethod -Uri $Uri -TimeoutSec 5
      if (& $Accept $response) { return $response }
      $lastFailure = "response did not pass readiness criteria"
    } catch {
      $lastFailure = $_.Exception.Message
    }
    Start-Sleep -Seconds 1
  }
  throw "Timed out waiting for $Uri ($lastFailure)."
}

function Get-BindPort {
  param(
    [Parameter(Mandatory = $true)][string]$Bind,
    [Parameter(Mandatory = $true)][string]$Name
  )

  if ($Bind -notmatch ':(\d{1,5})$') {
    throw "$Name must end in a TCP port."
  }
  $port = [int]$Matches[1]
  if ($port -lt 1 -or $port -gt 65535) {
    throw "$Name contains an invalid TCP port."
  }
  return $port
}

if (-not (Test-Path -LiteralPath $backendEnv -PathType Leaf)) {
  throw "Missing backend\.env. Create it from backend\.env.example before running production."
}
New-Item -ItemType Directory -Path $runtimeLogs -Force | Out-Null

$databaseUrl = Get-BackendEnvValue "DATABASE_URL"
$executionAdminToken = Get-BackendEnvValue "EXECUTION_ADMIN_TOKEN"
$executionMt5VmBootstrapToken = Get-BackendEnvValue "EXECUTION_MT5_VM_BOOTSTRAP_TOKEN"
$executionMt5IdentityHmacKeyFile = Get-BackendEnvValue "EXECUTION_MT5_IDENTITY_HMAC_KEY_FILE"
$executionMt5ManagedWorkerReceiptFile = Get-BackendEnvValue "EXECUTION_MT5_MANAGED_WORKER_RECEIPT_FILE"
$executionMt5ManagedWorkerInstallInputFile = Get-BackendEnvValue "EXECUTION_MT5_MANAGED_WORKER_INSTALL_INPUT_FILE"
if ([string]::IsNullOrWhiteSpace($databaseUrl)) {
  throw "DATABASE_URL is required by both the API and durable Rust execution gateway."
}
if ([string]::IsNullOrWhiteSpace($executionAdminToken) -or $executionAdminToken.Length -lt 32) {
  throw "EXECUTION_ADMIN_TOKEN must be an unpredictable secret of at least 32 characters."
}
if (-not [string]::IsNullOrWhiteSpace($executionMt5VmBootstrapToken) -and
    $executionMt5VmBootstrapToken.Length -lt 32) {
  throw "EXECUTION_MT5_VM_BOOTSTRAP_TOKEN must contain at least 32 characters when configured."
}
if (-not [string]::IsNullOrWhiteSpace($executionMt5VmBootstrapToken) -and
    $executionMt5VmBootstrapToken -ceq $executionAdminToken) {
  throw "EXECUTION_MT5_VM_BOOTSTRAP_TOKEN must be distinct from EXECUTION_ADMIN_TOKEN."
}
if ([string]::IsNullOrWhiteSpace($executionMt5IdentityHmacKeyFile) -or
    -not [IO.Path]::IsPathRooted($executionMt5IdentityHmacKeyFile)) {
  throw "EXECUTION_MT5_IDENTITY_HMAC_KEY_FILE must be an absolute path."
}
$executionMt5IdentityHmacKeyFile = [IO.Path]::GetFullPath($executionMt5IdentityHmacKeyFile)
if (-not (Test-Path -LiteralPath $executionMt5IdentityHmacKeyFile -PathType Leaf)) {
  throw "EXECUTION_MT5_IDENTITY_HMAC_KEY_FILE must name a readable regular file."
}
$executionMt5IdentityHmacKeyItem = Get-Item -LiteralPath $executionMt5IdentityHmacKeyFile -Force
if (($executionMt5IdentityHmacKeyItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
    $executionMt5IdentityHmacKeyItem.Length -lt 32 -or
    $executionMt5IdentityHmacKeyItem.Length -gt 4096) {
  throw "EXECUTION_MT5_IDENTITY_HMAC_KEY_FILE must name a small non-link secret file."
}
$executionGatewayBind = Get-BackendEnvValue "EXECUTION_GATEWAY_BIND"
if ([string]::IsNullOrWhiteSpace($executionGatewayBind)) {
  $executionGatewayBind = "127.0.0.1:8790"
}
$executionAdminBind = Get-BackendEnvValue "EXECUTION_ADMIN_BIND"
if ([string]::IsNullOrWhiteSpace($executionAdminBind)) {
  $executionAdminBind = "127.0.0.1:8791"
}
$executionAdminUrl = Get-BackendEnvValue "EXECUTION_ADMIN_URL"
if ([string]::IsNullOrWhiteSpace($executionAdminUrl)) {
  $executionAdminUrl = "http://127.0.0.1:8791"
}
$executionDatabaseConnections = Get-BackendEnvValue "EXECUTION_DATABASE_MAX_CONNECTIONS"
if ([string]::IsNullOrWhiteSpace($executionDatabaseConnections)) {
  $executionDatabaseConnections = "10"
}
$executionGatewayPort = Get-BindPort -Bind $executionGatewayBind -Name "EXECUTION_GATEWAY_BIND"
$executionAdminPort = Get-BindPort -Bind $executionAdminBind -Name "EXECUTION_ADMIN_BIND"

# Export one source of truth to every child process. The Rust service deliberately
# does not read dotenv files by itself.
$env:DATABASE_URL = $databaseUrl
$env:EXECUTION_ADMIN_TOKEN = $executionAdminToken
$env:EXECUTION_MT5_IDENTITY_HMAC_KEY_FILE = $executionMt5IdentityHmacKeyFile
if ([string]::IsNullOrWhiteSpace($executionMt5VmBootstrapToken)) {
  Remove-Item Env:EXECUTION_MT5_VM_BOOTSTRAP_TOKEN -ErrorAction SilentlyContinue
} else {
  $env:EXECUTION_MT5_VM_BOOTSTRAP_TOKEN = $executionMt5VmBootstrapToken
}
$env:EXECUTION_GATEWAY_BIND = $executionGatewayBind
$env:EXECUTION_ADMIN_BIND = $executionAdminBind
$env:EXECUTION_EA_URL = "http://$executionGatewayBind"
$env:EXECUTION_ADMIN_URL = $executionAdminUrl
$env:EXECUTION_DATABASE_MAX_CONNECTIONS = $executionDatabaseConnections

if (-not $SkipPull) {
  Push-Location $repoRoot
  try {
    $dirty = @(& git status --porcelain)
    if ($LASTEXITCODE -ne 0) { throw "git status failed (exit $LASTEXITCODE)." }
    if ($dirty.Count -gt 0) {
      throw "Production worktree is not clean; refusing to pull or deploy."
    }
    Write-Host "Pulling production branch..." -ForegroundColor Cyan
    & git pull --ff-only
    if ($LASTEXITCODE -ne 0) {
      throw "git pull --ff-only failed (exit $LASTEXITCODE)."
    }
  } finally {
    Pop-Location
  }
}

$replaceArtifacts = $false
$managedWorkerArtifactsBuilt = $false
if (-not $SkipBuild) {
  Write-Host "Building staged Go and Rust backend artifacts..." -ForegroundColor Cyan
  & $buildScript -BackendOnly -StageApi
  if (-not (Test-Path -LiteralPath $stagedApiPath -PathType Leaf)) {
    throw "Backend build did not produce backend\bin\api.next.exe."
  }
  if (-not (Test-Path -LiteralPath $stagedGatewayPath -PathType Leaf)) {
    throw "Backend build did not produce backend\bin\execution-gateway.next.exe."
  }
  if (-not (Test-Path -LiteralPath $managedWorkerAgentPath -PathType Leaf)) {
    throw "Backend build did not produce backend\execution\target\release\mt5-vm-agent.exe."
  }
  $replaceArtifacts = $true
  $managedWorkerArtifactsBuilt = $true
} elseif (-not (Test-Path -LiteralPath $apiPath -PathType Leaf) -or
        -not (Test-Path -LiteralPath $gatewayPath -PathType Leaf)) {
  throw "Production Go/Rust artifacts do not exist; rerun without -SkipBuild."
}

$managedWorkerAutoInstallStatus = "existing-receipt"
if ([string]::IsNullOrWhiteSpace($executionMt5ManagedWorkerReceiptFile)) {
  if ($SkipBuild) {
    throw "MANAGED_MT5_WORKER_RECEIPT_REQUIRED: A valid managed-worker receipt is required before runtime startup. Automatic worker installation is disabled in -SkipBuild mode."
  }
  if (-not $managedWorkerArtifactsBuilt) {
    throw "MANAGED_MT5_WORKER_AUTOINSTALL_ARTIFACTS_REQUIRED"
  }
  if (-not (Test-Path -LiteralPath $managedWorkerAutoInstallPath -PathType Leaf)) {
    throw "MANAGED_MT5_WORKER_AUTOINSTALL_HELPER_MISSING"
  }
  if ([string]::IsNullOrWhiteSpace($executionMt5ManagedWorkerInstallInputFile)) {
    $executionMt5ManagedWorkerInstallInputFile = "C:\ProgramData\MarketLens\managed-worker-install-input.json"
  }
  Write-Host "Installing or adopting the prepared managed MT5 worker..." -ForegroundColor Cyan
  try {
    $autoInstallJson = @(& $managedWorkerAutoInstallPath `
      -InstallInputPath $executionMt5ManagedWorkerInstallInputFile `
      -BackendEnvPath $backendEnv `
      -RepoRoot $repoRoot `
      -AgentPath $managedWorkerAgentPath `
      -GatewayUrl $executionAdminUrl `
      -CredentialApiUrl "http://127.0.0.1:8080" `
      -Execute)
    $autoInstall = ($autoInstallJson -join "`n") | ConvertFrom-Json -ErrorAction Stop
  } catch {
    $failureCode = [string]$_.Exception.Message
    if ($failureCode -notmatch '^(?:MANAGED_MT5_WORKER_AUTOINSTALL_|BAREMETAL_)[A-Z0-9_]+$') {
      $failureCode = "MANAGED_MT5_WORKER_AUTOINSTALL_FAILED"
    }
    throw $failureCode
  }
  if ([string]$autoInstall.status -notin @("INSTALLED", "ADOPTED") -or
      [string]::IsNullOrWhiteSpace([string]$autoInstall.receipt_path)) {
    throw "MANAGED_MT5_WORKER_AUTOINSTALL_RESULT_INVALID"
  }
  $managedWorkerAutoInstallStatus = [string]$autoInstall.status
  $executionMt5ManagedWorkerReceiptFile = [string]$autoInstall.receipt_path
  Write-Host "Managed MT5 worker $($managedWorkerAutoInstallStatus.ToLowerInvariant()); continuing the same production run." -ForegroundColor Green
}

$executionMt5ManagedWorkerReceiptFile = Resolve-ManagedWorkerReceiptFile `
  -ReceiptPath $executionMt5ManagedWorkerReceiptFile `
  -ArtifactsBuilt $managedWorkerArtifactsBuilt
$env:EXECUTION_MT5_MANAGED_WORKER_RECEIPT_FILE = $executionMt5ManagedWorkerReceiptFile

if (-not (Test-Path -LiteralPath $managedPython -PathType Leaf)) {
  throw "Managed MT5 market-data Python is missing; rerun without -SkipBuild."
}
& $managedPython -c "import MetaTrader5, websockets"
if ($LASTEXITCODE -ne 0) {
  throw "Managed MT5 market-data Python cannot import MetaTrader5/websockets."
}

if (-not $SkipMigrations) {
  Write-Host "Applying forward-only database migrations..." -ForegroundColor Cyan
  Push-Location $backendDir
  try {
    $env:GOTOOLCHAIN = "auto"
    $env:GOCACHE = Join-Path $repoRoot ".gocache"
    $env:GOTMPDIR = Join-Path $repoRoot ".gotmp"
    New-Item -ItemType Directory -Path $env:GOCACHE, $env:GOTMPDIR -Force | Out-Null
    & go run ./cmd/migrate up
    if ($LASTEXITCODE -ne 0) {
      throw "Database migration failed (exit $LASTEXITCODE)."
    }
    $migrationVersion = @(& go run ./cmd/migrate version 2>&1)
    if ($LASTEXITCODE -ne 0) {
      throw "Migration version check failed (exit $LASTEXITCODE)."
    }
    $migrationVersion | ForEach-Object { Write-Host $_ }
    if (($migrationVersion -join "`n") -match "dirty\s*=\s*true") {
      throw "Database migration state is dirty; refusing to replace running services."
    }
  } finally {
    Pop-Location
  }
}

$terminalPath = Get-BackendEnvValue "MT5_TERMINAL_PATH"
if ([string]::IsNullOrWhiteSpace($terminalPath)) {
  $terminalPath = "C:\Program Files\MetaTrader 5\terminal64.exe"
}
$terminalPath = [System.IO.Path]::GetFullPath($terminalPath).TrimEnd('\')
if (-not (Test-Path -LiteralPath $terminalPath -PathType Leaf)) {
  throw "The market-data MetaTrader 5 terminal was not found at: $terminalPath"
}
$env:MT5_TERMINAL_PATH = $terminalPath
if (-not (Get-Process -Name "terminal64" -ErrorAction SilentlyContinue)) {
  Write-Host "Starting the configured MetaTrader 5 market-data terminal..." -ForegroundColor Cyan
  Start-Process -FilePath $terminalPath `
    -WorkingDirectory (Split-Path -Parent $terminalPath) `
    -WindowStyle Hidden
  Start-Sleep -Seconds 5
}

# This terminal is a read-only market-data source. It does not gate execution,
# demo/live mode, or trading permission; those are reported independently by
# each user's common EA.
$env:MT5_PROBE_TERMINAL_PATH = $terminalPath
$accountProbeJson = & $managedPython -c "import json,os,sys; import MetaTrader5 as mt5; path=os.environ.get('MT5_PROBE_TERMINAL_PATH',''); ok=mt5.initialize(path) if path else mt5.initialize(); info=mt5.account_info() if ok else None; print(json.dumps({'initialized':bool(ok),'login':str(getattr(info,'login','')),'server':str(getattr(info,'server','')),'tradeAllowed':bool(getattr(info,'trade_allowed',False))})); mt5.shutdown(); sys.exit(0 if ok and info is not None else 2)"
if ($LASTEXITCODE -ne 0) {
  throw "MetaTrader 5 market-data terminal is not connected to an account."
}
$accountProbe = $accountProbeJson | ConvertFrom-Json

Stop-OwnedListener -Port 8080 -Marker "bin\api.exe"
Stop-OwnedListener -Port 8765 -Marker "bridge.mt5_stream.mt5_server"
Stop-OwnedListener -Port $executionGatewayPort -Marker "execution-gateway.exe"
Stop-OwnedListener -Port $executionAdminPort -Marker "execution-gateway.exe"

if ($replaceArtifacts) {
  Move-Item -LiteralPath $stagedApiPath -Destination $apiPath -Force
  Move-Item -LiteralPath $stagedGatewayPath -Destination $gatewayPath -Force
}

Write-Host "Starting private MT5 market-data sidecar..." -ForegroundColor Cyan
$streamProcess = Start-Process -FilePath $managedPython `
  -ArgumentList @("-m", "bridge.mt5_stream.mt5_server") `
  -WorkingDirectory $backendDir `
  -RedirectStandardOutput $streamOut `
  -RedirectStandardError $streamErr `
  -WindowStyle Hidden `
  -PassThru
Wait-ForPort -Port 8765 -Process $streamProcess
[System.IO.File]::WriteAllText((Join-Path $runtimeLogs "mt5-stream.pid"), [string]$streamProcess.Id)

Write-Host "Starting production Rust execution gateway..." -ForegroundColor Cyan
$env:RUST_LOG = Get-BackendEnvValue "RUST_LOG"
if ([string]::IsNullOrWhiteSpace($env:RUST_LOG)) {
  $env:RUST_LOG = "execution_gateway=info"
}
$gatewayProcess = Start-Process -FilePath $gatewayPath `
  -WorkingDirectory $backendDir `
  -RedirectStandardOutput $gatewayOut `
  -RedirectStandardError $gatewayErr `
  -WindowStyle Hidden `
  -PassThru
Wait-ForPort -Port $executionGatewayPort -Process $gatewayProcess
Wait-ForPort -Port $executionAdminPort -Process $gatewayProcess
[System.IO.File]::WriteAllText((Join-Path $runtimeLogs "execution-gateway.pid"), [string]$gatewayProcess.Id)
$gatewayHealth = Wait-ForJsonEndpoint -Uri "$($executionAdminUrl.TrimEnd('/'))/health" -Accept {
  param($response)
  $response.ok -eq $true -and $response.service -eq "execution-gateway"
}

$managedWorkerReadinessHelper = Join-Path $repoRoot "tools\mt5-baremetal\Ensure-MT5BareMetalWorkerReady.ps1"
if (-not (Test-Path -LiteralPath $managedWorkerReadinessHelper -PathType Leaf)) {
  throw "Managed MT5 worker readiness helper is missing."
}
Write-Host "Ensuring managed MT5 worker infrastructure is ready..." -ForegroundColor Cyan
. $managedWorkerReadinessHelper
$managedWorkerReadiness = Invoke-MT5BareMetalWorkerReadiness `
  -ReceiptPath $executionMt5ManagedWorkerReceiptFile `
  -AdminUrl $executionAdminUrl `
  -TimeoutSeconds 90
if ($null -eq $managedWorkerReadiness -or -not [bool]$managedWorkerReadiness.ready) {
  throw "MANAGED_MT5_WORKER_READY_INVALID"
}

Write-Host "Starting production Go API..." -ForegroundColor Cyan
$env:APP_ENV = "production"
$apiProcess = Start-Process -FilePath $apiPath `
  -WorkingDirectory $backendDir `
  -RedirectStandardOutput $apiOut `
  -RedirectStandardError $apiErr `
  -WindowStyle Hidden `
  -PassThru
Wait-ForPort -Port 8080 -Process $apiProcess
[System.IO.File]::WriteAllText((Join-Path $runtimeLogs "backend-api.pid"), [string]$apiProcess.Id)

$null = Wait-ForJsonEndpoint -Uri "http://localhost:8080/health" -Accept {
  param($response)
  $response.status -eq "ok"
}
$null = Wait-ForJsonEndpoint -Uri "http://localhost:8080/health/ready" -Accept {
  param($response)
  $response.ready -eq $true -and $response.database -eq "up"
}
$null = Wait-ForJsonEndpoint -Uri "http://localhost:8080/execution-ea/health" -Accept {
  param($response)
  $response.ok -eq $true -and $response.service -eq "execution-ea-relay"
}
$symbols = Wait-ForJsonEndpoint -Uri "http://localhost:8080/api/v1/mt5/symbols" -Accept {
  param($response)
  $response.connected -eq $true
} -TimeoutSeconds 60

if (-not $SkipPublicHealthCheck) {
  $null = Wait-ForJsonEndpoint -Uri "https://api.tradingterminal.io.vn/health/ready" -Accept {
    param($response)
    $response.ready -eq $true -and $response.database -eq "up"
  } -TimeoutSeconds 30
  $null = Wait-ForJsonEndpoint -Uri "https://api.tradingterminal.io.vn/execution-ea/health" -Accept {
    param($response)
    $response.ok -eq $true -and $response.service -eq "execution-ea-relay"
  } -TimeoutSeconds 30
}

Push-Location $repoRoot
try {
  $commit = (& git rev-parse --short HEAD).Trim()
} finally {
  Pop-Location
}
Write-Host "Backend production is ready." -ForegroundColor Green
Write-Host "Commit: $commit"
Write-Host "API PID: $($apiProcess.Id) | http://localhost:8080"
Write-Host "Execution PID: $($gatewayProcess.Id) | EA $executionGatewayBind | admin $executionAdminBind"
Write-Host "Execution accounts connected: $($gatewayHealth.connectedAccounts)"
Write-Host "Managed MT5 worker: $($managedWorkerReadiness.worker_id) | capacity=$($managedWorkerReadiness.capacity) | activeLeases=$($managedWorkerReadiness.active_leases) | taskStarted=$($managedWorkerReadiness.task_started)"
Write-Host "MT5 stream PID: $($streamProcess.Id) | ws://localhost:8765"
Write-Host "MT5 symbols connected: $($symbols.connected)"
Write-Host "Market-data account: $($accountProbe.login) | $($accountProbe.server) | tradeAllowed=$($accountProbe.tradeAllowed)"
Write-Host "Managed Python: $managedPython"
Write-Host "API log: $apiErr"
Write-Host "Execution log: $gatewayErr"
Write-Host "MT5 stream log: $streamErr"
