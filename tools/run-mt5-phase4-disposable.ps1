<#
.SYNOPSIS
  Download, run, and remove an isolated PostgreSQL instance for the MT5 Phase 4 verifier.

.DESCRIPTION
  Uses the official EDB PostgreSQL 17.11 Windows x64 binary archive without installing a
  Windows service or changing PATH. The cluster listens on a randomly selected loopback port,
  uses trust authentication only for this disposable local run, and is removed in finally.
  No password, URL credential, or production database is accepted.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$artifactRoot = Join-Path $repoRoot '.artifacts'
$runRoot = Join-Path $artifactRoot 'mt5-phase4-disposable-postgres-server-only'
$archivePath = Join-Path $artifactRoot 'postgresql-17.11-windows-x64-binaries.zip'
$installRoot = Join-Path $runRoot 'pgsql'
$dataRoot = Join-Path $runRoot 'pgdata'
$logRoot = Join-Path $runRoot 'logs'
$packageManifest = Join-Path $artifactRoot 'mt5-phase4-postgres-package.json'
$archiveUrl = 'https://get.enterprisedb.com/postgresql/postgresql-17.11-1-windows-x64-binaries.zip'

function Assert-UnderArtifactRoot([string]$path) {
    $resolved = [System.IO.Path]::GetFullPath($path)
    $prefix = [System.IO.Path]::GetFullPath($artifactRoot) + [System.IO.Path]::DirectorySeparatorChar
    if (-not $resolved.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing path outside .artifacts: $resolved"
    }
    return $resolved
}

function Assert-NotReparse([string]$path) {
    if (Test-Path -LiteralPath $path) {
        $item = Get-Item -LiteralPath $path -Force
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Refusing reparse-point path: $path"
        }
    }
}

function Remove-DisposableTree([string]$path) {
    $resolved = Assert-UnderArtifactRoot $path
    Assert-NotReparse $resolved
    $lastError = $null
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        try {
            Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction Stop
            if (-not (Test-Path -LiteralPath $resolved)) { return }
        } catch {
            $lastError = $_
            Start-Sleep -Seconds 1
        }
    }
    throw "Could not remove disposable PostgreSQL tree after 60 attempts: $resolved; last error: $lastError"
}

function Invoke-Native([string]$file, [string[]]$arguments, [string]$logPath) {
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = & $file @arguments 2>&1 | ForEach-Object { $_.ToString() }
        $exit = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previous
    }
    $output | Set-Content -LiteralPath $logPath -Encoding UTF8
    if ($exit -ne 0) { throw "$file exited $exit; see $logPath" }
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

function Wait-Postgres([string]$pgIsReady, [int]$port, [string]$logPath) {
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        $previous = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
            $output = & $pgIsReady '-h' '127.0.0.1' '-p' ([string]$port) '-U' 'mt5_phase4' '-d' 'postgres' 2>&1 |
                ForEach-Object { $_.ToString() }
            $exit = $LASTEXITCODE
        } finally {
            $ErrorActionPreference = $previous
        }
        $output | Set-Content -LiteralPath $logPath -Encoding UTF8
        if ($exit -eq 0) { return }
        Start-Sleep -Seconds 1
    }
    throw "PostgreSQL did not become ready; see $logPath"
}

