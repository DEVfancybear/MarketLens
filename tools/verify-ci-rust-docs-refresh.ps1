param(
    [switch]$DocsOnly,
    [switch]$NegativeControl,
    [ValidateRange(1, 200)]
    [int]$StressIterations = 50
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$rustRoot = Join-Path $repoRoot 'backend\execution'
$failures = New-Object 'System.Collections.Generic.List[string]'
$passes = New-Object 'System.Collections.Generic.List[string]'

function Read-Utf8File([string]$RelativePath) {
    $path = Join-Path $repoRoot $RelativePath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Required file is missing: $RelativePath"
    }
    return Get-Content -LiteralPath $path -Encoding UTF8 -Raw
}

function Check([string]$Name, [bool]$Condition) {
    if ($Condition) {
        $passes.Add($Name)
    } else {
        $failures.Add($Name)
    }
}

function Check-MarkdownLinks([string]$RelativePath, [string]$Content) {
    $filePath = Join-Path $repoRoot $RelativePath
    $directory = Split-Path -Parent $filePath
    foreach ($match in [regex]::Matches($Content, '\[[^\]]*\]\(([^)]+)\)')) {
        $target = $match.Groups[1].Value.Trim()
        if ($target -match '^(https?://|mailto:|#)') {
            continue
        }
        $pathPart = ($target -split '#', 2)[0]
        if ([string]::IsNullOrWhiteSpace($pathPart)) {
            continue
        }
        try {
            $pathPart = [Uri]::UnescapeDataString($pathPart)
            $resolved = [IO.Path]::GetFullPath((Join-Path $directory $pathPart))
            Check "$RelativePath link exists: $target" (Test-Path -LiteralPath $resolved)
        } catch {
            $failures.Add("$RelativePath link is readable: $target")
        }
    }
}

function Invoke-Checked([string]$Name, [scriptblock]$Command) {
    $previousErrorAction = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = & $Command 2>&1
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousErrorAction
    }
    if ($exitCode -ne 0) {
        $output | ForEach-Object { Write-Host $_ }
        throw "$Name failed with exit code $exitCode."
    }
    Write-Host "PASS: $Name"
}

$maintainedDocs = @(
    'docs/README.md',
    'docs/CURRENT_STATE.md',
    'docs/CURRENT_PROGRESS.md',
    'docs/HANDOFF.md',
    'docs/NEXT_TASKS.md',
    'docs/KNOWN_ISSUES.md',
    'docs/PROJECT_STRUCTURE.md',
    'frontend/docs/README.md'
)
$contents = @{}
foreach ($path in $maintainedDocs) {
    $contents[$path] = Read-Utf8File $path
    Check "$path has current verification date" ($contents[$path] -match '2026-08-24')
    Check-MarkdownLinks $path $contents[$path]
}

$allDocumentation = @(
    Get-ChildItem -LiteralPath (Join-Path $repoRoot 'docs') -Recurse -File -Filter '*.md' |
        Where-Object { $_.FullName -notmatch '\\agent-evidence\\' }
    Get-ChildItem -LiteralPath (Join-Path $repoRoot 'frontend\docs') -Recurse -File -Filter '*.md'
)
foreach ($file in $allDocumentation) {
    $relative = $file.FullName.Substring($repoRoot.Length + 1)
    $content = Get-Content -LiteralPath $file.FullName -Encoding UTF8 -Raw
    Check-MarkdownLinks $relative $content
}
Check 'documentation audit covers root and frontend docs' ($allDocumentation.Count -ge 130)

$frontendPackage = (Read-Utf8File 'frontend/package.json') | ConvertFrom-Json
$nextVersion = [string]$frontendPackage.dependencies.next
$reactVersion = [string]$frontendPackage.dependencies.react
$chartsVersion = [string]$frontendPackage.dependencies.'lightweight-charts'
$typescriptVersion = ([string]$frontendPackage.devDependencies.typescript) -replace '^.*@', ''
$frontendIndex = [string]$contents['frontend/docs/README.md']
if ($NegativeControl) {
    $frontendIndex += "`n| ``MT5_BRIDGE_PROTOCOL.md`` | stale deleted document |`n"
}

foreach ($version in @($nextVersion, $reactVersion, $typescriptVersion, $chartsVersion)) {
    Check "frontend docs index records manifest version $version" ($frontendIndex.Contains($version))
}
$frontendReadme = Read-Utf8File 'frontend/README.md'
foreach ($version in @($nextVersion, $reactVersion, $typescriptVersion, $chartsVersion)) {
    Check "frontend README records manifest version $version" ($frontendReadme.Contains($version))
}

$deletedFrontendDocs = @(
    'INTEGRATION_SETTINGS.md',
    'MT5_BRIDGE_PROTOCOL.md',
    'MT5_POSITION_SIZING.md',
    'PHASE6_IMPLEMENTATION_PLAN.md',
    'PHASE6B_MT5_BRIDGE_PLAN.md',
    'PHASE6B_FTMO_COPY_TRADING_PLAN.md'
)
foreach ($deleted in $deletedFrontendDocs) {
    Check "frontend docs index omits deleted $deleted" (-not $frontendIndex.Contains($deleted))
}

