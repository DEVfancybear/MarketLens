<#
.SYNOPSIS
  Run the complete Revision 15 bare-metal managed MT5 + EA gauntlet.

.DESCRIPTION
  This is the single rerunnable synthetic/disposable verification entry point.
  It removes only its exact report root, runs every local layer even after a
  failure, persists one log per layer, and writes summary.json last.

  The credentialed three-demo-account R15-9 gate requires separate runtime
  confirmation under the approved SPEC. The no-argument local gauntlet records
  that gate as UNVERIFIED_ALLOWED and performs no production or broker action.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$artifactRoot = Join-Path $repoRoot '.artifacts\mt5-baremetal-managed-ea'
$logRoot = Join-Path $artifactRoot 'logs'
$summaryPath = Join-Path $artifactRoot 'summary.json'
$sourceStatePath = Join-Path $artifactRoot 'source-state.json'
$coverageChecker = Join-Path $repoRoot 'tools\mt5-baremetal\changed_line_coverage.py'
$goDiffPath = Join-Path $artifactRoot 'go-changed.diff'
$rustDiffPath = Join-Path $artifactRoot 'rust-changed.diff'
$goCoveragePath = Join-Path $artifactRoot 'go-cover.out'
$rustCoveragePath = Join-Path $artifactRoot 'rust-cover.lcov'
$rustProfilePath = Join-Path $artifactRoot 'rust-cover.profdata'
$rustProfileRoot = Join-Path $artifactRoot 'rust-profraw'
$rustAgentTargetRoot = Join-Path $artifactRoot 'rust-agent-target'
$rustToolchain = 'stable-x86_64-pc-windows-msvc'
$startedAt = [DateTime]::UtcNow
$script:sequence = 0
$script:results = [Collections.Generic.List[object]]::new()
$utf8 = [Text.UTF8Encoding]::new($false)

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
            if ($backslashes -gt 0) { $null = $builder.Append(('\' * $backslashes)) }
            $null = $builder.Append($character)
        }
        $backslashes = 0
    }
    if ($backslashes -gt 0) { $null = $builder.Append(('\' * ($backslashes * 2))) }
    $null = $builder.Append('"')
    return $builder.ToString()
}

function Assert-ExactArtifactRoot {
    $expected = [IO.Path]::GetFullPath((Join-Path $repoRoot '.artifacts\mt5-baremetal-managed-ea'))
    $actual = [IO.Path]::GetFullPath($artifactRoot)
    $repoPrefix = [IO.Path]::GetFullPath($repoRoot) + [IO.Path]::DirectorySeparatorChar
    if (-not $actual.Equals($expected, [StringComparison]::OrdinalIgnoreCase) -or
        -not $actual.StartsWith($repoPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing report cleanup outside the exact repository artifact root: $actual"
    }
    if (Test-Path -LiteralPath $actual) {
        $item = Get-Item -LiteralPath $actual -Force
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Refusing to clean a reparse-point report root: $actual"
        }
    }
    return $actual
}

function Test-TransientWindowsFileSystemException([Exception]$Exception) {
    while ($null -ne $Exception) {
        $win32Code = $Exception.HResult -band 0xFFFF
        if ($win32Code -in @(32, 33, 1224)) { return $true }
        $Exception = $Exception.InnerException
    }
    return $false
}

function Remove-ReportRootWithTransientWindowsRetry([string]$Path) {
    for ($attempt = 1; $attempt -le 20; $attempt++) {
        try {
            Remove-Item -LiteralPath $Path -Recurse -Force
            return
        } catch {
            if ($attempt -eq 20 -or
                -not (Test-TransientWindowsFileSystemException $_.Exception)) {
                throw
            }
            Start-Sleep -Milliseconds 100
        }
    }
}

function New-ReportRoot {
    $resolved = Assert-ExactArtifactRoot
    if (Test-Path -LiteralPath $resolved) {
        Remove-ReportRootWithTransientWindowsRetry $resolved
    }
    $null = New-Item -ItemType Directory -Path $logRoot
}

function Get-SafeLogPath([string]$Name) {
    $script:sequence++
    $safeName = $Name -replace '[^A-Za-z0-9_.-]', '_'
    return Join-Path $logRoot ('{0:D2}-{1}.log' -f $script:sequence, $safeName)
}

function Get-RepoRelativePath([string]$Path) {
    $root = [IO.Path]::GetFullPath($repoRoot).TrimEnd([char[]]@(
        [IO.Path]::DirectorySeparatorChar,
        [IO.Path]::AltDirectorySeparatorChar
    ))
    $resolved = [IO.Path]::GetFullPath($Path)
    $prefix = $root + [IO.Path]::DirectorySeparatorChar
    if (-not $resolved.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Path is outside the repository: $resolved"
    }
    return $resolved.Substring($prefix.Length)
}

function Add-LayerResult(
    [string]$Name,
    [string]$Status,
    [int]$ExitCode,
    [double]$DurationSeconds,
    [string]$Command,
    [string]$LogPath,
    [AllowNull()][string]$Note
) {
    $script:results.Add([pscustomobject][ordered]@{
        name = $Name
        status = $Status
        exit_code = $ExitCode
        duration_seconds = [Math]::Round($DurationSeconds, 3)
        command = $Command
        log = if ([string]::IsNullOrWhiteSpace($LogPath)) {
            $null
        } else {
            Get-RepoRelativePath $LogPath
        }
        note = $Note
    })
    Write-Output ("LAYER={0} STATUS={1} EXIT={2}" -f $Name, $Status, $ExitCode)
}

function Invoke-CapturedProcess(
    [string]$File,
    [string[]]$Arguments,
    [string]$WorkingDirectory,
    [int]$TimeoutSeconds,
    [Collections.IDictionary]$EnvironmentVariables = @{}
) {
    $command = Get-Command $File -ErrorAction Stop
    $startInfo = [Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $command.Source
    $startInfo.WorkingDirectory = (Resolve-Path -LiteralPath $WorkingDirectory).Path
    $startInfo.Arguments = (($Arguments | ForEach-Object {
        ConvertTo-NativeArgument ([string]$_)
    }) -join ' ')
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.EnvironmentVariables['NO_COLOR'] = '1'
    $startInfo.EnvironmentVariables['CARGO_TERM_COLOR'] = 'never'
    $startInfo.EnvironmentVariables['PYTHONUTF8'] = '1'
    $startInfo.EnvironmentVariables['PYTHONIOENCODING'] = 'utf-8'
    foreach ($entry in $EnvironmentVariables.GetEnumerator()) {
        $key = [string]$entry.Key
        if ($null -eq $entry.Value) {
            $startInfo.EnvironmentVariables.Remove($key)
        } else {
            $startInfo.EnvironmentVariables[$key] = [string]$entry.Value
        }
    }

    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    try {
        if (-not $process.Start()) { throw "$File did not start" }
        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit([Math]::Max(1, $TimeoutSeconds) * 1000)) {
            try { $process.Kill($true) } catch { try { $process.Kill() } catch { } }
            throw "$File exceeded the $TimeoutSeconds second timeout"
        }
        $process.WaitForExit()

        $deadline = [DateTime]::UtcNow.AddSeconds(5)
        while ((-not $stdoutTask.IsCompleted -or -not $stderrTask.IsCompleted) -and
               [DateTime]::UtcNow -lt $deadline) {
            Start-Sleep -Milliseconds 20
        }
        $stdout = if ($stdoutTask.Status -eq [Threading.Tasks.TaskStatus]::RanToCompletion) {
            $stdoutTask.Result
        } else {
            try { $process.StandardOutput.Close() } catch { }
            '<stdout remained open after process exit>'
        }
        $stderr = if ($stderrTask.Status -eq [Threading.Tasks.TaskStatus]::RanToCompletion) {
            $stderrTask.Result
        } else {
            try { $process.StandardError.Close() } catch { }
            '<stderr remained open after process exit>'
        }
        return [pscustomobject]@{
            ExitCode = $process.ExitCode
            Stdout = $stdout
            Stderr = $stderr
            Output = (($stdout.TrimEnd(), $stderr.TrimEnd()) | Where-Object { $_ -ne '' }) -join "`n"
            Command = (($File, $Arguments) -join ' ')
        }
    } finally {
        $process.Dispose()
    }
}

function Invoke-CapturedProcessWithApplicationControlRetry(
    [string]$File,
    [string[]]$Arguments,
    [string]$WorkingDirectory,
    [int]$TimeoutSeconds,
    [Collections.IDictionary]$EnvironmentVariables = @{},
    [ValidateRange(0, 20)][int]$ApplicationControlRetries = 0
) {
    $applicationControlPattern =
        '(?s)An Application Control policy has blocked this file\..*?\(os error 4551\)'
    $attemptLogs = [Collections.Generic.List[string]]::new()
    $captured = $null
    for ($attempt = 0; $attempt -le $ApplicationControlRetries; $attempt++) {
        $captured = Invoke-CapturedProcess $File $Arguments $WorkingDirectory `
            $TimeoutSeconds $EnvironmentVariables
        if ($attempt -eq 0 -and
            ($captured.ExitCode -eq 0 -or
             $captured.Output -notmatch $applicationControlPattern)) {
            return $captured
        }
        $attemptLogs.Add((
            "application_control_attempt={0}/{1} exit={2}`n{3}" -f `
                ($attempt + 1), ($ApplicationControlRetries + 1),
                $captured.ExitCode, $captured.Output
        ))
        if ($captured.ExitCode -eq 0 -or
            $captured.Output -notmatch $applicationControlPattern -or
            $attempt -eq $ApplicationControlRetries) {
            return [pscustomobject]@{
                ExitCode = $captured.ExitCode
                Stdout = $captured.Stdout
                Stderr = $captured.Stderr
                Output = $attemptLogs -join "`n"
                Command = $captured.Command
                ApplicationControlRetries = $attempt
            }
        }
        Start-Sleep -Seconds 2
    }
    throw 'application-control retry loop terminated without a captured process result'
}

function Invoke-GitLines([string[]]$Arguments) {
    $captured = Invoke-CapturedProcess 'git.exe' `
        (@('-c', 'core.safecrlf=false') + $Arguments) $repoRoot 120
    if ($captured.ExitCode -ne 0) {
        throw "git command failed: $($captured.Stderr.Trim())"
    }
    if ([string]::IsNullOrWhiteSpace($captured.Stdout)) { return @() }
    return @($captured.Stdout -split "`r?`n" | Where-Object { $_ -ne '' })
}

function Invoke-NativeLayer(
    [string]$Name,
    [string]$File,
    [string[]]$Arguments,
    [string]$WorkingDirectory,
    [int]$TimeoutSeconds = 600,
    [AllowEmptyString()][string]$RequiredPattern = '',
    [AllowEmptyString()][string]$RejectedPattern = '',
    [switch]$RequireEmptyOutput,
    [Collections.IDictionary]$EnvironmentVariables = @{},
    [ValidateRange(0, 20)][int]$ApplicationControlRetries = 0
) {
    Write-Output "START_LAYER=$Name"
    $watch = [Diagnostics.Stopwatch]::StartNew()
    $logPath = Get-SafeLogPath $Name
    $captured = $null
    $failure = $null
    try {
        $captured = Invoke-CapturedProcessWithApplicationControlRetry `
            $File $Arguments $WorkingDirectory $TimeoutSeconds `
            $EnvironmentVariables $ApplicationControlRetries
        if ($captured.ExitCode -ne 0) {
            $failure = "command exited $($captured.ExitCode)"
        } elseif ($RequiredPattern -and $captured.Output -notmatch $RequiredPattern) {
            $failure = "required success marker was absent: $RequiredPattern"
        } elseif ($RejectedPattern -and $captured.Output -match $RejectedPattern) {
            $failure = "rejected output was observed: $RejectedPattern"
        } elseif ($RequireEmptyOutput -and -not [string]::IsNullOrWhiteSpace($captured.Output)) {
            $failure = 'command produced output but an empty result was required'
        }
    } catch {
        $failure = $_.Exception.Message
    } finally {
        $watch.Stop()
    }

    $exitCode = if ($null -eq $captured) { -1 } else { [int]$captured.ExitCode }
    $output = @(
        "layer=$Name"
        "failure=$failure"
        if ($null -ne $captured) { $captured.Output }
    ) -join "`n"
    [IO.File]::WriteAllText($logPath, $output, $utf8)
    $commandText = if ($null -eq $captured) {
        (($File, $Arguments) -join ' ')
    } else {
        $captured.Command
    }
    Add-LayerResult $Name $(if ($null -eq $failure) { 'PASS' } else { 'FAIL' }) `
        $exitCode $watch.Elapsed.TotalSeconds $commandText $logPath $failure
}

function Invoke-ExpectedFailureLayer(
    [string]$Name,
    [string]$File,
    [string[]]$Arguments,
    [string]$WorkingDirectory,
    [string]$ExpectedPattern,
    [int]$TimeoutSeconds = 600
) {
    Write-Output "START_LAYER=$Name"
    $watch = [Diagnostics.Stopwatch]::StartNew()
    $logPath = Get-SafeLogPath $Name
    $captured = $null
    $failure = $null
    try {
        $captured = Invoke-CapturedProcess $File $Arguments $WorkingDirectory $TimeoutSeconds
        if ($captured.ExitCode -eq 0) {
            $failure = 'negative control unexpectedly succeeded'
        } elseif ($captured.Output -notmatch $ExpectedPattern) {
            $failure = "negative control failed for an unexpected reason; missing: $ExpectedPattern"
        }
    } catch {
        $failure = $_.Exception.Message
    } finally {
        $watch.Stop()
    }

    $exitCode = if ($null -eq $captured) { -1 } else { [int]$captured.ExitCode }
    $output = @(
        "layer=$Name"
        "failure=$failure"
        if ($null -ne $captured) { $captured.Output }
    ) -join "`n"
    [IO.File]::WriteAllText($logPath, $output, $utf8)
    $commandText = if ($null -eq $captured) {
        (($File, $Arguments) -join ' ')
    } else {
        $captured.Command
    }
    Add-LayerResult $Name $(if ($null -eq $failure) { 'PASS' } else { 'FAIL' }) `
        $exitCode $watch.Elapsed.TotalSeconds $commandText $logPath $failure
}

function Invoke-InProcessLayer([string]$Name, [scriptblock]$Action, [string]$Command) {
    Write-Output "START_LAYER=$Name"
    $watch = [Diagnostics.Stopwatch]::StartNew()
    $logPath = Get-SafeLogPath $Name
    $failure = $null
    $output = @()
    try {
        $output = @(& $Action 2>&1 | ForEach-Object { $_.ToString() })
    } catch {
        $failure = $_.Exception.Message
        $output += $_.ScriptStackTrace
    } finally {
        $watch.Stop()
    }
    [IO.File]::WriteAllText(
        $logPath,
        (@("layer=$Name", "failure=$failure") + $output) -join "`n",
        $utf8
    )
    Add-LayerResult $Name $(if ($null -eq $failure) { 'PASS' } else { 'FAIL' }) `
        $(if ($null -eq $failure) { 0 } else { 1 }) $watch.Elapsed.TotalSeconds `
        $Command $logPath $failure
}