$postgres = $null
$exitCode = 1
try {
    $null = New-Item -ItemType Directory -Path $artifactRoot -Force
    Assert-UnderArtifactRoot $runRoot | Out-Null
    Assert-NotReparse $artifactRoot
    if (Test-Path -LiteralPath $runRoot) {
        Assert-NotReparse $runRoot
        throw "Run directory already exists; refusing to reuse or delete an unknown disposable instance: $runRoot"
    }
    $null = New-Item -ItemType Directory -Path $runRoot -Force
    $null = New-Item -ItemType Directory -Path $logRoot -Force

    Assert-UnderArtifactRoot $archivePath | Out-Null
    if (-not (Test-Path -LiteralPath $archivePath -PathType Leaf)) {
        Write-Host 'Downloading official EDB PostgreSQL 17.11 Windows x64 binaries...' -ForegroundColor Cyan
        $curl = (Get-Command 'curl.exe' -ErrorAction Stop).Source
        Invoke-Native $curl @('--fail-with-body', '--http1.1', '--tlsv1.2', '--ssl-no-revoke', '--location', '--retry', '3', '--retry-delay', '2', '--output', $archivePath, $archiveUrl) (Join-Path $logRoot 'download.log')
    } else {
        Write-Host 'Reusing the previously downloaded EDB PostgreSQL 17.11 archive.' -ForegroundColor Cyan
    }
    Assert-NotReparse $archivePath
    $hash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash
    $length = (Get-Item -LiteralPath $archivePath).Length
    [pscustomobject]@{
        source = 'EDB PostgreSQL binaries'
        version = '17.11'
        url = $archiveUrl
        sha256 = $hash
        bytes = $length
        downloaded_at_utc = [DateTime]::UtcNow.ToString('o')
    } | ConvertTo-Json | Set-Content -LiteralPath $packageManifest -Encoding UTF8

    Write-Host 'Extracting isolated PostgreSQL binaries...' -ForegroundColor Cyan
    $tar = (Get-Command 'tar.exe' -ErrorAction Stop).Source
    $null = New-Item -ItemType Directory -Path $installRoot -Force
    Invoke-Native $tar @('-xf', $archivePath, '-C', $installRoot, 'pgsql/bin', 'pgsql/lib', 'pgsql/share') (Join-Path $logRoot 'extract.log')
    Assert-NotReparse $installRoot
    $reparseEntries = @(Get-ChildItem -LiteralPath $installRoot -Force -Recurse -ErrorAction Stop |
        Where-Object { ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 })
    if ($reparseEntries.Count -ne 0) { throw 'The PostgreSQL archive contains reparse-point entries.' }
    $initdb = Get-ChildItem -LiteralPath $installRoot -Filter 'initdb.exe' -File -Recurse |
        Select-Object -First 1 -ExpandProperty FullName
    $postgresExe = Get-ChildItem -LiteralPath $installRoot -Filter 'postgres.exe' -File -Recurse |
        Select-Object -First 1 -ExpandProperty FullName
    $pgIsReady = Get-ChildItem -LiteralPath $installRoot -Filter 'pg_isready.exe' -File -Recurse |
        Select-Object -First 1 -ExpandProperty FullName
    if (-not $initdb -or -not $postgresExe -or -not $pgIsReady) {
        throw 'The downloaded archive does not contain initdb.exe, postgres.exe, and pg_isready.exe.'
    }

    Write-Host 'Initializing loopback-only disposable cluster...' -ForegroundColor Cyan
    $null = New-Item -ItemType Directory -Path $dataRoot -Force
    Assert-NotReparse $dataRoot
    Invoke-Native $initdb @('-D', $dataRoot, '-U', 'mt5_phase4', '--auth=trust', '--auth-host=trust', '--auth-local=trust', '--no-locale', '--encoding=UTF8') (Join-Path $logRoot 'initdb.log')

    $port = New-LoopbackPort
    $stdout = Join-Path $logRoot 'postgres.stdout.log'
    $stderr = Join-Path $logRoot 'postgres.stderr.log'
    $postgres = Start-Process -FilePath $postgresExe -ArgumentList @('-D', $dataRoot, '-h', '127.0.0.1', '-p', ([string]$port), '-c', 'listen_addresses=127.0.0.1') -RedirectStandardOutput $stdout -RedirectStandardError $stderr -WindowStyle Hidden -PassThru
    Wait-Postgres $pgIsReady $port (Join-Path $logRoot 'pg_isready.log')

    # No password is used: trust authentication is confined to loopback and this disposable cluster.
    $env:MT5_PHASE4_DATABASE_URL = "postgresql://mt5_phase4@127.0.0.1:$port/postgres?sslmode=disable"
    Write-Host 'Running the complete Phase 0–4 verifier against disposable PostgreSQL...' -ForegroundColor Cyan
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $repoRoot 'tools\verify-mt5-phase4.ps1')
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) { throw "Phase 4 verifier exited $exitCode" }
    Write-Host "PASS disposable PostgreSQL round-trip on loopback port $port" -ForegroundColor Green
    $exitCode = 0
} finally {
    Remove-Item Env:MT5_PHASE4_DATABASE_URL -ErrorAction SilentlyContinue
    if ($postgres -and -not $postgres.HasExited) {
        Stop-Process -Id $postgres.Id -Force -ErrorAction SilentlyContinue
        Wait-Process -Id $postgres.Id -Timeout 10 -ErrorAction SilentlyContinue
    }
    if (Test-Path -LiteralPath $runRoot) {
        Remove-DisposableTree $runRoot
    }
    if ($exitCode -eq 0 -and (Test-Path -LiteralPath $archivePath -PathType Leaf)) {
        Assert-UnderArtifactRoot $archivePath | Out-Null
        Assert-NotReparse $archivePath
        Remove-Item -LiteralPath $archivePath -Force
    }
}

exit $exitCode
