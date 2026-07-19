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
$backendEnv = Join-Path $backendDir ".env"
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$bridgeOut = Join-Path $runtimeLogs "mt5-stream-$stamp.out.log"
$bridgeErr = Join-Path $runtimeLogs "mt5-stream-$stamp.err.log"
$apiOut = Join-Path $runtimeLogs "backend-api-$stamp.out.log"
$apiErr = Join-Path $runtimeLogs "backend-api-$stamp.err.log"

function Get-BackendEnvValue {
  param([Parameter(Mandatory = $true)][string]$Name)

  $processValue = [Environment]::GetEnvironmentVariable($Name)
  if (-not [string]::IsNullOrWhiteSpace($processValue)) { return $processValue.Trim() }
  if (-not (Test-Path -LiteralPath $backendEnv -PathType Leaf)) { return "" }

  foreach ($line in Get-Content -LiteralPath $backendEnv) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith("#") -or -not $trimmed.Contains("=")) { continue }
    $parts = $trimmed.Split("=", 2)
    if ($parts[0].Trim() -eq $Name) {
      return $parts[1].Trim().Trim('"').Trim("'")
    }
  }
  return ""
}

function Test-Truthy {
  param([string]$Value)
  return @("1", "true", "yes", "on") -contains $Value.Trim().ToLowerInvariant()
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
    if ($Process.HasExited) { throw "Process PID $($Process.Id) exited before port $Port started listening." }
    if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) { return }
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

if (-not (Test-Path -LiteralPath $backendEnv -PathType Leaf)) {
  throw "Missing backend\.env. Create it from backend\.env.example before running production."
}
New-Item -ItemType Directory -Path $runtimeLogs -Force | Out-Null

if (-not $SkipPull) {
  Push-Location $repoRoot
  try {
    $dirty = @(& git status --porcelain)
    if ($LASTEXITCODE -ne 0) { throw "git status failed (exit $LASTEXITCODE)." }
    if ($dirty.Count -gt 0) { throw "Production worktree is not clean; refusing to pull or deploy." }
    Write-Host "Pulling production branch..." -ForegroundColor Cyan
    & git pull --ff-only
    if ($LASTEXITCODE -ne 0) { throw "git pull --ff-only failed (exit $LASTEXITCODE)." }
  } finally {
    Pop-Location
  }
}

$replaceApi = $false
if (-not $SkipBuild) {
  Write-Host "Building staged backend production artifact and MT5 runtime..." -ForegroundColor Cyan
  & $buildScript -BackendOnly -StageApi
  if (-not (Test-Path -LiteralPath $stagedApiPath -PathType Leaf)) {
    throw "Backend build did not produce backend\bin\api.next.exe."
  }
  $replaceApi = $true
} elseif (-not (Test-Path -LiteralPath $apiPath -PathType Leaf)) {
  throw "backend\bin\api.exe does not exist; rerun without -SkipBuild."
}

if (-not (Test-Path -LiteralPath $managedPython -PathType Leaf)) {
  throw "Managed MT5 Python is missing; rerun without -SkipBuild."
}
& $managedPython -c "import MetaTrader5, websockets"
if ($LASTEXITCODE -ne 0) { throw "Managed MT5 Python cannot import MetaTrader5/websockets." }

if (-not $SkipMigrations) {
  Write-Host "Applying forward-only database migrations..." -ForegroundColor Cyan
  Push-Location $backendDir
  try {
    $env:GOTOOLCHAIN = "local"
    & go run ./cmd/migrate up
    if ($LASTEXITCODE -ne 0) { throw "Database migration failed (exit $LASTEXITCODE)." }
    $migrationVersion = @(& go run ./cmd/migrate version 2>&1)
    if ($LASTEXITCODE -ne 0) { throw "Migration version check failed (exit $LASTEXITCODE)." }
    $migrationVersion | ForEach-Object { Write-Host $_ }
    if (($migrationVersion -join "`n") -match "dirty\s*=\s*true") {
      throw "Database migration state is dirty; refusing to replace the running API."
    }
  } finally {
    Pop-Location
  }
}

$terminalPath = Get-BackendEnvValue "MT5_TERMINAL_PATH"
if ([string]::IsNullOrWhiteSpace($terminalPath)) {
  $terminalPath = "C:\Program Files\MetaTrader 5\terminal64.exe"
}
if (-not (Get-Process -Name "terminal64" -ErrorAction SilentlyContinue)) {
  if (-not (Test-Path -LiteralPath $terminalPath -PathType Leaf)) {
    throw "MetaTrader 5 is not running and terminal64.exe was not found at: $terminalPath"
  }
  Write-Host "Starting MetaTrader 5; it must already have the intended FTMO account saved..." -ForegroundColor Cyan
  Start-Process -FilePath $terminalPath -WorkingDirectory (Split-Path -Parent $terminalPath)
  Start-Sleep -Seconds 5
}