function Add-AllowedUnverified([string]$Name, [string]$Reason) {
    $logPath = Get-SafeLogPath $Name
    [IO.File]::WriteAllText($logPath, "status=UNVERIFIED_ALLOWED`nreason=$Reason", $utf8)
    Add-LayerResult $Name 'UNVERIFIED_ALLOWED' 0 0.0 'not executed' $logPath $Reason
}

function Get-AddedTaskText {
    $trackedDiff = @(Invoke-GitLines @('diff', '--no-ext-diff', '--unified=0', '--', '.'))
    $added = @($trackedDiff | Where-Object {
        $_.StartsWith('+', [StringComparison]::Ordinal) -and
        -not $_.StartsWith('+++', [StringComparison]::Ordinal)
    } | ForEach-Object { $_.Substring(1) })

    $untracked = @(Invoke-GitLines @('ls-files', '--others', '--exclude-standard'))
    foreach ($relative in $untracked) {
        $normalized = $relative.Replace('\', '/')
        if ($normalized.StartsWith('.artifacts/', [StringComparison]::OrdinalIgnoreCase)) { continue }
        if ([IO.Path]::GetExtension($relative) -notin @(
            '.go', '.rs', '.py', '.ps1', '.sql', '.ts', '.tsx', '.toml', '.json', '.md',
            '.example', '.yml'
        )) { continue }
        $path = Join-Path $repoRoot $relative
        if ((Get-Item -LiteralPath $path).Length -gt 2MB) { continue }
        $added += [IO.File]::ReadAllLines($path, $utf8)
    }
    return $added -join "`n"
}

function Remove-ApprovedCredentialPlaceholders([string]$Text) {
    $approved = @(
        ('postgres://' + 'user' + ':' + 'pass' + '@localhost:5432/marketlens?sslmode=disable'),
        ('postgres://' + 'user' + ':' + 'pass' + '@localhost:5432/smc?sslmode=disable')
    )
    foreach ($placeholder in $approved) {
        $Text = $Text.Replace($placeholder, 'postgres://placeholder@localhost')
    }
    return $Text
}

function Get-SecretPatternHits([string]$Text) {
    $patterns = [ordered]@{
        private_key = '-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'
        github_token = '\bgh[pousr]_[A-Za-z0-9]{30,}\b'
        aws_access_key = '\b(?:AKIA|ASIA)[A-Z0-9]{16}\b'
        vault_token = '\bhvs\.[A-Za-z0-9_-]{20,}\b'
        jwt = '\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b'
        credential_url = '\b(?:postgres(?:ql)?|https?)://[^\s/:]+:[^\s/@]+@'
    }
    return @($patterns.GetEnumerator() | Where-Object { $Text -match $_.Value } |
        ForEach-Object { $_.Key })
}

function Get-ProductionCapabilityText {
    $trackedPaths = @(
        'backend/bridge/mt5_ea/MarketLensExecutionEA.mq5',
        'backend/bridge/mt5_ea/Publish-MarketLensExecutionEA.ps1',
        'backend/bridge/mt5_vm/phase1_adapter.py',
        'backend/cmd/api/main.go',
        'backend/cmd/mt5-phase3-harness/main.go',
        'backend/execution/Cargo.toml',
        'backend/execution/crates/execution-domain/src/mt5_vm_control.rs',
        'backend/execution/crates/execution-gateway/Cargo.toml',
        'backend/execution/crates/execution-gateway/src/main.rs',
        'backend/execution/crates/execution-gateway/src/mt5_vm_connections.rs',
        'backend/execution/crates/execution-gateway/src/mt5_vm_control.rs',
        'backend/execution/crates/execution-gateway/src/mt5_vm_sync.rs',
        'backend/execution/crates/mt5-vm-agent/src/job.rs',
        'backend/execution/crates/mt5-vm-agent/src/managed.rs',
        'backend/execution/crates/mt5-vm-agent/src/process.rs',
        'backend/internal/config/config.go',
        'backend/internal/execution/handler.go',
        'backend/internal/execution/mt5_connector_client.go',
        'backend/internal/execution/mt5_connector_handler.go',
        'frontend/src/components/trade/Mt5ManagedConnectionDialog.tsx',
        'frontend/src/i18n/localization.ts',
        'frontend/src/services/api/resources/executionApi.ts'
    )
    $trackedDiff = @(Invoke-GitLines `
        (@('diff', '--no-ext-diff', '--unified=0', '--') + $trackedPaths))
    $added = @($trackedDiff | Where-Object {
        $_.StartsWith('+', [StringComparison]::Ordinal) -and
        -not $_.StartsWith('+++', [StringComparison]::Ordinal)
    } | ForEach-Object { $_.Substring(1) })

    $untrackedPaths = @(
        'backend/internal/execution/mt5_identity_key.go',
        'backend/migrations/0042_mt5_managed_ea_bootstrap.up.sql',
        'backend/migrations/0042_mt5_managed_ea_bootstrap.down.sql'
    )
    $untrackedPaths += @(Get-ChildItem -LiteralPath (Join-Path $repoRoot 'tools\mt5-baremetal') `
        -Filter '*.ps1' -File | ForEach-Object {
            Get-RepoRelativePath $_.FullName
        })
    foreach ($relative in $untrackedPaths) {
        $path = Join-Path $repoRoot $relative
        if (Test-Path -LiteralPath $path -PathType Leaf) {
            $added += [IO.File]::ReadAllLines($path, $utf8)
        }
    }
    return $added -join "`n"
}

function Assert-ProductionRunnerDeltaPolicy(
    [string]$Source,
    [string[]]$AddedLines
) {
    $expectedAddedLines = @(
        '$executionMt5IdentityHmacKeyFile = Get-BackendEnvValue "EXECUTION_MT5_IDENTITY_HMAC_KEY_FILE"',
        'if ([string]::IsNullOrWhiteSpace($executionMt5IdentityHmacKeyFile) -or',
        '    -not [IO.Path]::IsPathRooted($executionMt5IdentityHmacKeyFile)) {',
        '  throw "EXECUTION_MT5_IDENTITY_HMAC_KEY_FILE must be an absolute path."',
        '}',
        '$executionMt5IdentityHmacKeyFile = [IO.Path]::GetFullPath($executionMt5IdentityHmacKeyFile)',
        'if (-not (Test-Path -LiteralPath $executionMt5IdentityHmacKeyFile -PathType Leaf)) {',
        '  throw "EXECUTION_MT5_IDENTITY_HMAC_KEY_FILE must name a readable regular file."',
        '}',
        '$executionMt5IdentityHmacKeyItem = Get-Item -LiteralPath $executionMt5IdentityHmacKeyFile -Force',
        'if (($executionMt5IdentityHmacKeyItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or',
        '    $executionMt5IdentityHmacKeyItem.Length -lt 32 -or',
        '    $executionMt5IdentityHmacKeyItem.Length -gt 4096) {',
        '  throw "EXECUTION_MT5_IDENTITY_HMAC_KEY_FILE must name a small non-link secret file."',
        '}',
        '$env:EXECUTION_MT5_IDENTITY_HMAC_KEY_FILE = $executionMt5IdentityHmacKeyFile'
    )
    $delta = @(Compare-Object -ReferenceObject $expectedAddedLines `
        -DifferenceObject @($AddedLines) -SyncWindow 0)
    if ($delta.Count -gt 0) {
        throw 'unapproved production runner capability change'
    }

    foreach ($requiredLine in @(
        $expectedAddedLines[0],
        $expectedAddedLines[$expectedAddedLines.Count - 1]
    )) {
        $matchCount = [regex]::Matches($Source, [regex]::Escape($requiredLine)).Count
        if ($matchCount -ne 1) {
            throw 'production runner security export must appear exactly once'
        }
    }
}

function Get-ChangedCoverageSources([ValidateSet('go', 'rust')][string]$Language) {
    $paths = @(
        Invoke-GitLines @('diff', '--name-only', '--diff-filter=ACMRTUXB', 'HEAD', '--', '.')
    )
    $paths += @(Invoke-GitLines @('ls-files', '--others', '--exclude-standard'))
    $normalized = @($paths | ForEach-Object { $_.Replace('\', '/') } | Sort-Object -Unique)
    $selected = @(if ($Language -eq 'go') {
        $normalized | Where-Object {
            $_.StartsWith('backend/', [StringComparison]::OrdinalIgnoreCase) -and
            $_.EndsWith('.go', [StringComparison]::OrdinalIgnoreCase) -and
            -not $_.EndsWith('_test.go', [StringComparison]::OrdinalIgnoreCase)
        }
    } else {
        $normalized | Where-Object {
            $_.StartsWith('backend/execution/crates/', [StringComparison]::OrdinalIgnoreCase) -and
            $_ -match '(?i)/src/.*\.rs$'
        }
    })
    if ($selected.Count -eq 0) {
        throw "No changed $Language production source files were discovered"
    }
    return $selected
}

function Write-ChangedSourceDiff([string[]]$Paths, [string]$Destination) {
    if ($Paths.Count -eq 0) { throw 'Cannot write an empty changed-source diff' }
    $tracked = @(Invoke-GitLines (@('ls-files', '--') + $Paths))
    $untracked = @(Invoke-GitLines (@('ls-files', '--others', '--exclude-standard', '--') + $Paths))
    if (($tracked.Count + $untracked.Count) -ne $Paths.Count) {
        throw 'Changed-source discovery contains a path that is neither tracked nor untracked'
    }

    $builder = [Text.StringBuilder]::new()
    if ($tracked.Count -gt 0) {
        $captured = Invoke-CapturedProcess 'git.exe' `
            (@('-c', 'core.safecrlf=false', 'diff', '--no-ext-diff', '--unified=0', 'HEAD', '--') +
                $tracked) $repoRoot 120
        if ($captured.ExitCode -ne 0) {
            throw "git diff failed while preparing changed-line coverage: $($captured.Stderr.Trim())"
        }
        $null = $builder.Append($captured.Stdout)
        if ($builder.Length -gt 0 -and $builder[$builder.Length - 1] -ne "`n") {
            $null = $builder.AppendLine()
        }
    }

    foreach ($relative in $untracked) {
        $sourcePath = Join-Path $repoRoot $relative
        $lines = [IO.File]::ReadAllLines($sourcePath, $utf8)
        if ($lines.Count -eq 0) { throw "Changed source file is empty: $relative" }
        $normalized = $relative.Replace('\', '/')
        $null = $builder.AppendLine("diff --git a/$normalized b/$normalized")
        $null = $builder.AppendLine('new file mode 100644')
        $null = $builder.AppendLine('--- /dev/null')
        $null = $builder.AppendLine("+++ b/$normalized")
        $null = $builder.AppendLine("@@ -0,0 +1,$($lines.Count) @@")
        foreach ($line in $lines) { $null = $builder.AppendLine("+$line") }
    }

    if ($builder.Length -eq 0 -or $builder.ToString() -notmatch '(?m)^@@ ') {
        throw 'Changed-source diff contains no hunks'
    }
    [IO.File]::WriteAllText($Destination, $builder.ToString(), $utf8)
    "CHANGED_SOURCE_DIFF=$([IO.Path]::GetFileName($Destination)) FILES=$($Paths.Count)"
}

function Write-TaskSourceState {
    $paths = @(Invoke-GitLines @(
        'diff', '--name-only', '--diff-filter=ACMRTUXBD', 'HEAD', '--', '.'
    ))
    $paths += @(Invoke-GitLines @('ls-files', '--others', '--exclude-standard'))
    $paths = @($paths | ForEach-Object { $_.Replace('\', '/') } |
        Where-Object {
            -not $_.StartsWith('.artifacts/', [StringComparison]::OrdinalIgnoreCase) -and
            $_ -notmatch '(?i)^backend/execution/[^/]+\.profraw$'
        } | Sort-Object -Unique)
    if ($paths.Count -eq 0) { throw 'Task source state contains no changed paths' }

    $records = @()
    $canonicalLines = @()
    foreach ($relative in $paths) {
        $absolute = Join-Path $repoRoot $relative
        if (Test-Path -LiteralPath $absolute -PathType Leaf) {
            $resolvedRelative = (Get-RepoRelativePath $absolute).Replace('\', '/')
            if ($resolvedRelative -cne $relative) {
                throw "Task source path did not resolve exactly: $relative"
            }
            $item = Get-Item -LiteralPath $absolute -Force
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw "Task source state refuses a reparse-point file: $relative"
            }
            $hash = (Get-FileHash -LiteralPath $absolute -Algorithm SHA256).Hash.ToLowerInvariant()
            $records += [pscustomobject][ordered]@{
                path = $relative
                status = 'present'
                bytes = [long]$item.Length
                sha256 = $hash
            }
            $canonicalLines += "$hash  $relative"
        } else {
            $records += [pscustomobject][ordered]@{
                path = $relative
                status = 'deleted'
                bytes = $null
                sha256 = $null
            }
            $canonicalLines += "DELETED  $relative"
        }
    }
    $canonical = ($canonicalLines -join "`n") + "`n"
    $hasher = [Security.Cryptography.SHA256]::Create()
    try {
        $aggregate = ([BitConverter]::ToString(
            $hasher.ComputeHash($utf8.GetBytes($canonical))
        )).Replace('-', '').ToLowerInvariant()
    } finally {
        $hasher.Dispose()
    }
    $state = [pscustomobject][ordered]@{
        schema_version = 1
        head = $head
        generated_at_utc = [DateTime]::UtcNow.ToString('o')
        task_tree_sha256 = $aggregate
        file_count = $records.Count
        files = $records
    }
    [IO.File]::WriteAllText(
        $sourceStatePath,
        ($state | ConvertTo-Json -Depth 6),
        $utf8
    )
    return $state
}

New-ReportRoot

$head = (@(Invoke-GitLines @('rev-parse', 'HEAD'))[0]).Trim()
$dirtyBefore = @(Invoke-GitLines @('status', '--short'))

Invoke-InProcessLayer 'source-state' {
    $script:sourceState = Write-TaskSourceState
    "SOURCE_STATE_FILES=$($script:sourceState.file_count)"
    "TASK_TREE_SHA256=$($script:sourceState.task_tree_sha256)"
} 'Hash every changed/untracked task file into source-state.json'

Invoke-InProcessLayer 'changed-source-diffs' {
    $script:goCoverageSources = @(Get-ChangedCoverageSources 'go')
    $script:rustCoverageSources = @(Get-ChangedCoverageSources 'rust')
    Write-ChangedSourceDiff $script:goCoverageSources $goDiffPath
    Write-ChangedSourceDiff $script:rustCoverageSources $rustDiffPath

    $negativeGoDiff = Join-Path $artifactRoot 'negative-go.diff'
    $negativeGoCoverage = Join-Path $artifactRoot 'negative-go-cover.out'
    $negativeRustDiff = Join-Path $artifactRoot 'negative-rust.diff'
    $negativeRustCoverage = Join-Path $artifactRoot 'negative-rust-cover.lcov'
    [IO.File]::WriteAllText($negativeGoDiff, @'
diff --git a/backend/internal/negative.go b/backend/internal/negative.go
--- a/backend/internal/negative.go
+++ b/backend/internal/negative.go
@@ -6,0 +7,1 @@
+knownBad()
'@, $utf8)
    [IO.File]::WriteAllText($negativeGoCoverage, @'
mode: atomic
marketlens/internal/negative.go:7.1,8.1 1 0
'@, $utf8)
    [IO.File]::WriteAllText($negativeRustDiff, @'
diff --git a/backend/execution/crates/negative/src/lib.rs b/backend/execution/crates/negative/src/lib.rs
--- a/backend/execution/crates/negative/src/lib.rs
+++ b/backend/execution/crates/negative/src/lib.rs
@@ -6,0 +7,1 @@
+known_bad();
'@, $utf8)
    [IO.File]::WriteAllText($negativeRustCoverage, @'
SF:backend/execution/crates/negative/src/lib.rs
DA:7,0
end_of_record
'@, $utf8)
    'NEGATIVE_COVERAGE_FIXTURES=go+rust'
} 'Generate exact zero-context task diffs and known-bad coverage controls'

Invoke-InProcessLayer 'powershell-parse' {
    $paths = [Collections.Generic.List[string]]::new()
    $paths.Add((Join-Path $repoRoot 'tools\verify-mt5-baremetal-managed-ea.ps1'))
    $paths.Add((Join-Path $repoRoot 'tools\verify-mt5-baremetal-managed-ea-mutants.ps1'))
    $paths.Add((Join-Path $repoRoot 'tools\verify-migration-0042-disposable.ps1'))
    $paths.Add((Join-Path $repoRoot 'backend\bridge\mt5_ea\Publish-MarketLensExecutionEA.ps1'))
    $paths.Add((Join-Path $repoRoot 'run-backend-production.ps1'))
    $paths.Add((Join-Path $repoRoot 'build-production.ps1'))
    $paths.Add((Join-Path $repoRoot 'tools\deploy-backend.ps1'))
    $paths.Add((Join-Path $repoRoot 'tools\verify-backend-deploy.ps1'))
    Get-ChildItem -LiteralPath (Join-Path $repoRoot 'tools\mt5-baremetal') -Filter '*.ps1' -File |
        ForEach-Object { $paths.Add($_.FullName) }
    foreach ($path in $paths) {
        $tokens = $null
        $errors = $null
        $null = [Management.Automation.Language.Parser]::ParseFile(
            $path, [ref]$tokens, [ref]$errors
        )
        if ($errors.Count -gt 0) {
            $messages = ($errors | ForEach-Object { $_.Message }) -join '; '
            throw "PowerShell parser rejected $path`: $messages"
        }
    }
    "PARSED_FILES=$($paths.Count)"
} 'PowerShell parser over every touched operator and verification script'

Invoke-NativeLayer 'deploy-backend-self-test' 'powershell.exe' @(
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', '.\tools\deploy-backend.ps1', '-SelfTest'
) $repoRoot 120 -RequiredPattern 'Self-test: \d+ passed, 0 failed'

$goFiles = @(
    'cmd/api/main.go',
    'cmd/api/main_source_contract_test.go',
    'cmd/mt5-phase3-harness/main.go',
    'internal/config/config.go',
    'internal/config/config_test.go',
    'internal/execution/handler.go',
    'internal/execution/mt5_connector_client.go',
    'internal/execution/mt5_connector_handler.go',
    'internal/execution/mt5_connector_handler_test.go',
    'internal/execution/mt5_identity_key.go',
    'internal/execution/mt5_identity_key_test.go'
)
Invoke-NativeLayer 'go-format' 'gofmt.exe' (@('-l') + $goFiles) `
    (Join-Path $repoRoot 'backend') 120 -RequireEmptyOutput
Invoke-NativeLayer 'go-vet' 'go.exe' @(
    'vet', './cmd/api', './cmd/mt5-phase3-harness', './internal/config', './internal/execution'
) (Join-Path $repoRoot 'backend') 900
Invoke-NativeLayer 'go-tests' 'go.exe' @(
    'test', '-count=1', './cmd/api', './cmd/mt5-phase3-harness', './internal/config', './internal/execution'
) (Join-Path $repoRoot 'backend') 900
$goCgoEnabled = (& go.exe env CGO_ENABLED).Trim()
$goRaceCompiler = @('gcc.exe', 'clang.exe', 'cl.exe') | ForEach-Object {
    Get-Command $_ -ErrorAction SilentlyContinue
} | Select-Object -First 1
if ($goCgoEnabled -eq '1' -and $null -ne $goRaceCompiler) {
    Invoke-NativeLayer 'go-race' 'go.exe' @(
        'test', '-count=1', '-race', './cmd/api', './internal/execution'
    ) (Join-Path $repoRoot 'backend') 1200
} else {
    Add-AllowedUnverified 'go-race' `
        'The approved SPEC requires race tests where supported; this Windows host has CGO disabled or no C compiler, so Go race instrumentation is unavailable.'
}
Invoke-InProcessLayer 'go-changed-coverage' {
    $goRoot = Join-Path $repoRoot 'backend'
    $packages = [ordered]@{
        api = './cmd/api'
        phase3_harness = './cmd/mt5-phase3-harness'
        config = './internal/config'
        execution = './internal/execution'
    }
    $profiles = [Collections.Generic.List[string]]::new()
    foreach ($entry in $packages.GetEnumerator()) {
        $binary = Join-Path $artifactRoot ("go-cover-$($entry.Key).test.exe")
        $profile = Join-Path $artifactRoot ("go-cover-$($entry.Key).out")
        $build = Invoke-CapturedProcess 'go.exe' @(
            'test', '-c', '-covermode=atomic', '-coverpkg=./...',
            '-o', $binary, [string]$entry.Value
        ) $goRoot 600
        if ($build.ExitCode -ne 0) {
            throw "Go coverage build failed for $($entry.Value): $($build.Output.Trim())"
        }
        if (-not (Test-Path -LiteralPath $binary -PathType Leaf)) {
            throw "Go coverage build did not produce the task artifact binary: $binary"
        }
        $run = Invoke-CapturedProcess $binary @(
            '-test.count=1', '-test.timeout=300s', "-test.coverprofile=$profile"
        ) $goRoot 360
        if ($run.ExitCode -ne 0) {
            throw "Go coverage binary failed for $($entry.Value): $($run.Output.Trim())"
        }
        if (-not (Test-Path -LiteralPath $profile -PathType Leaf) -or
            (Get-Item -LiteralPath $profile).Length -le 13) {
            throw "Go coverage binary produced a missing or empty profile: $profile"
        }
        $profiles.Add($profile)
    }

    $merged = [Collections.Generic.List[string]]::new()
    $merged.Add('mode: atomic')
    foreach ($profile in $profiles) {
        $lines = [IO.File]::ReadAllLines($profile, $utf8)
        if ($lines.Count -lt 2 -or $lines[0] -cne 'mode: atomic') {
            throw "Go coverage profile is malformed or has the wrong mode: $profile"
        }
        foreach ($line in @($lines | Select-Object -Skip 1)) {
            if (-not [string]::IsNullOrWhiteSpace($line)) { $merged.Add($line) }
        }
    }
    if ($merged.Count -le 1) { throw 'Merged Go coverage profile contains zero records' }
    [IO.File]::WriteAllLines($goCoveragePath, $merged, $utf8)
    "GO_COVERAGE_BINARIES=$($packages.Count)"
    "GO_COVERAGE_RECORDS=$($merged.Count - 1)"
} 'Compile each Go package to a task-artifact test binary, execute it, and merge atomic profiles'
Invoke-NativeLayer 'go-changed-coverage-gate' 'python.exe' @(
    $coverageChecker,
    '--format', 'go',
    '--coverage', $goCoveragePath,
    '--diff', $goDiffPath,
    '--repo-root', $repoRoot,
    '--source-root', 'backend',
    '--label', 'go',
    '--json-output', (Join-Path $artifactRoot 'go-changed-coverage.json')
) $repoRoot 120 -RequiredPattern 'CHANGED_LINE_COVERAGE=go'
Invoke-ExpectedFailureLayer 'go-changed-coverage-negative-control' 'python.exe' @(
    $coverageChecker,
    '--format', 'go',
    '--coverage', (Join-Path $artifactRoot 'negative-go-cover.out'),
    '--diff', (Join-Path $artifactRoot 'negative-go.diff'),
    '--repo-root', $repoRoot,
    '--source-root', 'backend',
    '--label', 'negative-go',
    '--json-output', (Join-Path $artifactRoot 'negative-go.json')
) $repoRoot 'uncovered changed executable lines' 120
Invoke-NativeLayer 'go-module-integrity' 'go.exe' @('mod', 'verify') `
    (Join-Path $repoRoot 'backend') 300 -RequiredPattern 'all modules verified'

$rustRoot = Join-Path $repoRoot 'backend\execution'
$rustCoverageTriple = 'x86_64-pc-windows-msvc'
$rustCoverageHostTarget = Join-Path $rustRoot 'target'
$rustCoverageObjectRoot = Join-Path $rustCoverageHostTarget $rustCoverageTriple
Invoke-NativeLayer 'rust-fmt' 'cargo.exe' @('fmt', '--all', '--', '--check') $rustRoot 300
Invoke-NativeLayer 'rust-check' 'cargo.exe' @('check', '--locked', '--workspace', '--all-targets') `
    $rustRoot 1200
Invoke-NativeLayer 'rust-clippy' 'cargo.exe' @(
    'clippy', '--locked', '--workspace', '--all-targets', '--', '-D', 'warnings'
) $rustRoot 1200
Invoke-NativeLayer 'rust-tests' 'cargo.exe' @(
    'test', '--locked', '-p', 'execution-domain', '-p', 'execution-gateway',
    '--all-targets', '--', '--test-threads=1'
) $rustRoot 1200 -ApplicationControlRetries 20
$rustAgentEnvironment = @{
    CARGO_TARGET_DIR = $rustAgentTargetRoot
}
Invoke-NativeLayer 'rust-agent-tests' 'cargo.exe' @(
    'test', '--locked', '-p', 'mt5-vm-agent', '--lib',
    '--test', 'managed_commands', '--test', 'managed_control', '--test', 'managed_worker_cli',
    '--', '--test-threads=1'
) $rustRoot 1200 -EnvironmentVariables $rustAgentEnvironment -ApplicationControlRetries 20
Invoke-NativeLayer 'rust-stress-properties' 'cargo.exe' @(
    'test', '--locked', '-p', 'mt5-vm-agent', '--test', 'managed_commands', '--', '--test-threads=1'
) $rustRoot 1200 -EnvironmentVariables $rustAgentEnvironment -ApplicationControlRetries 20
Invoke-NativeLayer 'rust-supply-chain-lock' 'cargo.exe' @(
    'metadata', '--locked', '--offline', '--format-version', '1', '--no-deps'
) $rustRoot 300 -RequiredPattern 'workspace_root'

$script:llvmCovPath = ''
$script:llvmProfdataPath = ''
$script:rustCoverageObjects = @()
Invoke-InProcessLayer 'rust-coverage-toolchain' {
    $active = Invoke-CapturedProcess 'rustup.exe' @('show', 'active-toolchain') $repoRoot 120
    if ($active.ExitCode -ne 0 -or
        $active.Stdout.Trim() -notmatch '^stable-x86_64-pc-windows-msvc\s') {
        throw "Unexpected active Rust toolchain: $($active.Output.Trim())"
    }

    $rustc = Invoke-CapturedProcess 'rustc.exe' @("+$rustToolchain", '-Vv') $repoRoot 120
    if ($rustc.ExitCode -ne 0 -or
        $rustc.Stdout -notmatch '(?m)^release: 1\.97\.1$' -or
        $rustc.Stdout -notmatch '(?m)^commit-hash: 8bab26f4f68e0e26f0bb7960be334d5b520ea452$' -or
        $rustc.Stdout -notmatch '(?m)^LLVM version: 22\.1\.6$') {
        throw "Rust compiler does not match approved Revision 16: $($rustc.Output.Trim())"
    }

    $components = Invoke-CapturedProcess 'rustup.exe' @(
        'component', 'list', '--installed', '--toolchain', $rustToolchain
    ) $repoRoot 120
    if ($components.ExitCode -ne 0 -or
        $components.Stdout -notmatch '(?m)^llvm-tools-x86_64-pc-windows-msvc$') {
        throw 'Approved llvm-tools-preview component is not installed for the exact toolchain'
    }

    $sysroot = Invoke-CapturedProcess 'rustc.exe' @(
        "+$rustToolchain", '--print', 'sysroot'
    ) $repoRoot 120
    if ($sysroot.ExitCode -ne 0 -or [string]::IsNullOrWhiteSpace($sysroot.Stdout)) {
        throw "Cannot resolve the approved Rust sysroot: $($sysroot.Output.Trim())"
    }
    $llvmBin = Join-Path $sysroot.Stdout.Trim() 'lib\rustlib\x86_64-pc-windows-msvc\bin'
    $covPath = Join-Path $llvmBin 'llvm-cov.exe'
    $profdataPath = Join-Path $llvmBin 'llvm-profdata.exe'
    foreach ($path in @($covPath, $profdataPath)) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
            throw "Bundled LLVM executable is missing: $path"
        }
    }

    $covVersion = Invoke-CapturedProcess $covPath @('--version') $repoRoot 120
    $profdataVersion = Invoke-CapturedProcess $profdataPath @('--version') $repoRoot 120
    foreach ($version in @($covVersion, $profdataVersion)) {
        if ($version.ExitCode -ne 0 -or
            $version.Stdout -notmatch 'LLVM version 22\.1\.6-rust-1\.97\.1-stable') {
            throw "Bundled LLVM tool version mismatch: $($version.Output.Trim())"
        }
    }

    $script:llvmCovPath = $covPath
    $script:llvmProfdataPath = $profdataPath
    $covHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $covPath).Hash
    $profdataHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $profdataPath).Hash
    "RUST_TOOLCHAIN=$($active.Stdout.Trim())"
    'LLVM_VERSION=22.1.6-rust-1.97.1-stable'
    "LLVM_COV_PATH=$covPath"
    "LLVM_COV_SHA256=$covHash"
    "LLVM_PROFDATA_PATH=$profdataPath"
    "LLVM_PROFDATA_SHA256=$profdataHash"
} 'Attest Revision 16 llvm-tools component, exact toolchain, versions, paths, and hashes'

$rustCoverageBuildEnvironment = @{
    CARGO_INCREMENTAL = '0'
    CARGO_BUILD_TARGET = $rustCoverageTriple
    CARGO_TARGET_DIR = $rustCoverageHostTarget
    CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_RUSTFLAGS = '-C instrument-coverage'
    CARGO_ENCODED_RUSTFLAGS = $null
    RUSTFLAGS = $null
}
$rustCoverageTestEnvironment = @{
    CARGO_INCREMENTAL = '0'
    CARGO_BUILD_TARGET = $rustCoverageTriple
    CARGO_TARGET_DIR = $rustCoverageHostTarget
    CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_RUSTFLAGS = '-C instrument-coverage'
    CARGO_ENCODED_RUSTFLAGS = $null
    LLVM_PROFILE_FILE = Join-Path $rustProfileRoot '%p-%m.profraw'
    RUSTFLAGS = $null
}
Invoke-InProcessLayer 'rust-coverage-build' {
    $null = New-Item -ItemType Directory -Path $rustProfileRoot -Force
    $null = New-Item -ItemType Directory -Path $rustCoverageHostTarget -Force
    $buildSelections = @(
        [pscustomobject]@{
            Name = 'combined'
            Arguments = @(
                'test', '--locked',
                '-p', 'execution-domain', '-p', 'execution-gateway', '-p', 'mt5-vm-agent',
                '--all-targets', '--no-run', '--message-format=json'
            )
        }
    )
    $objects = [Collections.Generic.List[string]]::new()
    foreach ($selection in $buildSelections) {
        $captured = Invoke-CapturedProcessWithApplicationControlRetry 'cargo.exe' `
            $selection.Arguments $rustRoot 1800 $rustCoverageBuildEnvironment 20
        if ($captured.ExitCode -ne 0) {
            throw "Instrumented Rust coverage build '$($selection.Name)' exited $($captured.ExitCode): $($captured.Output.Trim())"
        }
        foreach ($line in @($captured.Stdout -split "`r?`n" | Where-Object { $_.Trim() -ne '' })) {
            try {
                $message = $line | ConvertFrom-Json -ErrorAction Stop
            } catch {
                throw "Cargo JSON message was malformed for '$($selection.Name)': $line"
            }
            if ($message.reason -eq 'compiler-artifact' -and
                $message.profile.test -eq $true -and
                -not [string]::IsNullOrWhiteSpace([string]$message.executable)) {
                $resolved = [IO.Path]::GetFullPath([string]$message.executable)
                $targetPrefix = [IO.Path]::GetFullPath($rustCoverageObjectRoot).TrimEnd('\') + '\'
                if (-not $resolved.StartsWith($targetPrefix, [StringComparison]::OrdinalIgnoreCase)) {
                    throw "Cargo reported a coverage test object outside the explicit target triple: $resolved"
                }
                if (-not (Test-Path -LiteralPath $resolved -PathType Leaf)) {
                    throw "Cargo reported a missing coverage object: $resolved"
                }
                $objects.Add($resolved)
            }
        }
    }
    $script:rustCoverageObjects = @($objects | Sort-Object -Unique)
    if ($script:rustCoverageObjects.Count -eq 0) {
        throw 'Instrumented Cargo build reported zero executable coverage objects'
    }
    'RUST_COVERAGE_BUILD_SELECTIONS=combined'
    "RUST_COVERAGE_OBJECTS=$($script:rustCoverageObjects.Count)"
    "RUST_COVERAGE_OBJECT_ROOT=$rustCoverageObjectRoot"
} 'Build instrumented Rust test objects and parse Cargo JSON fail closed'

Invoke-NativeLayer 'rust-coverage-agent-warmup' 'cargo.exe' @(
    'test', '--locked',
    '-p', 'execution-domain', '-p', 'execution-gateway', '-p', 'mt5-vm-agent', '--lib',
    'process::tests::managed_ea_gateway_origin_rejects_credentials_paths_queries_and_remote_http',
    '--', '--exact', '--test-threads=1'
) $rustRoot 1800 -EnvironmentVariables $rustCoverageTestEnvironment `
    -ApplicationControlRetries 20

Invoke-NativeLayer 'rust-coverage-tests' 'cargo.exe' @(
    'test', '--locked',
    '-p', 'execution-domain', '-p', 'execution-gateway', '-p', 'mt5-vm-agent',
    '--all-targets', '--', '--test-threads=1'
) $rustRoot 1800 -EnvironmentVariables $rustCoverageTestEnvironment `
    -ApplicationControlRetries 20

Invoke-NativeLayer 'rust-database-integration' 'powershell.exe' @(
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', '.\tools\verify-migration-0042-disposable.ps1', '-RunRustManagedTests'
) $repoRoot 1800 -RequiredPattern 'RUST_MANAGED_DATABASE_TESTS=PASS' `
    -EnvironmentVariables $rustCoverageTestEnvironment

Invoke-InProcessLayer 'rust-coverage-merge' {
    if ([string]::IsNullOrWhiteSpace($script:llvmProfdataPath)) {
        throw 'llvm-profdata was not attested by rust-coverage-toolchain'
    }
    $profiles = @(Get-ChildItem -LiteralPath $rustProfileRoot -Filter '*.profraw' -File)
    if ($profiles.Count -eq 0) { throw 'Instrumented Rust tests produced zero .profraw files' }
    foreach ($profile in $profiles) {
        if ($profile.Length -eq 0) { throw "Instrumented Rust profile is empty: $($profile.FullName)" }
    }
    $inputList = Join-Path $artifactRoot 'rust-profraw-inputs.txt'
    [IO.File]::WriteAllLines($inputList, @($profiles.FullName), $utf8)
    $captured = Invoke-CapturedProcess $script:llvmProfdataPath @(
        'merge', '--sparse', "--input-files=$inputList", "--output=$rustProfilePath"
    ) $repoRoot 300
    if ($captured.ExitCode -ne 0) {
        throw "llvm-profdata merge exited $($captured.ExitCode): $($captured.Output.Trim())"
    }
    if (-not (Test-Path -LiteralPath $rustProfilePath -PathType Leaf) -or
        (Get-Item -LiteralPath $rustProfilePath).Length -eq 0) {
        throw 'llvm-profdata did not create a non-empty merged profile'
    }
    "RUST_PROFILES=$($profiles.Count)"
    "RUST_PROFDATA_BYTES=$((Get-Item -LiteralPath $rustProfilePath).Length)"
} 'Merge only fresh task Rust profiles with bundled llvm-profdata'

Invoke-InProcessLayer 'rust-coverage-export' {
    if ([string]::IsNullOrWhiteSpace($script:llvmCovPath)) {
        throw 'llvm-cov was not attested by rust-coverage-toolchain'
    }
    if ($script:rustCoverageObjects.Count -eq 0) {
        throw 'No attested Rust coverage objects are available for export'
    }
    $arguments = [Collections.Generic.List[string]]::new()
    foreach ($argument in @(
        'export', '--format=lcov', "--instr-profile=$rustProfilePath", '--check-binary-ids',
        $script:rustCoverageObjects[0]
    )) { $arguments.Add($argument) }
    foreach ($object in @($script:rustCoverageObjects | Select-Object -Skip 1)) {
        $arguments.Add("--object=$object")
    }
    $captured = Invoke-CapturedProcess $script:llvmCovPath $arguments.ToArray() $repoRoot 600
    if ($captured.ExitCode -ne 0) {
        throw "llvm-cov export exited $($captured.ExitCode): $($captured.Output.Trim())"
    }
    if ([string]::IsNullOrWhiteSpace($captured.Stdout) -or
        $captured.Stdout -notmatch '(?m)^SF:' -or
        $captured.Stdout -notmatch '(?m)^DA:') {
        throw 'llvm-cov export produced a missing, empty, or malformed LCOV report'
    }
    [IO.File]::WriteAllText($rustCoveragePath, $captured.Stdout, $utf8)
    "RUST_LCOV_BYTES=$((Get-Item -LiteralPath $rustCoveragePath).Length)"
    "RUST_COVERAGE_OBJECTS=$($script:rustCoverageObjects.Count)"
    if (-not [string]::IsNullOrWhiteSpace($captured.Stderr)) { $captured.Stderr.Trim() }
} 'Export fresh Rust LCOV with bundled llvm-cov and all Cargo test objects'

Invoke-NativeLayer 'rust-changed-coverage-gate' 'python.exe' @(
    $coverageChecker,
    '--format', 'lcov',
    '--coverage', $rustCoveragePath,
    '--diff', $rustDiffPath,
    '--repo-root', $repoRoot,
    '--source-root', 'backend/execution',
    '--label', 'rust',
    '--json-output', (Join-Path $artifactRoot 'rust-changed-coverage.json')
) $repoRoot 120 -RequiredPattern 'CHANGED_LINE_COVERAGE=rust'
Invoke-ExpectedFailureLayer 'rust-changed-coverage-negative-control' 'python.exe' @(
    $coverageChecker,
    '--format', 'lcov',
    '--coverage', (Join-Path $artifactRoot 'negative-rust-cover.lcov'),
    '--diff', (Join-Path $artifactRoot 'negative-rust.diff'),
    '--repo-root', $repoRoot,
    '--source-root', 'backend/execution',
    '--label', 'negative-rust',
    '--json-output', (Join-Path $artifactRoot 'negative-rust.json')
) $repoRoot 'uncovered changed executable lines' 120

Invoke-NativeLayer 'python-managed' 'python.exe' @(
    '-m', 'unittest', '-v',
    'backend.bridge.mt5_vm.test_phase1_adapter',
    'backend.bridge.mt5_vm.test_baremetal_worker_install',
    'backend.bridge.mt5_vm.test_managed_safety_contracts',
    'backend.bridge.mt5_vm.test_managed_mutation_runner',
    'backend.bridge.mt5_vm.test_managed_gauntlet',
    'backend.bridge.mt5_vm.test_changed_line_coverage',
    'backend.bridge.mt5_ea.test_managed_bootstrap',
    'backend.migrations.test_0042_disposable_gate'
) $repoRoot 900 -RejectedPattern '(?m)^FAILED \('
Invoke-NativeLayer 'python-vm-regression' 'python.exe' @(
    '-m', 'unittest', '-v',
    'backend.bridge.mt5_vm.test_phase1_control_harness',
    'backend.bridge.mt5_vm.test_phase4_snapshots',
    'backend.bridge.mt5_vm.test_powershell_process_contracts',
    'backend.bridge.mt5_vm.test_local_image_automation'
) $repoRoot 900 -RejectedPattern '(?m)^FAILED \('

$windowsPowerShell = 'powershell.exe'
Invoke-NativeLayer 'postgres-0042-positive' $windowsPowerShell @(
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', '.\tools\verify-migration-0042-disposable.ps1'
) $repoRoot 900 -RequiredPattern 'PASS migration 0042 disposable PostgreSQL'
Invoke-ExpectedFailureLayer 'postgres-0042-negative-control' $windowsPowerShell @(
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', '.\tools\verify-migration-0042-disposable.ps1', '-NegativeControl'
) $repoRoot 'KNOWN_BAD_0042_CHECKER_INPUT' 900

Invoke-NativeLayer 'mutation-self-test' $windowsPowerShell @(
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', '.\tools\verify-mt5-baremetal-managed-ea-mutants.ps1', '-SelfTest'
) $repoRoot 300 -RequiredPattern 'MUTATION_SELF_TEST_OK=2/2'
Invoke-NativeLayer 'mutation-score' $windowsPowerShell @(
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', '.\tools\verify-mt5-baremetal-managed-ea-mutants.ps1', '-Execute'
) $repoRoot 1800 -RequiredPattern 'MUTATION_SCORE=8/8'

Invoke-NativeLayer 'ea-metaeditor-compile' $windowsPowerShell @(
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', '.\backend\bridge\mt5_ea\Publish-MarketLensExecutionEA.ps1'
) $repoRoot 600 -RequiredPattern 'Published EA:'
Invoke-NativeLayer 'ea-release-attestation' $windowsPowerShell @(
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', '.\backend\bridge\mt5_ea\Publish-MarketLensExecutionEA.ps1', '-VerifyOnly'
) $repoRoot 120 -RequiredPattern 'Verified MT5 EA release:'

$frontendRoot = Join-Path $repoRoot 'frontend'
Invoke-NativeLayer 'frontend-typecheck' 'cmd.exe' @('/d', '/s', '/c', 'npm run typecheck') `
    $frontendRoot 900
Invoke-NativeLayer 'frontend-lint' 'cmd.exe' @('/d', '/s', '/c', 'npm run lint') `
    $frontendRoot 900
Invoke-NativeLayer 'frontend-trade-tests' 'cmd.exe' @('/d', '/s', '/c', 'npm run test:trade') `
    $frontendRoot 1200
Invoke-NativeLayer 'npm-production-audit' 'cmd.exe' @(
    '/d', '/s', '/c', 'npm audit --omit=dev --audit-level=high'
) $frontendRoot 900

Invoke-InProcessLayer 'dependency-delta-audit' {
    $goOrManifestDelta = @(Invoke-GitLines @(
        'diff', '--name-only', '--',
        'backend/go.mod', 'backend/go.sum',
        'frontend/package.json'
    ))
    if ($goOrManifestDelta.Count -gt 0) {
        throw "unexpected Go or Node manifest delta: $($goOrManifestDelta -join ', ')"
    }

    $nodeLockChanged = @(Invoke-GitLines @(
        'diff', '--unified=0', '--', 'frontend/package-lock.json'
    ) | Where-Object { $_ -match '^[+-](?![+-]{2})' })
    if ($nodeLockChanged.Count -ne 6 -or
        @($nodeLockChanged | Where-Object {
            $_ -notmatch '^[+-]\s+"(?:version|resolved|integrity)":'
        }).Count -gt 0 -or
        ($nodeLockChanged -join "`n") -notmatch '(?m)^-\s+"version": "3\.3\.16",$' -or
        ($nodeLockChanged -join "`n") -notmatch '(?m)^\+\s+"version": "3\.3\.18",$' -or
        ($nodeLockChanged -join "`n") -notmatch 'nanoid-3\.3\.16' -or
        ($nodeLockChanged -join "`n") -notmatch 'nanoid-3\.3\.18' -or
        @($nodeLockChanged | Where-Object {
            $_ -match '^\+\s+"integrity": "sha512-[A-Za-z0-9+/]+=*",$'
        }).Count -ne 1) {
        throw 'package-lock contains a delta beyond the reviewed nanoid 3.3.16 -> 3.3.18 security update'
    }

    $lockAdded = @(Invoke-GitLines @(
        'diff', '--unified=0', '--', 'backend/execution/Cargo.lock'
    ) |
        Where-Object { $_ -match '^\+(?!\+\+)' } |
        ForEach-Object { $_.Substring(1).Trim() } |
        Where-Object { $_ -ne '' })
    if (@($lockAdded | Where-Object { $_ -cne '"hmac",' }).Count -gt 0) {
        throw "Cargo.lock contains an unreviewed package delta: $($lockAdded -join ', ')"
    }

    $manifestAdded = @(Invoke-GitLines @(
        'diff', '--unified=0', '--',
        'backend/execution/Cargo.toml',
        'backend/execution/crates/execution-gateway/Cargo.toml'
    ) |
        Where-Object { $_ -match '^\+(?!\+\+)' } |
        ForEach-Object { $_.Substring(1).Trim() } |
        Where-Object { $_ -ne '' })
    $allowed = @(
        'hmac.workspace = true',
        '"Win32_Security_Authorization",',
        '"Win32_Storage_FileSystem",',
        '"Win32_System_IO",',
        '"Win32_System_Pipes",'
    )
    if (@($manifestAdded | Where-Object { $_ -cnotin $allowed }).Count -gt 0) {
        throw "Cargo manifests contain an unreviewed capability or dependency delta: $($manifestAdded -join ', ')"
    }
    'DEPENDENCY_DELTA=existing-hmac-reviewed-windows-api-features-and-nanoid-3.3.18-security-lock-only'
} 'Review dependency manifests and lockfile additions against the approved no-new-package SPEC'

Invoke-NativeLayer 'backend-docs' $windowsPowerShell @(
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', '.\tools\verify-backend-docs.ps1', '-DocsOnly'
) $repoRoot 300 -RequiredPattern 'Backend documentation gauntlet PASSED:'

Invoke-NativeLayer 'diff-whitespace' 'git.exe' @('diff', '--check') $repoRoot 120
Invoke-InProcessLayer 'secret-diff-scan' {
    $placeholderControl = 'postgres://' + 'user' + ':' + 'pass' +
        '@localhost:5432/marketlens?sslmode=disable'
    if (@(Get-SecretPatternHits (Remove-ApprovedCredentialPlaceholders $placeholderControl)).Count -ne 0) {
        throw 'approved localhost credential placeholder was not sanitized'
    }
    'SECRET_SCAN_PLACEHOLDER_CONTROL_OK'

    $credentialControl = 'https://' + 'nonplaceholder-user' + ':' +
        'nonplaceholder-secret' + '@private.invalid'
    $credentialControlHits = @(Get-SecretPatternHits $credentialControl)
    if ($credentialControlHits.Count -ne 1 -or
        $credentialControlHits[0] -cne 'credential_url') {
        throw 'credential URL negative control unexpectedly passed'
    }
    'SECRET_SCAN_NEGATIVE_CONTROL_OK'

    $text = Remove-ApprovedCredentialPlaceholders (Get-AddedTaskText)
    $hits = @(Get-SecretPatternHits $text)
    if ($hits.Count -gt 0) {
        throw "high-confidence secret pattern(s) found in task additions: $($hits -join ', ')"
    }
    'SECRET_SCAN=high-confidence-added-lines-and-untracked-source-clean'
} 'Scan added task text without logging candidate secret values'

Invoke-InProcessLayer 'capability-diff-audit' {
    $runnerSource = [IO.File]::ReadAllText(
        (Join-Path $repoRoot 'run-backend-production.ps1'),
        $utf8
    )
    $runnerDiff = @(Invoke-GitLines @(
        'diff', '--no-ext-diff', '--unified=0', '--', 'run-backend-production.ps1'
    ))
    $runnerAddedLines = @($runnerDiff | Where-Object {
        $_.StartsWith('+', [StringComparison]::Ordinal) -and
        -not $_.StartsWith('+++', [StringComparison]::Ordinal)
    } | ForEach-Object { $_.Substring(1) })

    $negativeControlRejected = $false
    try {
        Assert-ProductionRunnerDeltaPolicy $runnerSource `
            @($runnerAddedLines + 'mt5-vm-agent.exe --managed-worker')
    } catch {
        if ($_.Exception.Message -ne 'unapproved production runner capability change') { throw }
        $negativeControlRejected = $true
    }
    if (-not $negativeControlRejected) {
        throw 'production runner capability negative control unexpectedly passed'
    }
    'RUNNER_CAPABILITY_NEGATIVE_CONTROL_OK'

    Assert-ProductionRunnerDeltaPolicy $runnerSource $runnerAddedLines
    'RUNNER_SECURITY_EXPORT_OK'

    $text = Get-ProductionCapabilityText
    $forbidden = [ordered]@{
        hyper_v_enable = '(?i)Enable-WindowsOptionalFeature'
        vm_creation = '(?i)\bNew-VM\b'
        vhd_mount = '(?i)\bMount-VHD\b'
        network_download = '(?i)\b(?:Invoke-WebRequest|Start-BitsTransfer|DownloadFile|DownloadString)\b'
        gui_secret_automation = '(?i)\b(?:SendKeys|Set-Clipboard)\b'
        new_public_listener = '(?i)(?:bind|listen)[^\r\n]{0,80}(?:0\.0\.0\.0|\[::\])'
    }
    $hits = @($forbidden.GetEnumerator() | Where-Object { $text -match $_.Value } |
        ForEach-Object { $_.Key })
    if ($hits.Count -gt 0) {
        throw "unapproved capability pattern(s) found in task additions: $($hits -join ', ')"
    }
    'CAPABILITY_DIFF=no-hyperv-download-gui-secret-automation-public-listener-or-worker-launch'
} 'Audit added capabilities and the canonical production runner boundary'

Add-AllowedUnverified 'R15-9-live-demo' `
    'Separate execution-time confirmation, secure Vault, interactive worker identity, and three disposable demo accounts were not supplied; no broker or production action was attempted.'

$dirtyAfter = @(Invoke-GitLines @('status', '--short'))
$failed = @($script:results | Where-Object { $_.status -eq 'FAIL' })
$allowedUnverified = @($script:results | Where-Object { $_.status -eq 'UNVERIFIED_ALLOWED' })
$summary = [pscustomobject][ordered]@{
    gate = 'mt5-baremetal-managed-ea'
    revision = 15
    status = if ($failed.Count -eq 0) { 'PASS_WITH_ALLOWED_UNVERIFIED' } else { 'FAIL' }
    head = $head
    started_at_utc = $startedAt.ToString('o')
    completed_at_utc = [DateTime]::UtcNow.ToString('o')
    report_root = Get-RepoRelativePath $artifactRoot
    source_state = Get-RepoRelativePath $sourceStatePath
    task_tree_sha256 = $script:sourceState.task_tree_sha256
    failed_layers = @($failed | ForEach-Object { $_.name })
    allowed_unverified_layers = @($allowedUnverified | ForEach-Object { $_.name })
    dirty_before = $dirtyBefore
    dirty_after = $dirtyAfter
    results = $script:results
}
[IO.File]::WriteAllText(
    $summaryPath,
    ($summary | ConvertTo-Json -Depth 8),
    $utf8
)

Write-Output "SUMMARY=$summaryPath"
Write-Output "FAILED_LAYERS=$($failed.Count)"
Write-Output "ALLOWED_UNVERIFIED_LAYERS=$($allowedUnverified.Count)"
if ($failed.Count -gt 0) { exit 1 }
exit 0
