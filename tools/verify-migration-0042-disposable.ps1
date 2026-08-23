<#
.SYNOPSIS
  Exercise migration 0042 on an isolated loopback PostgreSQL 17 cluster.

.DESCRIPTION
  This gate never accepts a database URL and never downloads PostgreSQL. It uses
  an installed PostgreSQL 17 toolchain, creates a uniquely named data directory
  below .artifacts, binds only to 127.0.0.1, and removes that cluster in finally.
  It proves 0042 up/down/up, dirty-state recovery, redaction constraints, active
  fingerprint uniqueness, one-time credential grants, fresh-poll readiness, and
  DELIVERY_OUTCOME_UNKNOWN non-redelivery.

  -NegativeControl deliberately sends invalid SQL through the same fail-closed
  psql wrapper. A trustworthy checker must exit nonzero in that mode.
#>
[CmdletBinding()]
param(
    [string]$PostgresBin = 'C:\Program Files\PostgreSQL\17\bin',
    [switch]$NegativeControl,
    [switch]$RunRustManagedTests
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$backendRoot = Join-Path $repoRoot 'backend'
$sqlRoot = Join-Path $backendRoot 'migrations\testdata\0042'
$artifactRoot = Join-Path $repoRoot '.artifacts\migration-0042'
$runId = ([DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ') + '-' + [guid]::NewGuid().ToString('N'))
$runRoot = Join-Path $artifactRoot ('runtime-' + $runId)
$dataRoot = Join-Path $runRoot 'pgdata'
$logRoot = Join-Path $runRoot 'logs'
$reportPath = Join-Path $artifactRoot ('result-' + $runId + '.json')
$databaseUser = 'migration_0042'
$databaseName = 'postgres'
$script:commandSequence = 0

function Assert-UnderArtifactRoot([string]$Path) {
    $resolved = [System.IO.Path]::GetFullPath($Path)
    $prefix = [System.IO.Path]::GetFullPath($artifactRoot) + [System.IO.Path]::DirectorySeparatorChar
    if (-not $resolved.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing disposable path outside .artifacts: $resolved"
    }
    return $resolved
}

function Assert-NotReparsePoint([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return }
    $item = Get-Item -LiteralPath $Path -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Refusing reparse-point path: $Path"
    }
}

function Get-RequiredExecutable([string]$Name) {
    $candidate = Join-Path $PostgresBin $Name
    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
        throw "PostgreSQL 17 executable is missing: $candidate"
    }
    return (Resolve-Path -LiteralPath $candidate).Path
}

function ConvertTo-NativeArgument([AllowEmptyString()][string]$Argument) {
    if ($Argument.Length -eq 0) { return '""' }
    if ($Argument -notmatch '[\s"]') { return $Argument }

    $builder = [Text.StringBuilder]::new()
    $null = $builder.Append('"')
    $backslashes = 0
    foreach ($character in $Argument.ToCharArray()) {
        if ($character -eq '\') {
            $backslashes++
            continue
        }
        if ($character -eq '"') {
            $null = $builder.Append(('\' * (($backslashes * 2) + 1)))
            $null = $builder.Append('"')
        } else {
            if ($backslashes -gt 0) {
                $null = $builder.Append(('\' * $backslashes))
            }
            $null = $builder.Append($character)
        }
        $backslashes = 0
    }
    if ($backslashes -gt 0) {
        $null = $builder.Append(('\' * ($backslashes * 2)))
    }
    $null = $builder.Append('"')
    return $builder.ToString()
}

function Invoke-NativeCapture(
    [string]$File,
    [string[]]$Arguments,
    [string]$Label,
    [switch]$AllowFailure
) {
    $script:commandSequence++
    $safeLabel = $Label -replace '[^A-Za-z0-9_.-]', '_'
    $logPath = Join-Path $logRoot ('{0:D2}-{1}.log' -f $script:commandSequence, $safeLabel)
    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $File
    $startInfo.WorkingDirectory = (Get-Location).ProviderPath
    $startInfo.Arguments = (($Arguments | ForEach-Object {
        ConvertTo-NativeArgument ([string]$_)
    }) -join ' ')
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    $output = @()
    try {
        if (-not $process.Start()) {
            throw "$Label did not start"
        }
        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(600000)) {
            try { $process.Kill() } catch { }
            throw "$Label exceeded the 600 second native-process timeout"
        }
        $exitCode = $process.ExitCode

        # pg_ctl on Windows launches postgres through a detached cmd.exe which
        # may retain inherited stdout/stderr pipe handles. Wait only for the
        # exact native command; never let a long-lived database child hold this
        # disposable checker open indefinitely.
        $streamDeadline = [DateTime]::UtcNow.AddSeconds(2)
        while ((-not $stdoutTask.IsCompleted -or -not $stderrTask.IsCompleted) -and
               [DateTime]::UtcNow -lt $streamDeadline) {
            Start-Sleep -Milliseconds 20
        }
        if ($stdoutTask.Status -eq [Threading.Tasks.TaskStatus]::RanToCompletion) {
            $output += @($stdoutTask.Result -split "`r?`n" | Where-Object { $_ -ne '' })
        } else {
            try { $process.StandardOutput.Close() } catch { }
        }
        if ($stderrTask.Status -eq [Threading.Tasks.TaskStatus]::RanToCompletion) {
            $output += @($stderrTask.Result -split "`r?`n" | Where-Object { $_ -ne '' })
        } else {
            try { $process.StandardError.Close() } catch { }
        }
    } finally {
        $process.Dispose()
    }
    $output | Set-Content -LiteralPath $logPath -Encoding UTF8
    $result = [pscustomobject]@{
        ExitCode = $exitCode
        Output = $output
        LogPath = $logPath
    }
    if (-not $AllowFailure -and $exitCode -ne 0) {
        $diagnostic = @($output | Select-Object -Last 40) -join "`n"
        if ([string]::IsNullOrWhiteSpace($diagnostic)) {
            $diagnostic = '<no captured output>'
        }
        throw "$Label exited $exitCode; native output:`n$diagnostic`nsee $logPath"
    }
    return $result
}

function Invoke-NativeCaptureWithApplicationControlRetry(
    [string]$File,
    [string[]]$Arguments,
    [string]$Label,
    [switch]$AllowFailure,
    [ValidateRange(0, 20)][int]$ApplicationControlRetries = 20
) {
    $applicationControlPattern =
        'An Application Control policy has blocked this file\.'
    $result = $null
    for ($attempt = 0; $attempt -le $ApplicationControlRetries; $attempt++) {
        $attemptLabel = if ($attempt -eq 0) {
            $Label
        } else {
            '{0}-application-control-retry-{1:D2}' -f $Label, $attempt
        }
        $result = Invoke-NativeCapture $File $Arguments $attemptLabel -AllowFailure
        $joined = $result.Output -join "`n"
        if ($result.ExitCode -eq 0 -or
            $joined -notmatch $applicationControlPattern -or
            $attempt -eq $ApplicationControlRetries) {
            break
        }
        Start-Sleep -Seconds 2
    }
    if ($null -eq $result) {
        throw "$Label retry loop terminated without a native-process result"
    }
    if (-not $AllowFailure -and $result.ExitCode -ne 0) {
        $diagnostic = @($result.Output | Select-Object -Last 40) -join "`n"
        if ([string]::IsNullOrWhiteSpace($diagnostic)) {
            $diagnostic = '<no captured output>'
        }
        throw "$Label exited $($result.ExitCode); native output:`n$diagnostic`nsee $($result.LogPath)"
    }
    return $result
}

function Invoke-Migration([string[]]$Arguments, [string]$Label) {
    $result = Invoke-NativeCaptureWithApplicationControlRetry 'go' `
        (@('run', './cmd/migrate') + $Arguments) $Label
    if ($result.ExitCode -ne 0) { throw "$Label failed unexpectedly" }
}

function Invoke-MigrationExpectedFailure([string[]]$Arguments, [string]$Label) {
    $result = Invoke-NativeCaptureWithApplicationControlRetry 'go' `
        (@('run', './cmd/migrate') + $Arguments) $Label -AllowFailure
    if ($result.ExitCode -eq 0) {
        throw "$Label unexpectedly succeeded; the obstruction checker is fail-open"
    }
    $joined = $result.Output -join "`n"
    if ($joined -notmatch 'worker_substrate' -or $joined -notmatch 'already exists') {
        throw "$Label failed for an unexpected reason; see $($result.LogPath)"
    }
}

function Invoke-Psql([string[]]$Arguments, [string]$Label, [switch]$AllowFailure) {
    $base = @(
        '-X', '--no-psqlrc', '--set=ON_ERROR_STOP=1',
        '--host=127.0.0.1', ('--port=' + $script:postgresPort),
        ('--username=' + $databaseUser), ('--dbname=' + $databaseName)
    )
    return Invoke-NativeCapture $script:psql ($base + $Arguments) $Label -AllowFailure:$AllowFailure
}

function Invoke-SqlFile([string]$Name, [string]$Label) {
    $path = Join-Path $sqlRoot $Name
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Migration assertion file is missing: $path"
    }
    $result = Invoke-Psql @('--file', $path) $Label
    if ($result.ExitCode -ne 0) { throw "$Label failed unexpectedly" }
}

function Invoke-SqlCommand([string]$Sql, [string]$Label) {
    $result = Invoke-Psql @('--command', $Sql) $Label
    if ($result.ExitCode -ne 0) { throw "$Label failed unexpectedly" }
}

function Get-SqlScalar([string]$Sql, [string]$Label) {
    $result = Invoke-Psql @('--quiet', '--tuples-only', '--no-align', '--command', $Sql) $Label
    if ($result.ExitCode -ne 0) { throw "$Label failed unexpectedly" }
    $values = @($result.Output | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' })
    if ($values.Count -ne 1) {
        throw "$Label expected exactly one scalar row, got $($values.Count)"
    }
    return $values[0]
}

function Assert-MigrationVersion([int]$Version, [bool]$Dirty, [string]$Label) {
    $actual = Get-SqlScalar "SELECT version::text || ':' || dirty::text FROM schema_migrations" ($Label + '-read-version')
    $expected = ([string]$Version + ':' + $Dirty.ToString().ToLowerInvariant())
    if ($actual -ne $expected) {
        throw "$Label expected schema_migrations $expected, got $actual"
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

function Remove-DisposableTree([string]$Path) {
    $resolved = Assert-UnderArtifactRoot $Path
    Assert-NotReparsePoint $resolved
    $lastError = $null
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        try {
            Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction Stop
            if (-not (Test-Path -LiteralPath $resolved)) { return }
        } catch {
            $lastError = $_
            Start-Sleep -Milliseconds 250
        }
    }
    throw "Could not remove disposable PostgreSQL root: $resolved; last error: $lastError"
}

$startAttempted = $false
$started = $false
$failure = $null
$startedAt = [DateTime]::UtcNow
$priorDatabaseUrl = [Environment]::GetEnvironmentVariable('DATABASE_URL', 'Process')

try {
    if (Test-Path -LiteralPath $artifactRoot) {
        Assert-NotReparsePoint $artifactRoot
    } else {
        $null = New-Item -ItemType Directory -Path $artifactRoot
    }
    Assert-UnderArtifactRoot $runRoot | Out-Null
    if (Test-Path -LiteralPath $runRoot) {
        throw "Refusing to reuse a disposable runtime root: $runRoot"
    }
    $null = New-Item -ItemType Directory -Path $runRoot
    $null = New-Item -ItemType Directory -Path $logRoot
    $null = New-Item -ItemType Directory -Path $dataRoot
    Assert-NotReparsePoint $runRoot
    Assert-NotReparsePoint $dataRoot

    $script:initdb = Get-RequiredExecutable 'initdb.exe'
    $script:pgCtl = Get-RequiredExecutable 'pg_ctl.exe'
    $script:pgIsReady = Get-RequiredExecutable 'pg_isready.exe'
    $script:postgres = Get-RequiredExecutable 'postgres.exe'
    $script:psql = Get-RequiredExecutable 'psql.exe'

    $version = Invoke-NativeCapture $script:postgres @('--version') 'postgres-version'
    if (($version.Output -join "`n") -notmatch 'PostgreSQL\) 17\.') {
        throw 'The disposable migration gate requires PostgreSQL major version 17.'
    }

    $init = Invoke-NativeCapture $script:initdb @(
        '-D', $dataRoot, '-U', $databaseUser,
        '--auth=trust', '--auth-host=trust', '--auth-local=trust',
        '--no-locale', '--encoding=UTF8'
    ) 'initdb'
    if ($init.ExitCode -ne 0) { throw 'initdb failed unexpectedly' }

    $script:postgresPort = New-LoopbackPort
    $postgresLog = Join-Path $logRoot 'postgres.log'
    $startOptions = "-h 127.0.0.1 -p $($script:postgresPort)"
    $startAttempted = $true
    $start = Invoke-NativeCapture $script:pgCtl @(
        '-D', $dataRoot, '-l', $postgresLog, '-o', $startOptions, '-w', 'start'
    ) 'pg-ctl-start'
    if ($start.ExitCode -ne 0) { throw 'PostgreSQL failed to start' }
    $started = $true

    $ready = Invoke-NativeCapture $script:pgIsReady @(
        '-h', '127.0.0.1', '-p', ([string]$script:postgresPort),
        '-U', $databaseUser, '-d', $databaseName
    ) 'pg-isready'
    if ($ready.ExitCode -ne 0) { throw 'PostgreSQL did not become ready' }

    # This process-local value is always constructed here; no caller-provided or
    # production database URL is accepted by this gate.
    $env:DATABASE_URL = "postgresql://$databaseUser@127.0.0.1:$($script:postgresPort)/${databaseName}?sslmode=disable"
    Push-Location $backendRoot
    try {
        Invoke-Migration @('up', '41') 'migrate-up-41'
        Assert-MigrationVersion 41 $false 'after-up-41'
        Invoke-SqlFile 'seed_pre_up.sql' 'seed-pre-0042'

        Invoke-Migration @('up', '1') 'migrate-up-0042-first'
        Assert-MigrationVersion 42 $false 'after-first-up-0042'
        Invoke-SqlFile 'assert_up.sql' 'assert-first-up-0042'

        if ($NegativeControl) {
            Invoke-SqlCommand "DO `$negative_control`$ BEGIN RAISE EXCEPTION 'KNOWN_BAD_0042_CHECKER_INPUT'; END `$negative_control`$;" 'negative-control-must-fail'
            throw 'Negative control unexpectedly passed; the SQL checker is fail-open.'
        }

        Invoke-Migration @('down', '1') 'migrate-down-0042'
        Assert-MigrationVersion 41 $false 'after-down-0042'
        Invoke-SqlFile 'assert_down.sql' 'assert-down-0042'

        Invoke-Migration @('up', '1') 'migrate-up-0042-second'
        Assert-MigrationVersion 42 $false 'after-second-up-0042'
        Invoke-SqlFile 'assert_up.sql' 'assert-second-up-0042'
        Invoke-SqlFile 'assert_runtime_invariants.sql' 'assert-runtime-invariants'

        # Rehearse a forward-only recovery from a dirty migration. The
        # obstruction exists only in this disposable cluster.
        Invoke-Migration @('down', '1') 'migrate-down-before-obstruction'
        Assert-MigrationVersion 41 $false 'before-obstruction'
        Invoke-SqlCommand 'ALTER TABLE execution_mt5_vm_workers ADD COLUMN worker_substrate integer' 'create-disposable-obstruction'
        Invoke-MigrationExpectedFailure @('up', '1') 'migrate-up-0042-obstructed'
        Assert-MigrationVersion 42 $true 'after-obstructed-up'
        Invoke-SqlCommand 'ALTER TABLE execution_mt5_vm_workers DROP COLUMN worker_substrate' 'remove-disposable-obstruction'
        Invoke-Migration @('force', '41') 'force-disposable-version-41'
        Assert-MigrationVersion 41 $false 'after-force-41'
        Invoke-Migration @('up', '1') 'migrate-up-0042-recovered'
        Assert-MigrationVersion 42 $false 'after-recovered-up-0042'
        Invoke-SqlFile 'assert_up.sql' 'assert-recovered-up-0042'

        if ($RunRustManagedTests) {
            $priorRustDatabaseUrl = [Environment]::GetEnvironmentVariable(
                'MT5_MANAGED_TEST_DATABASE_URL',
                'Process'
            )
            $env:MT5_MANAGED_TEST_DATABASE_URL = $env:DATABASE_URL
            Push-Location (Join-Path $backendRoot 'execution')
            try {
                $rust = Invoke-NativeCaptureWithApplicationControlRetry 'cargo.exe' @(
                    'test', '--locked',
                    '-p', 'execution-gateway', '-p', 'mt5-vm-agent',
                    '--bin', 'execution-gateway',
                    'managed_database', '--', '--ignored', '--test-threads=1'
                ) 'rust-managed-database-tests'
                $rustOutput = $rust.Output -join "`n"
                if ($rust.ExitCode -ne 0 -or
                    $rustOutput -notmatch 'test result: ok\. [1-9][0-9]* passed; 0 failed;') {
                    throw 'Ignored Rust managed-database tests did not execute and pass'
                }
                Write-Host 'RUST_MANAGED_DATABASE_TESTS=PASS'
            } finally {
                Pop-Location
                if ($null -eq $priorRustDatabaseUrl) {
                    Remove-Item Env:MT5_MANAGED_TEST_DATABASE_URL -ErrorAction SilentlyContinue
                } else {
                    $env:MT5_MANAGED_TEST_DATABASE_URL = $priorRustDatabaseUrl
                }
            }
        }
    } finally {
        Pop-Location
    }
} catch {
    $failure = $_
} finally {
    if ($null -eq $priorDatabaseUrl) {
        Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
    } else {
        $env:DATABASE_URL = $priorDatabaseUrl
    }

    if ($started -or $startAttempted) {
        try {
            $stop = Invoke-NativeCapture $script:pgCtl @(
                '-D', $dataRoot, '-m', 'fast', '-w', 'stop'
            ) 'pg-ctl-stop' -AllowFailure
            if ($stop.ExitCode -ne 0 -and $null -eq $failure) {
                throw 'PostgreSQL cleanup stop failed'
            }
        } catch {
            if ($null -eq $failure) { $failure = $_ }
        }
    }

    try {
        if (Test-Path -LiteralPath $runRoot) {
            Remove-DisposableTree $runRoot
        }
    } catch {
        if ($null -eq $failure) { $failure = $_ }
    }

    $status = if ($null -eq $failure) { 'PASS' } else { 'FAIL' }
    [pscustomobject]@{
        gate = 'migration-0042-disposable'
        status = $status
        negative_control = [bool]$NegativeControl
        postgres_major = 17
        started_at_utc = $startedAt.ToString('o')
        completed_at_utc = [DateTime]::UtcNow.ToString('o')
        runtime_removed = -not (Test-Path -LiteralPath $runRoot)
        error = if ($null -eq $failure) { $null } else { $failure.Exception.Message }
    } | ConvertTo-Json | Set-Content -LiteralPath $reportPath -Encoding UTF8
}

if ($null -ne $failure) {
    Write-Error $failure
    exit 1
}

Write-Host 'PASS migration 0042 disposable PostgreSQL up/down/up, recovery, and behavior gate.' -ForegroundColor Green
exit 0
