<#
.SYNOPSIS
  Start the compiled backend locally and prove every API surface answers.

.DESCRIPTION
  Runs the same binaries the CI artifact ships (backend\bin\*.exe) against the
  configuration in backend\.env, then probes the API and asserts the expected
  status for each route. This is the local counterpart to the production health
  gates: it proves the artifact actually serves traffic, not merely that it
  compiled.

  What it deliberately does NOT do:
    * start the MetaTrader 5 terminal or the Python market-data sidecar, because
      both need a licensed Windows MT5 install and broker credentials;
    * touch a production database.

  It starts only the services it can fully verify, and stops everything it
  started before returning.

.PARAMETER KeepRunning
  Leave the services running after the probes so you can poke at them by hand.

.EXAMPLE
  .\tools\verify-backend-local.ps1
#>
[CmdletBinding()]
param(
    [switch]$KeepRunning,
    [int]$ApiPort = 8080,
    [int]$ReadyTimeoutSeconds = 60
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSScriptRoot
$backendDir = Join-Path $repoRoot "backend"
$binDir = Join-Path $backendDir "bin"
$backendEnv = Join-Path $backendDir ".env"
$logDir = Join-Path $repoRoot ".runtime-logs"
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"

Import-Module (Join-Path $PSScriptRoot "lib\MarketLensBackend.psm1") -Force

if (-not (Test-Path -LiteralPath $backendEnv -PathType Leaf)) {
    throw "Missing backend\.env. Create it from backend\.env.example first."
}
foreach ($name in @("api.exe", "execution-gateway.exe")) {
    if (-not (Test-Path -LiteralPath (Join-Path $binDir $name) -PathType Leaf)) {
        throw "Missing backend\bin\$name. Deploy an artifact or build first."
    }
}
New-Item -ItemType Directory -Force $logDir | Out-Null

# The Rust gateway never reads a dotenv file, so mirror the runner and export the
# resolved configuration into this process before starting any child.
$databaseUrl = Get-BackendEnvValue -Name "DATABASE_URL" -EnvFilePath $backendEnv
if ([string]::IsNullOrWhiteSpace($databaseUrl)) { throw "DATABASE_URL is required." }
$adminToken = Get-BackendEnvValue -Name "EXECUTION_ADMIN_TOKEN" -EnvFilePath $backendEnv
if ([string]::IsNullOrWhiteSpace($adminToken) -or $adminToken.Length -lt 32) {
    throw "EXECUTION_ADMIN_TOKEN must be at least 32 characters."
}
$gatewayBind = Get-BackendEnvValue -Name "EXECUTION_GATEWAY_BIND" -EnvFilePath $backendEnv
if (-not $gatewayBind) { $gatewayBind = "127.0.0.1:8790" }
$adminBind = Get-BackendEnvValue -Name "EXECUTION_ADMIN_BIND" -EnvFilePath $backendEnv
if (-not $adminBind) { $adminBind = "127.0.0.1:8791" }
$adminUrl = Get-BackendEnvValue -Name "EXECUTION_ADMIN_URL" -EnvFilePath $backendEnv
if (-not $adminUrl) { $adminUrl = "http://$adminBind" }
$maxConnections = Get-BackendEnvValue -Name "EXECUTION_DATABASE_MAX_CONNECTIONS" -EnvFilePath $backendEnv
if (-not $maxConnections) { $maxConnections = "10" }

$env:DATABASE_URL = $databaseUrl
$env:EXECUTION_ADMIN_TOKEN = $adminToken
$env:EXECUTION_GATEWAY_BIND = $gatewayBind
$env:EXECUTION_ADMIN_BIND = $adminBind
$env:EXECUTION_EA_URL = "http://$gatewayBind"
$env:EXECUTION_ADMIN_URL = $adminUrl
$env:EXECUTION_DATABASE_MAX_CONNECTIONS = $maxConnections

$gatewayPort = Get-BindPort -Bind $gatewayBind -Name "EXECUTION_GATEWAY_BIND"
$adminPort = Get-BindPort -Bind $adminBind -Name "EXECUTION_ADMIN_BIND"

$started = @()

function Start-Service2 {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Exe,
        [Parameter(Mandatory = $true)][string]$WorkingDirectory
    )
    $out = Join-Path $logDir "$Name-$stamp.out.log"
    $err = Join-Path $logDir "$Name-$stamp.err.log"
    Write-Host "  starting $Name..." -ForegroundColor DarkCyan
    $process = Start-Process -FilePath $Exe -WorkingDirectory $WorkingDirectory `
        -RedirectStandardOutput $out -RedirectStandardError $err `
        -WindowStyle Hidden -PassThru
    $script:started += [pscustomobject]@{ Name = $Name; Process = $process; OutLog = $out; ErrLog = $err }
    return $process
}