$env:MT5_PROBE_TERMINAL_PATH = $terminalPath
$accountProbeJson = & $managedPython -c "import json,os,sys; import MetaTrader5 as mt5; path=os.environ.get('MT5_PROBE_TERMINAL_PATH',''); ok=mt5.initialize(path=path) if path else mt5.initialize(); info=mt5.account_info() if ok else None; print(json.dumps({'initialized':bool(ok),'login':str(getattr(info,'login','')),'server':str(getattr(info,'server','')),'tradeAllowed':bool(getattr(info,'trade_allowed',False))})); mt5.shutdown(); sys.exit(0 if ok and info is not None and bool(getattr(info,'trade_allowed',False)) else 2)"
if ($LASTEXITCODE -ne 0) {
  throw "MetaTrader 5 is not connected to a trade-enabled account. Open MT5, log in with the master password, and rerun."
}
$accountProbe = $accountProbeJson | ConvertFrom-Json

Stop-OwnedListener -Port 8080 -Marker "bin\api.exe"
Stop-OwnedListener -Port 8765 -Marker "bridge.mt5_stream.mt5_server"

if ($replaceApi) {
  Move-Item -LiteralPath $stagedApiPath -Destination $apiPath -Force
}

Write-Host "Starting private MT5 market-data sidecar..." -ForegroundColor Cyan
$bridgeProcess = Start-Process -FilePath $managedPython `
  -ArgumentList @("-m", "bridge.mt5_stream.mt5_server") `
  -WorkingDirectory $backendDir `
  -RedirectStandardOutput $bridgeOut `
  -RedirectStandardError $bridgeErr `
  -WindowStyle Hidden `
  -PassThru
Wait-ForPort -Port 8765 -Process $bridgeProcess
[System.IO.File]::WriteAllText((Join-Path $runtimeLogs "mt5-stream.pid"), [string]$bridgeProcess.Id)

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

$null = Wait-ForJsonEndpoint -Uri "http://localhost:8080/health" -Accept { param($r) $r.status -eq "ok" }
$null = Wait-ForJsonEndpoint -Uri "http://localhost:8080/health/ready" -Accept { param($r) $r.ready -eq $true -and $r.database -eq "up" }
$symbols = Wait-ForJsonEndpoint -Uri "http://localhost:8080/api/v1/mt5/symbols" -Accept { param($r) $r.connected -eq $true } -TimeoutSeconds 60

$apiLogText = ""
foreach ($path in @($apiOut, $apiErr)) {
  if (Test-Path -LiteralPath $path -PathType Leaf) { $apiLogText += [System.IO.File]::ReadAllText($path) }
}
if ($apiLogText -notmatch "MT5 verifier runtime ready") {
  throw "API started, but its logs do not confirm a ready MT5 verifier runtime. See $apiErr"
}

if (-not $SkipPublicHealthCheck) {
  $null = Wait-ForJsonEndpoint -Uri "https://api.tradingterminal.io.vn/health/ready" -Accept { param($r) $r.ready -eq $true -and $r.database -eq "up" } -TimeoutSeconds 30
}

Push-Location $repoRoot
try { $commit = (& git rev-parse --short HEAD).Trim() } finally { Pop-Location }
Write-Host "Backend production is ready." -ForegroundColor Green
Write-Host "Commit: $commit"
Write-Host "API PID: $($apiProcess.Id) | http://localhost:8080"
Write-Host "MT5 stream PID: $($bridgeProcess.Id) | ws://localhost:8765"
Write-Host "MT5 symbols connected: $($symbols.connected)"
Write-Host "MT5 account: $($accountProbe.login) | $($accountProbe.server) | tradeAllowed=$($accountProbe.tradeAllowed)"
Write-Host "Managed Python: $managedPython"
Write-Host "API log: $apiErr"
Write-Host "MT5 stream log: $bridgeErr"

$executionEnabled = Get-BackendEnvValue "FTMO_MT5_ENABLED"
if (Test-Truthy $executionEnabled) {
  Write-Warning "FTMO execution bridge 8787 is enabled but intentionally not started here; it belongs on the browser/account host, not the multi-user backend."
}
