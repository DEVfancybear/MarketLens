<#
.SYNOPSIS
  Run the Revision 15 managed MT5 mutation gauntlet.

.DESCRIPTION
  Mutation execution is intentionally opt-in with -Execute. Every mutant uses
  one exact source anchor, one exact checker anchor, an exclusive repository
  lock, and byte-for-byte restoration in finally. A compile/launch/tooling
  failure is infrastructure failure, never a killed mutant.
#>
[CmdletBinding()]
param(
    [switch]$SelfTest,
    [switch]$Execute
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$artifactRoot = Join-Path $repoRoot '.artifacts\mt5-baremetal-managed-ea\mutation'
$runId = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ') + '-' + [guid]::NewGuid().ToString('N')
$runRoot = Join-Path $artifactRoot $runId
$lockPath = Join-Path $artifactRoot 'mutation.lock'
$utf8 = [Text.UTF8Encoding]::new($false, $true)

$script:ExecutionRequired = 'MUTATION_EXECUTION_REQUIRES_EXPLICIT_EXECUTE'
$script:Blocked = 'MUTATION_BLOCKED'
$script:Survived = 'MUTATION_SURVIVED'
$script:Infrastructure = 'MUTATION_INFRASTRUCTURE_FAILURE'

function New-Directory([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) {
        $null = New-Item -ItemType Directory -Path $Path
    }
}

function Resolve-ScopedPath([string]$Path) {
    $candidate = if ([IO.Path]::IsPathRooted($Path)) {
        [IO.Path]::GetFullPath($Path)
    } else {
        [IO.Path]::GetFullPath((Join-Path $repoRoot $Path))
    }
    $prefix = [IO.Path]::GetFullPath($repoRoot) + [IO.Path]::DirectorySeparatorChar
    if (-not $candidate.Equals([IO.Path]::GetFullPath($repoRoot), [StringComparison]::OrdinalIgnoreCase) -and
        -not $candidate.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "$($script:Blocked): path escapes repository: $candidate"
    }
    return $candidate
}

function Assert-RegularFile([string]$Path, [string]$Label) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "$($script:Blocked): missing $Label file: $Path"
    }
    $item = Get-Item -LiteralPath $Path -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "$($script:Blocked): reparse-point $Label file: $Path"
    }
}

function Get-AnchorCount([string]$Text, [string]$Anchor) {
    if ([string]::IsNullOrEmpty($Anchor)) { return 0 }
    return [regex]::Matches($Text, [regex]::Escape($Anchor)).Count
}

function Assert-UniqueAnchor([string]$Text, [string]$Anchor, [string]$Kind) {
    $count = Get-AnchorCount $Text $Anchor
    if ($count -ne 1) {
        throw "$($script:Blocked): $Kind anchor count is $count, expected 1"
    }
}