function Stop-StartedServices {
    foreach ($entry in $script:started) {
        if (-not $entry.Process.HasExited) {
            Stop-Process -Id $entry.Process.Id -Force -ErrorAction SilentlyContinue
            Wait-Process -Id $entry.Process.Id -Timeout 10 -ErrorAction SilentlyContinue
        }
    }
}

function Wait-ForHttp {
    param(
        [Parameter(Mandatory = $true)][string]$Uri,
        [Parameter(Mandatory = $true)][System.Diagnostics.Process]$Process,
        [Parameter(Mandatory = $true)][string]$LogPath,
        [int]$TimeoutSeconds = 60
    )
    for ($i = 0; $i -lt $TimeoutSeconds; $i++) {
        if ($Process.HasExited) {
            $tail = if (Test-Path $LogPath) { (Get-Content $LogPath -Tail 12) -join "`n" } else { "(no log)" }
            throw "$Uri never came up: process exited with $($Process.ExitCode).`n$tail"
        }
        try {
            $null = Invoke-WebRequest -Uri $Uri -TimeoutSec 5 -UseBasicParsing
            return
        } catch {
            $status = $null
            if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
            # Any HTTP status means the listener is up, which is all we wait for.
            if ($status) { return }
        }
        Start-Sleep -Seconds 1
    }
    $tail = if (Test-Path $LogPath) { (Get-Content $LogPath -Tail 12) -join "`n" } else { "(no log)" }
    throw "Timed out waiting for $Uri.`n$tail"
}

$probeResults = @()
function Invoke-Probe {
    <#
    .SYNOPSIS
      Probe one endpoint and record whether the status matched expectations.
    #>
    param(
        [Parameter(Mandatory = $true)][string]$Label,
        [Parameter(Mandatory = $true)][string]$Uri,
        [Parameter(Mandatory = $true)][int[]]$Expect,
        [string]$Method = "GET",
        [hashtable]$Headers
    )
    $status = 0
    $note = ""
    try {
        $params = @{ Uri = $Uri; Method = $Method; TimeoutSec = 15; UseBasicParsing = $true }
        if ($Headers) { $params.Headers = $Headers }
        $response = Invoke-WebRequest @params
        $status = [int]$response.StatusCode
        $body = "$($response.Content)"
        if ($body.Length -gt 90) { $body = $body.Substring(0, 90) + "..." }
        $note = $body
    } catch {
        if ($_.Exception.Response) {
            $status = [int]$_.Exception.Response.StatusCode
            $note = "$($_.Exception.Response.StatusDescription)"
        } else {
            $note = $_.Exception.Message
        }
    }
    $ok = $Expect -contains $status
    $script:probeResults += [pscustomobject]@{
        OK       = $ok
        Status   = $status
        Expected = ($Expect -join '/')
        Endpoint = $Label
        Note     = $note
    }
    $colour = if ($ok) { 'Green' } else { 'Red' }
    Write-Host ("  {0,-4} {1,-3} (want {2,-7}) {3}" -f $(if ($ok) { 'PASS' } else { 'FAIL' }), $status, ($Expect -join '/'), $Label) -ForegroundColor $colour
}

