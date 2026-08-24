[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

function Get-ByteHash {
    param([Parameter(Mandatory)] [byte[]] $Bytes)
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        return ([BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace("-", "")
    }
    finally {
        $sha.Dispose()
    }
}

function Invoke-Mutation {
    param(
        [Parameter(Mandatory)] [string] $Name,
        [Parameter(Mandatory)] [string] $RelativePath,
        [Parameter(Mandatory)] [string] $From,
        [Parameter(Mandatory)] [string] $To,
        [Parameter(Mandatory)] [string] $WorkingDirectory,
        [Parameter(Mandatory)] [scriptblock] $TestCommand
    )

    $path = (Resolve-Path -LiteralPath (Join-Path $repoRoot $RelativePath)).Path
    if (-not $path.StartsWith($repoRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Mutation target escaped repository: $path"
    }
    $originalBytes = [IO.File]::ReadAllBytes($path)
    $originalHash = Get-ByteHash $originalBytes
    try {
        $source = [Text.Encoding]::UTF8.GetString($originalBytes)
        $matches = ([regex]::Matches($source, [regex]::Escape($From))).Count
        if ($matches -ne 1) {
            throw "Mutation '$Name' expected one source match in $RelativePath, found $matches"
        }
        $mutated = $source.Replace($From, $To)
        [IO.File]::WriteAllText($path, $mutated, [Text.UTF8Encoding]::new($false))
        if ([IO.File]::ReadAllText($path) -notlike "*$To*") {
            throw "Mutation '$Name' was not applied"
        }

        Write-Host "MUTANT APPLIED: $Name" -ForegroundColor Yellow
        Push-Location (Join-Path $repoRoot $WorkingDirectory)
        try {
            & $TestCommand
            $exitCode = $LASTEXITCODE
        }
        finally {
            Pop-Location
        }
        if ($exitCode -eq 0) {
            throw "SURVIVED MUTANT: $Name"
        }
        Write-Host "MUTANT KILLED: $Name" -ForegroundColor Green
    }
    finally {
        [IO.File]::WriteAllBytes($path, $originalBytes)
        $restoredBytes = [IO.File]::ReadAllBytes($path)
        $restoredHash = Get-ByteHash $restoredBytes
        if ($restoredHash -ne $originalHash) {
            throw "Mutation restore hash mismatch for $RelativePath"
        }
    }
}

Invoke-Mutation `
    -Name "backend task cap" `
    -RelativePath "backend\internal\settings\chart_task_tabs.go" `
    -From "maxChartTasks                 = 12" `
    -To "maxChartTasks                 = 1" `
    -WorkingDirectory "backend" `
    -TestCommand { go test ./internal/settings -run TestChartTaskTabsGeneratedDocumentsRespectBounds -count=1 }

Invoke-Mutation `
    -Name "backend stale revision comparator" `
    -RelativePath "backend\internal\settings\chart_task_tabs.go" `
    -From "input.ExpectedRevision != current.Revision" `
    -To "input.ExpectedRevision == current.Revision" `
    -WorkingDirectory "backend" `
    -TestCommand { go test ./internal/settings -run TestChartTaskTabsRejectsStaleRevision -count=1 }

Invoke-Mutation `
    -Name "frontend task cap" `
    -RelativePath "frontend\src\store\chartTaskTabsStore.ts" `
    -From "MAX_CHART_TASKS = 12" `
    -To "MAX_CHART_TASKS = 1" `
    -WorkingDirectory "frontend" `
    -TestCommand {
        npm.cmd run test:build
        if ($LASTEXITCODE -eq 0) {
            node --test .test-build/tests/chart/chartTaskTabsStore.test.js
        }
    }

Invoke-Mutation `
    -Name "drag threshold equality" `
    -RelativePath "frontend\src\store\chartTaskTabsStore.ts" `
    -From "> CHART_TASK_DRAG_THRESHOLD_PX" `
    -To ">= CHART_TASK_DRAG_THRESHOLD_PX" `
    -WorkingDirectory "frontend" `
    -TestCommand {
        npm.cmd run test:build
        if ($LASTEXITCODE -eq 0) {
            node --test .test-build/tests/chart/chartTaskTabsStore.test.js
        }
    }

Invoke-Mutation `
    -Name "drop midpoint equality" `
    -RelativePath "frontend\src\store\chartTaskTabsStore.ts" `
    -From "pointerX < targetLeft + targetWidth / 2" `
    -To "pointerX <= targetLeft + targetWidth / 2" `
    -WorkingDirectory "frontend" `
    -TestCommand {
        npm.cmd run test:build
        if ($LASTEXITCODE -eq 0) {
            node --test .test-build/tests/chart/chartTaskTabsStore.test.js
        }
    }

Push-Location (Join-Path $repoRoot "backend")
try {
    go test ./internal/settings -run ChartTaskTabs -count=1
    if ($LASTEXITCODE -ne 0) { throw "Restored backend source failed focused tests" }
}
finally {
    Pop-Location
}

Push-Location (Join-Path $repoRoot "frontend")
try {
    npm.cmd run test:build
    if ($LASTEXITCODE -ne 0) { throw "Restored frontend source failed to compile" }
    node --test .test-build/tests/chart/chartTaskTabsStore.test.js .test-build/tests/chart/chartTaskTabsSyncQueue.test.js
    if ($LASTEXITCODE -ne 0) { throw "Restored frontend source failed focused tests" }
}
finally {
    Pop-Location
}

Write-Host "MUTATION_GAUNTLET_OK (5/5 killed and sources restored)" -ForegroundColor Green