function Assert-CheckerAnchor([string]$Path, [string]$Anchor) {
    Assert-RegularFile $Path 'checker'
    $text = [IO.File]::ReadAllText($Path, $utf8)
    Assert-UniqueAnchor $text $Anchor 'checker'
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
            if ($backslashes -gt 0) { $null = $builder.Append(('\' * $backslashes)) }
            $null = $builder.Append($character)
        }
        $backslashes = 0
    }
    if ($backslashes -gt 0) { $null = $builder.Append(('\' * ($backslashes * 2))) }
    $null = $builder.Append('"')
    return $builder.ToString()
}

function Invoke-Checker([pscustomobject]$Checker) {
    $workingDirectory = Resolve-ScopedPath $Checker.WorkingDirectory
    if (-not (Test-Path -LiteralPath $workingDirectory -PathType Container)) {
        throw "$($script:Blocked): checker working directory is missing"
    }
    $startInfo = [Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $Checker.File
    $startInfo.WorkingDirectory = $workingDirectory
    $startInfo.Arguments = (($Checker.Arguments | ForEach-Object {
        ConvertTo-NativeArgument ([string]$_)
    }) -join ' ')
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    try {
        if (-not $process.Start()) {
            throw "$($script:Infrastructure): checker did not start"
        }
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        $timeoutMs = [Math]::Max(1, [int]$Checker.TimeoutSeconds) * 1000
        if (-not $process.WaitForExit($timeoutMs)) {
            try { $process.Kill() } catch { }
            throw "$($script:Infrastructure): checker timed out"
        }
        $process.WaitForExit()
        return [pscustomobject]@{
            ExitCode = $process.ExitCode
            Output = ($stdout.Result + "`n" + $stderr.Result)
        }
    } finally {
        $process.Dispose()
    }
}

function Get-MutationClassification(
    [int]$ExitCode,
    [string]$Output,
    [string]$ExpectedFailurePattern
) {
    if ($ExitCode -eq 0) { return 'Survived' }
    $infrastructurePattern = '(?im)(could not compile|error\[E[0-9]+\]|\[build failed\]|Application Control policy|os error 4551|SyntaxError:|ParserError:|ModuleNotFoundError:|No module named|is not recognized as the name|command not found)'
    if ($Output -match $infrastructurePattern) { return 'InfrastructureFailure' }
    if (-not [string]::IsNullOrWhiteSpace($ExpectedFailurePattern) -and
        $Output -match $ExpectedFailurePattern) {
        return 'Killed'
    }
    return 'InfrastructureFailure'
}

function Test-ByteExact([byte[]]$Expected, [byte[]]$Actual) {
    if ($Expected.Length -ne $Actual.Length) { return $false }
    for ($index = 0; $index -lt $Expected.Length; $index++) {
        if ($Expected[$index] -ne $Actual[$index]) { return $false }
    }
    return $true
}

function Test-TransientWindowsWriteException([Exception]$Exception) {
    while ($null -ne $Exception) {
        $win32Code = $Exception.HResult -band 0xFFFF
        # ERROR_SHARING_VIOLATION, ERROR_LOCK_VIOLATION, ERROR_USER_MAPPED_FILE.
        if ($win32Code -in @(32, 33, 1224)) { return $true }
        $Exception = $Exception.InnerException
    }
    return $false
}

function Write-BytesWithTransientWindowsRetry {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][byte[]]$Bytes,
        [ValidateRange(1, 50)][int]$MaxAttempts = 20,
        [ValidateRange(0, 1000)][int]$DelayMilliseconds = 100,
        [scriptblock]$WriteAction
    )
    if ($null -eq $WriteAction) {
        $WriteAction = {
            param([string]$WritePath, [byte[]]$WriteBytes)
            [IO.File]::WriteAllBytes($WritePath, $WriteBytes)
        }
    }
    for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
        try {
            & $WriteAction $Path $Bytes
            return
        } catch {
            if ($attempt -eq $MaxAttempts -or
                -not (Test-TransientWindowsWriteException $_.Exception)) {
                throw
            }
            if ($DelayMilliseconds -gt 0) {
                Start-Sleep -Milliseconds $DelayMilliseconds
            }
        }
    }
}

function Invoke-OneMutant([pscustomobject]$Mutant, [string]$OutputRoot) {
    $targetPath = Resolve-ScopedPath $Mutant.TargetPath
    $checkerPath = Resolve-ScopedPath $Mutant.Checker.Path
    Assert-RegularFile $targetPath 'target'
    Assert-CheckerAnchor $checkerPath $Mutant.Checker.Anchor
    $original = [IO.File]::ReadAllBytes($targetPath)
    $text = $utf8.GetString($original)
    Assert-UniqueAnchor $text $Mutant.Target 'target'

    $offset = $text.IndexOf($Mutant.Target, [StringComparison]::Ordinal)
    $mutatedText = $text.Substring(0, $offset) + $Mutant.Replacement +
        $text.Substring($offset + $Mutant.Target.Length)
    $mutated = $utf8.GetBytes($mutatedText)
    $checkerResult = $null
    $classification = 'InfrastructureFailure'
    try {
        Write-BytesWithTransientWindowsRetry -Path $targetPath -Bytes $mutated
        $checkerResult = Invoke-Checker $Mutant.Checker
        $classification = Get-MutationClassification $checkerResult.ExitCode `
            $checkerResult.Output $Mutant.Checker.ExpectedFailurePattern
    } catch {
        $checkerResult = [pscustomobject]@{ ExitCode = -1; Output = $_.Exception.Message }
        $classification = 'InfrastructureFailure'
    } finally {
        Write-BytesWithTransientWindowsRetry -Path $targetPath -Bytes $original
        $restored = [IO.File]::ReadAllBytes($targetPath)
        if (-not (Test-ByteExact $original $restored)) {
            throw "$($script:Infrastructure): byte-exact restore failed for $($Mutant.Id)"
        }
    }

    $safeId = $Mutant.Id -replace '[^A-Za-z0-9_.-]', '_'
    $logPath = Join-Path $OutputRoot ($safeId + '.log')
    @(
        "mutant=$($Mutant.Id)",
        "classification=$classification",
        "checker_exit=$($checkerResult.ExitCode)",
        $checkerResult.Output
    ) | Set-Content -LiteralPath $logPath -Encoding UTF8
    return [pscustomobject]@{
        id = $Mutant.Id
        classification = $classification
        checker_exit = $checkerResult.ExitCode
        log = $logPath
    }
}

function New-RepositoryLock {
    New-Directory $artifactRoot
    return [IO.FileStream]::new(
        $lockPath,
        [IO.FileMode]::OpenOrCreate,
        [IO.FileAccess]::ReadWrite,
        [IO.FileShare]::None
    )
}

function Remove-SelfTestRoot([string]$Path) {
    $resolved = [IO.Path]::GetFullPath($Path)
    $prefix = [IO.Path]::GetFullPath($artifactRoot) + [IO.Path]::DirectorySeparatorChar
    if (-not $resolved.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "$($script:Blocked): self-test cleanup escaped artifact root"
    }
    if (Test-Path -LiteralPath $resolved) {
        $item = Get-Item -LiteralPath $resolved -Force
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "$($script:Blocked): self-test root is a reparse point"
        }
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}

function Invoke-SelfTest {
    New-Directory $artifactRoot
    $selfRoot = Join-Path $artifactRoot ('selftest-' + [guid]::NewGuid().ToString('N'))
    New-Directory $selfRoot
    $lock = New-RepositoryLock
    try {
        try {
            $second = [IO.FileStream]::new(
                $lockPath, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite,
                [IO.FileShare]::None
            )
            $second.Dispose()
            throw 'exclusive mutation lock unexpectedly allowed a second writer'
        } catch [IO.IOException] {
            Write-Output 'CONTROL_OK=exclusive-lock'
        }

        try { Assert-UniqueAnchor 'alpha' 'missing' 'target'; throw 'fail-open' }
        catch { Write-Output 'CONTROL_OK=missing-target-anchor' }
        try { Assert-UniqueAnchor 'target target' 'target' 'target'; throw 'fail-open' }
        catch { Write-Output 'CONTROL_OK=duplicate-target-anchor' }

        $fixture = Join-Path $selfRoot 'fixture.txt'
        $original = $utf8.GetBytes("checker-anchor`nALLOW=false`nDENY=false`n")
        [IO.File]::WriteAllBytes($fixture, $original)
        try { Assert-CheckerAnchor $fixture 'missing-checker-anchor'; throw 'fail-open' }
        catch { Write-Output 'CONTROL_OK=missing-checker-anchor' }

        if ((Get-MutationClassification 0 '' 'never') -ne 'Survived') {
            throw 'surviving-mutant control failed'
        }
        Write-Output 'CONTROL_OK=surviving-mutant'
        if ((Get-MutationClassification 1 'error[E0001]: synthetic compile error' 'synthetic') -ne 'InfrastructureFailure') {
            throw 'compile-error control failed'
        }
        Write-Output 'CONTROL_OK=compile-error'

        $retryFixture = Join-Path $selfRoot 'retry-fixture.bin'
        $retryBytes = $utf8.GetBytes('retry-completed')
        $retryState = [pscustomobject]@{ Attempts = 0 }
        $syntheticTransientWriter = {
            param([string]$WritePath, [byte[]]$WriteBytes)
            $retryState.Attempts++
            if ($retryState.Attempts -lt 3) {
                throw [IO.IOException]::new(
                    'synthetic ERROR_USER_MAPPED_FILE',
                    -2147023672
                )
            }
            [IO.File]::WriteAllBytes($WritePath, $WriteBytes)
        }.GetNewClosure()
        Write-BytesWithTransientWindowsRetry -Path $retryFixture -Bytes $retryBytes `
            -MaxAttempts 3 -DelayMilliseconds 0 -WriteAction $syntheticTransientWriter
        if ($retryState.Attempts -ne 3 -or
            -not (Test-ByteExact $retryBytes ([IO.File]::ReadAllBytes($retryFixture)))) {
            throw 'transient Windows write retry control failed'
        }
        Write-Output 'CONTROL_OK=transient-windows-write-retry'

        $checker = [pscustomobject]@{
            Path = $fixture
            Anchor = 'checker-anchor'
            File = 'powershell.exe'
            Arguments = @(
                '-NoProfile', '-NonInteractive', '-Command',
                "Write-Output 'SYNTHETIC_ASSERTION_FAILED'; exit 1"
            )
            WorkingDirectory = '.'
            TimeoutSeconds = 30
            ExpectedFailurePattern = 'SYNTHETIC_ASSERTION_FAILED'
        }
        $synthetic = @(
            [pscustomobject]@{
                Id = 'SELFTEST_ALLOW'
                TargetPath = $fixture
                Target = 'ALLOW=false'
                Replacement = 'ALLOW=true'
                Checker = $checker
            },
            [pscustomobject]@{
                Id = 'SELFTEST_DENY'
                TargetPath = $fixture
                Target = 'DENY=false'
                Replacement = 'DENY=true'
                Checker = $checker
            }
        )
        $killed = 0
        foreach ($mutant in $synthetic) {
            $result = Invoke-OneMutant $mutant $selfRoot
            Write-Output ("SELFTEST_MUTANT={0} RESULT={1}" -f $result.id, $result.classification)
            if ($result.classification -ne 'Killed') {
                Get-Content -LiteralPath $result.log
            }
            if ($result.classification -eq 'Killed') { $killed++ }
        }
        if ($killed -ne 2) { throw "self-test mutation score was $killed/2" }
        if (-not (Test-ByteExact $original ([IO.File]::ReadAllBytes($fixture)))) {
            throw 'self-test fixture was not restored byte-exactly'
        }
        Write-Output 'BYTE_EXACT_RESTORE_OK'
        Write-Output 'MUTATION_SELF_TEST_OK=2/2'
    } finally {
        $lock.Dispose()
        Remove-SelfTestRoot $selfRoot
    }
}

$mutants = @(
    [pscustomobject]@{
        Id = 'M1_BYPASS_AUTHENTICATED_OWNER'
        TargetPath = 'backend\internal\execution\mt5_connector_handler.go'
        Target = 'ownerID := authenticatedUserID(c)'
        Replacement = 'ownerID := request.RequestID'
        Checker = [pscustomobject]@{
            Path = 'backend\bridge\mt5_vm\test_managed_safety_contracts.py'
            Anchor = 'test_connect_uses_authenticated_owner'
            File = 'python'
            Arguments = @('-m', 'unittest', 'backend.bridge.mt5_vm.test_managed_safety_contracts.ManagedSafetySourceContracts.test_connect_uses_authenticated_owner')
            WorkingDirectory = '.'
            TimeoutSeconds = 60
            ExpectedFailurePattern = 'FAIL: test_connect_uses_authenticated_owner'
        }
    },
    [pscustomobject]@{
        Id = 'M2_EXPOSE_PASSWORD'
        TargetPath = 'backend\internal\execution\mt5_connector_handler.go'
        Target = 'OwnerID: ownerID, AccountID: accountID, Label: strings.TrimSpace(request.Label),'
        Replacement = 'OwnerID: credential.Password, AccountID: accountID, Label: strings.TrimSpace(request.Label),'
        Checker = [pscustomobject]@{
            Path = 'backend\bridge\mt5_vm\test_managed_safety_contracts.py'
            Anchor = 'test_password_does_not_cross_the_gateway_boundary'
            File = 'python'
            Arguments = @('-m', 'unittest', 'backend.bridge.mt5_vm.test_managed_safety_contracts.ManagedSafetySourceContracts.test_password_does_not_cross_the_gateway_boundary')
            WorkingDirectory = '.'
            TimeoutSeconds = 60
            ExpectedFailurePattern = 'FAIL: test_password_does_not_cross_the_gateway_boundary'
        }
    },
    [pscustomobject]@{
        Id = 'M3_REUSE_CREDENTIAL_GRANT'
        TargetPath = 'backend\execution\crates\execution-gateway\src\mt5_vm_connections.rs'
        Target = "            AND credential_grant.status = 'issued'"
        Replacement = "            AND credential_grant.status <> 'consumed'"
        Checker = [pscustomobject]@{
            Path = 'backend\bridge\mt5_vm\test_managed_safety_contracts.py'
            Anchor = 'test_credential_grant_requires_issued_state'
            File = 'python'
            Arguments = @('-m', 'unittest', 'backend.bridge.mt5_vm.test_managed_safety_contracts.ManagedSafetySourceContracts.test_credential_grant_requires_issued_state')
            WorkingDirectory = '.'
            TimeoutSeconds = 60
            ExpectedFailurePattern = 'FAIL: test_credential_grant_requires_issued_state'
        }
    },
    [pscustomobject]@{
        Id = 'M4_IGNORE_LEASE_GENERATION'
        TargetPath = 'backend\execution\crates\mt5-vm-agent\src\managed.rs'
        Target = 'assignment.lease_generation == lease_generation'
        Replacement = 'true'
        Checker = [pscustomobject]@{
            Path = 'backend\bridge\mt5_vm\test_managed_safety_contracts.py'
            Anchor = 'test_slot_assignment_requires_matching_lease_generation'
            File = 'python'
            Arguments = @('-m', 'unittest', 'backend.bridge.mt5_vm.test_managed_safety_contracts.ManagedSafetySourceContracts.test_slot_assignment_requires_matching_lease_generation')
            WorkingDirectory = '.'
            TimeoutSeconds = 60
            ExpectedFailurePattern = 'FAIL: test_slot_assignment_requires_matching_lease_generation'
        }
    },
    [pscustomobject]@{
        Id = 'M5_ACCEPT_WRONG_PIPE_PID'
        TargetPath = 'backend\execution\crates\mt5-vm-agent\src\process.rs'
        Target = 'client_pid != 0 && client_pid == expected_terminal_pid && process_path_matches'
        Replacement = 'client_pid != 0 && process_path_matches'
        Checker = [pscustomobject]@{
            Path = 'backend\bridge\mt5_vm\test_managed_safety_contracts.py'
            Anchor = 'test_bootstrap_pipe_requires_exact_pid_and_path'
            File = 'python'
            Arguments = @('-m', 'unittest', 'backend.bridge.mt5_vm.test_managed_safety_contracts.ManagedSafetySourceContracts.test_bootstrap_pipe_requires_exact_pid_and_path')
            WorkingDirectory = '.'
            TimeoutSeconds = 60
            ExpectedFailurePattern = 'FAIL: test_bootstrap_pipe_requires_exact_pid_and_path'
        }
    },
    [pscustomobject]@{
        Id = 'M6_READY_BEFORE_FRESH_POLL'
        TargetPath = 'backend\migrations\0042_mt5_managed_ea_bootstrap.up.sql'
        Target = "p_poll_freshness_ms * interval '1 millisecond'"
        Replacement = "86400000 * interval '1 millisecond'"
        Checker = [pscustomobject]@{
            Path = 'backend\migrations\testdata\0042\assert_runtime_invariants.sql'
            Anchor = 'managed account became READY without a fresh successful EA poll'
            File = 'powershell.exe'
            Arguments = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', '.\tools\verify-migration-0042-disposable.ps1')
            WorkingDirectory = '.'
            TimeoutSeconds = 300
            ExpectedFailurePattern = 'managed account became READY without a fresh successful EA poll'
        }
    },
    [pscustomobject]@{
        Id = 'M7_RELEASE_DIRTY_SLOT'
        TargetPath = 'backend\execution\crates\mt5-vm-agent\src\process.rs'
        Target = 'cleanup_runtime_assignment(&self.config, account_id, &runtime.layout)?;'
        Replacement = 'let _ = cleanup_runtime_assignment(&self.config, account_id, &runtime.layout);'
        Checker = [pscustomobject]@{
            Path = 'backend\bridge\mt5_vm\test_managed_safety_contracts.py'
            Anchor = 'test_dirty_runtime_cleanup_precedes_slot_release'
            File = 'python'
            Arguments = @('-m', 'unittest', 'backend.bridge.mt5_vm.test_managed_safety_contracts.ManagedSafetySourceContracts.test_dirty_runtime_cleanup_precedes_slot_release')
            WorkingDirectory = '.'
            TimeoutSeconds = 60
            ExpectedFailurePattern = 'FAIL: test_dirty_runtime_cleanup_precedes_slot_release'
        }
    },
    [pscustomobject]@{
        Id = 'M8_RESEND_UNKNOWN_OUTCOME'
        TargetPath = 'backend\execution\crates\execution-gateway\src\main.rs'
        Target = "                      reject_code IS DISTINCT FROM 'DELIVERY_OUTCOME_UNKNOWN'"
        Replacement = '                      TRUE'
        Checker = [pscustomobject]@{
            Path = 'backend\bridge\mt5_vm\test_managed_safety_contracts.py'
            Anchor = 'test_unknown_delivery_outcome_is_not_expired_or_resent'
            File = 'python'
            Arguments = @('-m', 'unittest', 'backend.bridge.mt5_vm.test_managed_safety_contracts.ManagedSafetySourceContracts.test_unknown_delivery_outcome_is_not_expired_or_resent')
            WorkingDirectory = '.'
            TimeoutSeconds = 60
            ExpectedFailurePattern = 'FAIL: test_unknown_delivery_outcome_is_not_expired_or_resent'
        }
    }
)

if ($SelfTest) {
    Invoke-SelfTest
    exit 0
}
if (-not $Execute) {
    Write-Error $script:ExecutionRequired
    exit 2
}

New-Directory $runRoot
$repositoryLock = $null
$results = @()
$fatal = $null
try {
    $repositoryLock = New-RepositoryLock
    foreach ($mutant in $mutants) {
        try {
            $result = Invoke-OneMutant $mutant $runRoot
            $results += $result
            Write-Output ("MUTANT={0} RESULT={1}" -f $result.id, $result.classification)
        } catch {
            $fatal = $_
            $results += [pscustomobject]@{
                id = $mutant.Id
                classification = 'Blocked'
                checker_exit = -1
                log = $null
            }
            break
        }
    }
} catch {
    $fatal = $_
} finally {
    if ($null -ne $repositoryLock) { $repositoryLock.Dispose() }
}

$killed = @($results | Where-Object { $_.classification -eq 'Killed' }).Count
$survivors = @($results | Where-Object { $_.classification -eq 'Survived' }).Count
$infrastructure = @($results | Where-Object { $_.classification -eq 'InfrastructureFailure' }).Count
$blocked = @($results | Where-Object { $_.classification -eq 'Blocked' }).Count
[pscustomobject]@{
    gate = 'mt5-baremetal-managed-ea-mutation'
    status = if ($killed -eq $mutants.Count) { 'PASS' } else { 'FAIL' }
    killed = $killed
    total = $mutants.Count
    survived = $survivors
    infrastructure_failures = $infrastructure
    blocked = $blocked
    fatal = if ($null -eq $fatal) { $null } else { $fatal.Exception.Message }
    results = $results
} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $runRoot 'summary.json') -Encoding UTF8

if ($null -ne $fatal -or $blocked -gt 0) {
    Write-Error ("$($script:Blocked): " + $(if ($null -eq $fatal) { 'mutation setup failed' } else { $fatal.Exception.Message }))
    exit 1
}
if ($infrastructure -gt 0) {
    Write-Error "$($script:Infrastructure): $infrastructure mutant checker(s)"
    exit 1
}
if ($survivors -gt 0) {
    Write-Error "$($script:Survived): $survivors mutant(s)"
    exit 1
}
if ($killed -ne $mutants.Count) {
    Write-Error "$($script:Blocked): incomplete mutation result $killed/$($mutants.Count)"
    exit 1
}

Write-Output "MUTATION_SCORE=$killed/$($mutants.Count)"
exit 0
