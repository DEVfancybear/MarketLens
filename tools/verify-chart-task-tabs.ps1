[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$backendRoot = Join-Path $repoRoot "backend"
$frontendRoot = Join-Path $repoRoot "frontend"
$goCoverage = Join-Path $repoRoot "docs\agent-evidence\chart-task-tabs\chart-task-tabs-go-cover.out"

function Invoke-Step {
    param(
        [Parameter(Mandatory)] [string] $Name,
        [Parameter(Mandatory)] [string] $WorkingDirectory,
        [Parameter(Mandatory)] [scriptblock] $Command
    )
    Write-Host "`n== $Name ==" -ForegroundColor Cyan
    Push-Location $WorkingDirectory
    try {
        & $Command
        if ($LASTEXITCODE -ne 0) {
            throw "$Name failed with exit code $LASTEXITCODE"
        }
    }
    finally {
        Pop-Location
    }
}

Write-Host "Chart task tabs Tier 3 gauntlet" -ForegroundColor Cyan
Write-Host "Source: $(git -C $repoRoot rev-parse HEAD)"

Invoke-Step -Name "Patch whitespace" -WorkingDirectory $repoRoot -Command {
    git diff --check
}

$goFiles = @(
    "backend\internal\settings\chart_task_tabs.go",
    "backend\internal\settings\chart_task_tabs_repo_integration_test.go",
    "backend\internal\settings\handler.go",
    "backend\internal\settings\handler_test.go",
    "backend\internal\settings\model_test.go"
)
$unformatted = @(& gofmt -l ($goFiles | ForEach-Object { Join-Path $repoRoot $_ }))
if ($LASTEXITCODE -ne 0 -or $unformatted.Count -gt 0) {
    throw "gofmt check failed: $($unformatted -join ', ')"
}

Invoke-Step -Name "Backend full tests" -WorkingDirectory $backendRoot -Command {
    # Several execution handler tests deliberately use one-second local-server
    # deadlines. Serialize packages so a cold Windows build cannot consume the
    # deadline through unrelated package contention.
    go test -p 1 ./... -count=1
}

Invoke-Step -Name "Backend task-tab integration discovery" -WorkingDirectory $backendRoot -Command {
    go test ./internal/settings -run TestChartTaskTabsRepoSerializesCompetingRevisions -count=1 -v
}

$cgoEnabled = ((go env CGO_ENABLED) | Out-String).Trim() -eq "1"
$gcc = Get-Command gcc -ErrorAction SilentlyContinue
if ($cgoEnabled -and $gcc) {
    Invoke-Step -Name "Backend race detector" -WorkingDirectory $backendRoot -Command {
        go test -p 1 ./... -race -count=1
    }
}
else {
    Write-Warning "UNVERIFIED: go test ./... -race requires CGO_ENABLED=1 and gcc; current host does not provide both"
}

Invoke-Step -Name "Backend vet" -WorkingDirectory $backendRoot -Command {
    go vet ./...
}
Invoke-Step -Name "Backend build" -WorkingDirectory $backendRoot -Command {
    go build ./...
}

if (Test-Path -LiteralPath $goCoverage) {
    Remove-Item -LiteralPath $goCoverage
}
Invoke-Step -Name "Backend focused coverage" -WorkingDirectory $backendRoot -Command {
    go test ./internal/settings "-coverprofile=$goCoverage" -count=1
}
Push-Location $backendRoot
try {
    $goCoverageOutput = & go tool cover "-func=$goCoverage"
    if ($LASTEXITCODE -ne 0) { throw "go tool cover failed" }
}
finally {
    Pop-Location
}
$totalLine = $goCoverageOutput | Select-String '^total:' | Select-Object -Last 1
if (-not $totalLine -or $totalLine.Line -notmatch '([0-9]+(?:\.[0-9]+)?)%$') {
    throw "Could not parse Go package coverage"
}
if ([double]$Matches[1] -lt 60) {
    throw "Go settings coverage $($Matches[1])% is below 60%"
}
foreach ($functionName in @(
    "ValidateChartTaskTabsDocument",
    "ChartTaskTabsFromDocument",
    "ApplyChartTaskTabsWrite",
    "validChartTaskID",
    "validJSONObject",
    "cloneChartTaskTabs"
)) {
    $line = $goCoverageOutput | Select-String "\s$functionName\s+([0-9]+(?:\.[0-9]+)?)%" | Select-Object -First 1
    if (-not $line -or $line.Line -notmatch "\s$functionName\s+([0-9]+(?:\.[0-9]+)?)%") {
        throw "Missing coverage result for $functionName"
    }
    if ([double]$Matches[1] -lt 70) {
        throw "$functionName coverage $($Matches[1])% is below 70%"
    }
}

Invoke-Step -Name "Frontend test compilation" -WorkingDirectory $frontendRoot -Command {
    npm.cmd run test:build
}
Invoke-Step -Name "Frontend all compiled tests" -WorkingDirectory $frontendRoot -Command {
    node --test .test-build/tests/**/*.test.js
}

Write-Host "`n== Frontend focused coverage ==" -ForegroundColor Cyan
Push-Location $frontendRoot
try {
    $nodeCoverage = & node --experimental-test-coverage --test `
        .test-build/tests/chart/chartTaskTabsStore.test.js `
        .test-build/tests/chart/chartTaskTabsSyncQueue.test.js 2>&1
    $nodeExit = $LASTEXITCODE
    $nodeCoverage | Out-Host
    if ($nodeExit -ne 0) { throw "Frontend focused coverage tests failed" }
    foreach ($fileName in @("chartTaskTabsStore.js", "chartTaskTabsSyncQueue.js")) {
        $line = $nodeCoverage | Select-String "\s$fileName\s+\|\s+([0-9]+(?:\.[0-9]+)?)" | Select-Object -First 1
        if (-not $line -or $line.Line -notmatch "\s$fileName\s+\|\s+([0-9]+(?:\.[0-9]+)?)") {
            throw "Missing Node line coverage for $fileName"
        }
        if ([double]$Matches[1] -lt 90) {
            throw "$fileName line coverage $($Matches[1])% is below 90%"
        }
    }
}
finally {
    Pop-Location
}

Invoke-Step -Name "Frontend typecheck" -WorkingDirectory $frontendRoot -Command {
    npm.cmd run typecheck
}
Invoke-Step -Name "Frontend lint" -WorkingDirectory $frontendRoot -Command {
    npm.cmd run lint
}
Invoke-Step -Name "Frontend production build" -WorkingDirectory $frontendRoot -Command {
    npm.cmd run build
}
Invoke-Step -Name "Chart task tabs browser tests" -WorkingDirectory $frontendRoot -Command {
    npx.cmd playwright test tests/browser/chartTaskTabs.spec.ts
}
Invoke-Step -Name "Existing chart layout browser regression" -WorkingDirectory $frontendRoot -Command {
    npx.cmd playwright test tests/browser/chartLayoutWorkspace.spec.ts
}

Invoke-Step -Name "Mutation gauntlet" -WorkingDirectory $repoRoot -Command {
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\verify-chart-task-tabs-mutations.ps1
}

for ($iteration = 1; $iteration -le 2; $iteration++) {
    Invoke-Step -Name "Focused repeat $iteration" -WorkingDirectory $frontendRoot -Command {
        node --test .test-build/tests/chart/chartTaskTabsStore.test.js .test-build/tests/chart/chartTaskTabsSyncQueue.test.js
    }
}

$dependencyDiff = @(git -C $repoRoot diff --name-only -- frontend/package.json frontend/package-lock.json backend/go.mod backend/go.sum)
if ($dependencyDiff.Count -gt 0) {
    throw "Unexpected dependency manifest changes: $($dependencyDiff -join ', ')"
}

$changedFiles = @(
    git -C $repoRoot status --short |
        ForEach-Object { $_.Substring(3).Trim('"') } |
        Where-Object { $_ -and (Test-Path -LiteralPath (Join-Path $repoRoot $_)) }
)
$secretPattern = '(?i)(BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|AIza[0-9A-Za-z_-]{20,}|gh[pousr]_[0-9A-Za-z]{20,}|sk-[0-9A-Za-z]{20,})'
foreach ($relativePath in $changedFiles) {
    $fullPath = Join-Path $repoRoot $relativePath
    if ((Get-Item -LiteralPath $fullPath).PSIsContainer) { continue }
    $content = [IO.File]::ReadAllText($fullPath)
    if ($content -match $secretPattern) {
        throw "Secret-pattern scan found a possible credential in $relativePath"
    }
}

Invoke-Step -Name "Post-mutation patch integrity" -WorkingDirectory $repoRoot -Command {
    git diff --check
}

Write-Host "`nCHART_TASK_TABS_GAUNTLET_OK" -ForegroundColor Green
