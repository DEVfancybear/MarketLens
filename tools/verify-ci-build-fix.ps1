[CmdletBinding()]
param(
    [switch]$SelfTest
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$frontendRoot = Join-Path $repositoryRoot 'frontend'
$backendRoot = Join-Path $repositoryRoot 'backend'
$executionRoot = Join-Path $backendRoot 'execution'
$allowedPaths = @(
    'backend/execution/crates/mt5-vm-agent/tests/managed_worker_cli.rs',
    'docs/agent-evidence/ci-build-fix/EVIDENCE.md',
    'docs/agent-evidence/ci-build-fix/SPEC.md',
    'frontend/tests/api/mt5VmPhase2Operational.spec.ts',
    'frontend/tsconfig.test.json',
    'tools/verify-ci-build-fix.ps1'
)

function Invoke-NativeStep {
    param(
        [Parameter(Mandatory)]
        [string]$Name,

        [Parameter(Mandatory)]
        [string]$WorkingDirectory,

        [Parameter(Mandatory)]
        [string]$FilePath,

        [Parameter(Mandatory)]
        [string[]]$Arguments
    )

    Write-Output "STEP: $Name"
    Push-Location -LiteralPath $WorkingDirectory
    try {
        & $FilePath @Arguments
        $exitCode = $LASTEXITCODE
        if ($exitCode -ne 0) {
            throw "$Name failed with exit code $exitCode"
        }
    }
    finally {
        Pop-Location
    }
}

function Get-UnexpectedStatusPaths {
    param(
        [Parameter(Mandatory)]
        [string[]]$StatusLines
    )

    $paths = foreach ($line in $StatusLines) {
        if ($line.Length -lt 4) {
            throw "Malformed git status line: $line"
        }
        $path = $line.Substring(3)
        if ($path.Contains(' -> ')) {
            throw "Renamed paths are not permitted by this gauntlet: $line"
        }
        $path
    }
    return @($paths | Where-Object { $_ -notin $allowedPaths })
}

function Invoke-GauntletSelfTest {
    $shellPath = (Get-Process -Id $PID).Path
    $observedExpectedFailure = $false
    try {
        Invoke-NativeStep `
            -Name 'known-bad exit-code control' `
            -WorkingDirectory $repositoryRoot `
            -FilePath $shellPath `
            -Arguments @('-NoProfile', '-Command', 'exit 23')
    }
    catch {
        if ($_.Exception.Message -notlike '*exit code 23*') {
            throw
        }
        $observedExpectedFailure = $true
    }
    if (-not $observedExpectedFailure) {
        throw 'Self-test failed: native command exit 23 was accepted.'
    }

    $knownGood = @(' M frontend/tsconfig.test.json')
    $knownGoodUnexpected = @(Get-UnexpectedStatusPaths -StatusLines $knownGood)
    if ($knownGoodUnexpected.Count -ne 0) {
        throw 'Self-test failed: the known-good allowlist entry was rejected.'
    }
    $knownBad = @(' M frontend/tsconfig.test.json', '?? unexpected.txt')
    $unexpected = @(Get-UnexpectedStatusPaths -StatusLines $knownBad)
    if ($unexpected.Count -ne 1 -or $unexpected[0] -ne 'unexpected.txt') {
        throw 'Self-test failed: the known-bad allowlist entry did not reach the failure path.'
    }

    Write-Output 'PASS: command failure propagation rejected exit code 23.'
    Write-Output 'PASS: file allowlist accepted known-good and rejected known-bad input.'
}

Invoke-GauntletSelfTest
if ($SelfTest) {
    exit 0
}

Invoke-NativeStep -Name 'frontend locked install' -WorkingDirectory $frontendRoot -FilePath 'npm' -Arguments @('ci')
Invoke-NativeStep -Name 'frontend replay client boundary' -WorkingDirectory $frontendRoot -FilePath 'npm' -Arguments @('run', 'check:replay-client-boundary')
Invoke-NativeStep -Name 'frontend replay tests' -WorkingDirectory $frontendRoot -FilePath 'npm' -Arguments @('run', 'test:replay')
Invoke-NativeStep -Name 'frontend trade tests' -WorkingDirectory $frontendRoot -FilePath 'npm' -Arguments @('run', 'test:trade')
Invoke-NativeStep -Name 'frontend typecheck' -WorkingDirectory $frontendRoot -FilePath 'npm' -Arguments @('run', 'typecheck')
Invoke-NativeStep -Name 'frontend lint' -WorkingDirectory $frontendRoot -FilePath 'npm' -Arguments @('run', 'lint')
Invoke-NativeStep -Name 'frontend production build' -WorkingDirectory $frontendRoot -FilePath 'npm' -Arguments @('run', 'build')

Invoke-NativeStep -Name 'Go tests' -WorkingDirectory $backendRoot -FilePath 'go' -Arguments @('test', './...')
Invoke-NativeStep -Name 'Go vet' -WorkingDirectory $backendRoot -FilePath 'go' -Arguments @('vet', './...')

Invoke-NativeStep -Name 'Rust format' -WorkingDirectory $executionRoot -FilePath 'cargo' -Arguments @('fmt', '--all', '--', '--check')

if ($env:OS -eq 'Windows_NT') {
    Write-Output 'SKIP: Rust clippy build scripts are blocked by Windows Application Control; GitHub Ubuntu clippy is mandatory.'
    Invoke-NativeStep -Name 'Rust workspace tests excluding the agent executable' -WorkingDirectory $executionRoot -FilePath 'cargo' -Arguments @('test', '--locked', '--workspace', '--all-targets', '--exclude', 'mt5-vm-agent')
    Invoke-NativeStep -Name 'Rust agent library tests' -WorkingDirectory $executionRoot -FilePath 'cargo' -Arguments @('test', '--locked', '-p', 'mt5-vm-agent', '--lib')
    Invoke-NativeStep -Name 'Rust managed command tests' -WorkingDirectory $executionRoot -FilePath 'cargo' -Arguments @('test', '--locked', '-p', 'mt5-vm-agent', '--test', 'managed_commands')
    Invoke-NativeStep -Name 'Rust managed control tests' -WorkingDirectory $executionRoot -FilePath 'cargo' -Arguments @('test', '--locked', '-p', 'mt5-vm-agent', '--test', 'managed_control')
    Invoke-NativeStep -Name 'Rust managed CLI compile' -WorkingDirectory $executionRoot -FilePath 'cargo' -Arguments @('test', '--locked', '-p', 'mt5-vm-agent', '--test', 'managed_worker_cli', '--no-run')
    Write-Output 'SKIP: managed_worker_cli execution is blocked by Windows Application Control; GitHub Ubuntu all-targets execution is mandatory.'
}
else {
    Invoke-NativeStep -Name 'Rust clippy' -WorkingDirectory $executionRoot -FilePath 'cargo' -Arguments @('clippy', '--locked', '--workspace', '--all-targets', '--', '-D', 'warnings')
    Invoke-NativeStep -Name 'Rust exact CI all-target tests' -WorkingDirectory $executionRoot -FilePath 'cargo' -Arguments @('test', '--locked', '--workspace', '--all-targets')
}

Invoke-NativeStep -Name 'Git diff whitespace check' -WorkingDirectory $repositoryRoot -FilePath 'git' -Arguments @('diff', '--check')
$statusLines = @(& git -C $repositoryRoot status --short --untracked-files=all)
if ($LASTEXITCODE -ne 0) {
    throw "git status failed with exit code $LASTEXITCODE"
}
$unexpectedPaths = @(Get-UnexpectedStatusPaths -StatusLines $statusLines)
if ($unexpectedPaths.Count -gt 0) {
    throw "Working tree contains paths outside the approved allowlist: $($unexpectedPaths -join '; ')"
}

Write-Output 'PASS: CI build-fix gauntlet completed.'
