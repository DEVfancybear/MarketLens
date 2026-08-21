[CmdletBinding()]
param(
    [switch]$SelfTest,
    [string]$AgentsPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$requiredMarkers = @(
    '## Mandatory old-coder evidence-first workflow',
    'Every coding agent and subagent working in this repository must invoke the globally installed',
    'Obtain explicit approval of that exact SPEC before implementation.',
    'Use RED -> GREEN -> REFACTOR for behavioral changes.',
    'A failing gauntlet blocks completion, commit, and push',
    'codebase-memory governs discovery, old-coder governs specification/TDD/evidence',
    'must pass the approved SPEC path, selected old-coder tier, required gauntlet layers'
)

$forbiddenMarkers = @(
    'playwright-automation',
    '## Mandatory Playwright automation',
    'mandatory Playwright route',
    'Playwright requirements are cumulative'
)

function Get-MissingPolicyMarkers {
    param(
        [Parameter(Mandatory)]
        [string]$Content
    )

    return @($requiredMarkers | Where-Object { -not $Content.Contains($_) })
}

function Get-ForbiddenPolicyMarkers {
    param(
        [Parameter(Mandatory)]
        [string]$Content
    )

    return @($forbiddenMarkers | Where-Object { $Content.Contains($_) })
}

function Invoke-PolicyCheckerSelfTest {
    $knownGood = $requiredMarkers -join [Environment]::NewLine
    $goodMissing = @(Get-MissingPolicyMarkers -Content $knownGood)
    $goodForbidden = @(Get-ForbiddenPolicyMarkers -Content $knownGood)
    if ($goodMissing.Count -ne 0 -or $goodForbidden.Count -ne 0) {
        throw "Self-test failed: known-good policy was rejected. Missing: $($goodMissing -join ', '); forbidden: $($goodForbidden -join ', ')"
    }

    $knownBadMissing = $requiredMarkers[1..($requiredMarkers.Count - 1)] -join [Environment]::NewLine
    $badMissing = @(Get-MissingPolicyMarkers -Content $knownBadMissing)
    if ($badMissing.Count -ne 1 -or $badMissing[0] -ne $requiredMarkers[0]) {
        throw 'Self-test failed: known-bad missing-marker policy did not reach the expected failure path.'
    }

    $knownBadForbidden = $knownGood + [Environment]::NewLine + $forbiddenMarkers[0]
    $badForbidden = @(Get-ForbiddenPolicyMarkers -Content $knownBadForbidden)
    if ($badForbidden.Count -ne 1 -or $badForbidden[0] -ne $forbiddenMarkers[0]) {
        throw 'Self-test failed: known-bad forbidden-marker policy did not reach the expected failure path.'
    }

    Write-Output 'PASS: known-good policy accepted.'
    Write-Output 'PASS: missing required marker rejected through the expected failure path.'
    Write-Output 'PASS: forbidden Playwright policy marker rejected through the expected failure path.'
}

function Get-PolicySourceState {
    param(
        [Parameter(Mandatory)]
        [string]$RepositoryRoot
    )

    $sourceFiles = @(
        'AGENTS.md',
        'docs/agent-evidence/old-coder-policy/SPEC.md',
        'tools/verify-old-coder-policy.ps1'
    )
    $manifestLines = foreach ($relativePath in $sourceFiles) {
        $absolutePath = Join-Path $RepositoryRoot $relativePath
        if (-not (Test-Path -LiteralPath $absolutePath -PathType Leaf)) {
            throw "Policy source file not found: $absolutePath"
        }
        $fileHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $absolutePath).Hash.ToLowerInvariant()
        "$relativePath`t$fileHash"
    }

    $manifest = ($manifestLines -join "`n") + "`n"
    $hasher = [Security.Cryptography.SHA256]::Create()
    try {
        $hashBytes = $hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($manifest))
        return ([BitConverter]::ToString($hashBytes)).Replace('-', '').ToLowerInvariant()
    }
    finally {
        $hasher.Dispose()
    }
}

Invoke-PolicyCheckerSelfTest
if ($SelfTest) {
    exit 0
}

$repositoryRoot = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($AgentsPath)) {
    $AgentsPath = Join-Path $repositoryRoot 'AGENTS.md'
}

if (-not (Test-Path -LiteralPath $AgentsPath -PathType Leaf)) {
    throw "AGENTS policy file not found: $AgentsPath"
}

$agentsContent = Get-Content -Raw -LiteralPath $AgentsPath
$missingMarkers = @(Get-MissingPolicyMarkers -Content $agentsContent)
if ($missingMarkers.Count -gt 0) {
    throw "AGENTS policy is missing required markers: $($missingMarkers -join '; ')"
}
$presentForbiddenMarkers = @(Get-ForbiddenPolicyMarkers -Content $agentsContent)
if ($presentForbiddenMarkers.Count -gt 0) {
    throw "AGENTS policy contains forbidden Playwright markers: $($presentForbiddenMarkers -join '; ')"
}

$userProfilePath = $env:USERPROFILE
if ([string]::IsNullOrWhiteSpace($userProfilePath)) {
    $userProfilePath = [Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile)
}
$skillRoot = Join-Path $userProfilePath '.codex\skills\old-coder'
$requiredSkillFiles = @(
    (Join-Path $skillRoot 'SKILL.md'),
    (Join-Path $skillRoot 'references\gauntlet.md')
)
$missingSkillFiles = @($requiredSkillFiles | Where-Object { -not (Test-Path -LiteralPath $_ -PathType Leaf) })
if ($missingSkillFiles.Count -gt 0) {
    throw "Installed old-coder skill is incomplete: $($missingSkillFiles -join '; ')"
}

Write-Output "PASS: all $($requiredMarkers.Count) mandatory AGENTS policy markers are present."
Write-Output "PASS: all $($forbiddenMarkers.Count) forbidden Playwright policy markers are absent."
Write-Output "PASS: old-coder SKILL.md and references/gauntlet.md are installed under $skillRoot."
Write-Output "SOURCE_STATE_SHA256: $(Get-PolicySourceState -RepositoryRoot $repositoryRoot)"