foreach ($path in @(
    'backend/cmd/api',
    'backend/cmd/migrate',
    'backend/cmd/mt5-stream',
    'backend/execution/crates/execution-gateway',
    'backend/execution/crates/mt5-vm-agent',
    'backend/bridge/mt5_ea',
    'backend/bridge/mt5_session',
    'backend/bridge/mt5_stream',
    'backend/bridge/mt5_vm'
)) {
    Check "documented repository path exists: $path" (Test-Path -LiteralPath (Join-Path $repoRoot $path))
}
Check 'project structure omits deleted ftmo_mt5 tree entry' (-not $contents['docs/PROJECT_STRUCTURE.md'].Contains('|-- ftmo_mt5/'))
Check 'current state names canonical GitHub repository' ($contents['docs/CURRENT_STATE.md'].Contains('github.com/DEVfancybear/MarketLens'))
Check 'handoff names source-build production runner' ($contents['docs/HANDOFF.md'].Contains('run-backend-production.ps1'))
Check 'handoff names artifact deployment runner' ($contents['docs/HANDOFF.md'].Contains('tools/deploy-backend.ps1'))
Check 'frontend README no longer names Lightweight Charts 4.2.3' (-not $frontendReadme.Contains('Lightweight Charts 4.2.3'))

Write-Host "Documentation verification: $($passes.Count) passed, $($failures.Count) failed"
foreach ($failure in $failures) {
    Write-Host "FAIL: $failure"
}
if ($failures.Count -ne 0) {
    exit 1
}
if ($NegativeControl) {
    throw 'Negative control did not reach the documentation checker failure path.'
}
if ($DocsOnly) {
    Write-Host 'PASS: maintained documentation matches manifests, current paths, and link targets.'
    exit 0
}

Push-Location $rustRoot
try {
    Invoke-Checked 'cargo fmt' { cargo fmt --all -- --check }
    Invoke-Checked 'scripted response regression tests' {
        cargo test --locked -p mt5-vm-agent --test managed_commands scripted_response_ -- --test-threads=1
    }

    for ($iteration = 1; $iteration -le $StressIterations; $iteration++) {
        $previousErrorAction = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
            $output = & cargo test --quiet --locked -p mt5-vm-agent --test managed_commands parallel_command_validation_and_received_ack_fail_closed_before_runtime -- --exact --test-threads=1 2>&1
            $stressExitCode = $LASTEXITCODE
        } finally {
            $ErrorActionPreference = $previousErrorAction
        }
        if ($stressExitCode -ne 0) {
            $output | ForEach-Object { Write-Host $_ }
            throw "Rust disconnect regression failed at stress iteration $iteration/$StressIterations."
        }
        if (($iteration % 10) -eq 0 -or $iteration -eq $StressIterations) {
            Write-Host "PASS: Rust disconnect regression stress $iteration/$StressIterations"
        }
    }

    for ($iteration = 1; $iteration -le $StressIterations; $iteration++) {
        $previousErrorAction = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
            $output = & cargo test --quiet --locked -p execution-gateway --bin execution-gateway builds_production_state -- --test-threads=2 2>&1
            $envStressExitCode = $LASTEXITCODE
        } finally {
            $ErrorActionPreference = $previousErrorAction
        }
        if ($envStressExitCode -ne 0) {
            $output | ForEach-Object { Write-Host $_ }
            throw "Execution gateway environment regression failed at stress iteration $iteration/$StressIterations."
        }
        if (($iteration % 10) -eq 0 -or $iteration -eq $StressIterations) {
            Write-Host "PASS: execution gateway environment stress $iteration/$StressIterations"
        }
    }

    if ([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT) {
        Invoke-Checked 'cargo test workspace all targets (Windows single-thread)' {
            cargo test --locked --workspace --all-targets -- --test-threads=1
        }
        Invoke-Checked 'cargo test managed agent library (exact Windows CI gate)' {
            cargo test --locked -p mt5-vm-agent --lib -- --test-threads=1
        }
    } else {
        Invoke-Checked 'cargo test workspace all targets' {
            cargo test --locked --workspace --all-targets
        }
    }
    Invoke-Checked 'cargo check workspace all targets' { cargo check --locked --workspace --all-targets }
    Invoke-Checked 'cargo clippy workspace all targets' { cargo clippy --locked --workspace --all-targets }
} finally {
    Pop-Location
}

Invoke-Checked 'manual Rust mutation runner' {
    powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $repoRoot 'tools\verify-ci-rust-scripted-server-mutations.ps1')
}

Push-Location $repoRoot
try {
    Invoke-Checked 'git diff check' { git diff --check }
    $diffText = git diff -- . ':!*.zst'
    $secretPattern = '(?im)BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*["''][^"'']{8,}["'']'
    if ([regex]::Matches(($diffText -join "`n"), $secretPattern).Count -ne 0) {
        throw 'Secret-like assignment found in the working diff.'
    }
    Write-Host 'PASS: diff secret scan'
} finally {
    Pop-Location
}

Write-Host "PASS: complete CI/docs gauntlet with $StressIterations consecutive regression iterations."