try {
    Write-Host ""
    Write-Host "Starting compiled backend services" -ForegroundColor Cyan
    $gateway = Start-Service2 -Name "execution-gateway" -Exe (Join-Path $binDir "execution-gateway.exe") -WorkingDirectory $backendDir
    $gatewayEntry = $script:started[-1]
    Wait-ForHttp -Uri "$($adminUrl.TrimEnd('/'))/health" -Process $gateway -LogPath $gatewayEntry.ErrLog -TimeoutSeconds $ReadyTimeoutSeconds

    $api = Start-Service2 -Name "backend-api" -Exe (Join-Path $binDir "api.exe") -WorkingDirectory $backendDir
    $apiEntry = $script:started[-1]
    Wait-ForHttp -Uri "http://127.0.0.1:$ApiPort/health" -Process $api -LogPath $apiEntry.ErrLog -TimeoutSeconds $ReadyTimeoutSeconds

    $base = "http://127.0.0.1:$ApiPort"

    # Protected routes and the /execution-ea relay only mount when BOTH a database
    # and a Firebase service account are configured (see docs/HANDOFF.md). Assert
    # the contract that applies to this configuration rather than pretending one
    # mode is the only correct one:
    #   configured   -> anonymous callers get 401
    #   unconfigured -> the surface is absent and must 404, never 5xx
    $firebaseConfigured = $true
    foreach ($key in @("FIREBASE_PROJECT_ID", "FIREBASE_CLIENT_EMAIL", "FIREBASE_PRIVATE_KEY")) {
        if ([string]::IsNullOrWhiteSpace((Get-BackendEnvValue -Name $key -EnvFilePath $backendEnv))) {
            $firebaseConfigured = $false
        }
    }
    $protectedExpect = if ($firebaseConfigured) { @(401) } else { @(404) }
    $relayExpect     = if ($firebaseConfigured) { @(200) } else { @(404) }
    $eaPollExpect    = if ($firebaseConfigured) { @(400, 401, 403) } else { @(404) }
    $mode = if ($firebaseConfigured) { "protected surface MOUNTED (Firebase configured)" }
            else { "protected surface NOT mounted (no Firebase service account) - asserting the documented 404 guard" }

    Write-Host ""
    Write-Host "Probing API surfaces" -ForegroundColor Cyan
    Write-Host "  mode: $mode" -ForegroundColor Yellow

    # Liveness, and DB-backed readiness which only passes with a reachable Postgres.
    Invoke-Probe -Label "GET /health"                        -Uri "$base/health"       -Expect 200
    Invoke-Probe -Label "GET /health/ready (needs Postgres)" -Uri "$base/health/ready" -Expect 200

    # The Rust execution gateway must answer on its own admin listener regardless
    # of Firebase; only the Go relay in front of it is gated.
    Invoke-Probe -Label "GET gateway admin /health (Rust)"   -Uri "$($adminUrl.TrimEnd('/'))/health" -Expect 200
    Invoke-Probe -Label "GET /execution-ea/health (relay)"   -Uri "$base/execution-ea/health" -Expect $relayExpect

    foreach ($route in @("alerts", "drawings", "watchlists", "sync/bootstrap", "execution/accounts", "execution/instruments")) {
        Invoke-Probe -Label "GET /api/v1/$route" -Uri "$base/api/v1/$route" -Expect $protectedExpect
    }

    # An unauthenticated EA poll must never be accepted.
    Invoke-Probe -Label "POST /execution-ea/v1/ea/poll" -Uri "$base/execution-ea/v1/ea/poll" -Method POST -Expect $eaPollExpect

    # Unknown routes must 404 rather than crash.
    Invoke-Probe -Label "GET /api/v1/definitely-not-a-route" -Uri "$base/api/v1/definitely-not-a-route" -Expect @(404)

    # Whatever the mode, nothing may answer 5xx: that would mean broken wiring
    # rather than an enforced boundary.
    $serverErrors = @($probeResults | Where-Object { $_.Status -ge 500 })
    if ($serverErrors.Count -gt 0) {
        throw "$($serverErrors.Count) endpoint(s) returned 5xx: $(($serverErrors | ForEach-Object { $_.Endpoint }) -join '; ')"
    }

    Write-Host ""
    $failed = @($probeResults | Where-Object { -not $_.OK })
    $probeResults | Format-Table -AutoSize OK, Status, Expected, Endpoint | Out-String | Write-Host

    if ($failed.Count -gt 0) {
        Write-Host "$($failed.Count) probe(s) failed." -ForegroundColor Red
        foreach ($entry in $script:started) {
            Write-Host "--- $($entry.Name) stderr tail ---" -ForegroundColor Yellow
            if (Test-Path $entry.ErrLog) { Get-Content $entry.ErrLog -Tail 15 | ForEach-Object { Write-Host "    $_" } }
        }
        throw "Local API verification failed: $($failed.Count) of $($probeResults.Count) probes did not match."
    }

    Write-Host "All $($probeResults.Count) API probes passed." -ForegroundColor Green
    Write-Host "  mode              : $mode"
    Write-Host "  execution-gateway PID $($gateway.Id)  ($gatewayBind EA / $adminBind admin)"
    Write-Host "  backend-api       PID $($api.Id)  (http://127.0.0.1:$ApiPort)"
    Write-Host "  logs: $logDir"
    Write-Host "  note: MT5 terminal and the Python market-data sidecar are not part of this check."
    if (-not $firebaseConfigured) {
        Write-Host "  note: set FIREBASE_PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY in backend\.env to also" -ForegroundColor Yellow
        Write-Host "        verify the protected surface returning 401 instead of 404." -ForegroundColor Yellow
    }
} finally {
    if ($KeepRunning) {
        Write-Host ""
        Write-Host "Leaving services running (-KeepRunning). Stop them with:" -ForegroundColor Yellow
        foreach ($entry in $script:started) {
            Write-Host "  Stop-Process -Id $($entry.Process.Id)   # $($entry.Name)"
        }
    } else {
        Stop-StartedServices
    }
}
exit 0
