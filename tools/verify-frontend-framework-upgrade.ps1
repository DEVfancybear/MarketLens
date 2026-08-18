<#
.SYNOPSIS
  Fail-closed verification gauntlet for the Next.js / Tailwind CSS / TypeScript
  frontend framework upgrade.

.DESCRIPTION
  Implements the risk-calibrated gauntlet defined in
  docs/agent-evidence/frontend-framework-upgrade/SPEC.md. Every layer runs from a
  fresh generated-artifact state and the script exits non-zero on the first
  failing layer unless -ContinueOnFailure is supplied.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\verify-frontend-framework-upgrade.ps1
#>
[CmdletBinding()]
param(
    # Skip the two Playwright regressions (layer 9). They need a browser and a
    # dev server, so CI hosts without either can run layers 1-8 on their own.
    [switch]$SkipBrowser,
    # Report every failing layer instead of stopping at the first one.
    [switch]$ContinueOnFailure,
    # Port for the Playwright dev server.
    [int]$BrowserPort = 3000
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$FrontendDir = Join-Path $RepoRoot 'frontend'
$EvidenceDir = Join-Path $RepoRoot 'docs/agent-evidence/frontend-framework-upgrade'

# Exact toolchain contract from the approved SPEC.
$ExpectedManifest = [ordered]@{
    'next'                  = '16.3.1'
    'eslint-config-next'    = '16.3.1'
    'tailwindcss'           = '4.3.3'
    '@tailwindcss/postcss'  = '4.3.3'
    '@typescript/native'    = 'npm:typescript@7.0.2'
    'typescript'            = 'npm:@typescript/typescript6@6.0.2'
}
$ExpectedTscVersion = '7.0.2'
# `tsc6 --version` reports the compiler build (6.0.3) shipped inside the
# @typescript/typescript6 6.0.2 npm package. The npm version is asserted
# separately against the manifest and lockfile.
$ExpectedTsc6Version = '6.0.3'

$script:Results = [System.Collections.Generic.List[object]]::new()
$script:FailureCount = 0

function Write-Header {
    param([string]$Text)
    Write-Host ''
    Write-Host ('=' * 78) -ForegroundColor DarkGray
    Write-Host $Text -ForegroundColor Cyan
    Write-Host ('=' * 78) -ForegroundColor DarkGray
}

function Complete-Layer {
    param(
        [string]$Name,
        [bool]$Passed,
        [string]$Detail = ''
    )
    $script:Results.Add([pscustomobject]@{
        Layer  = $Name
        Status = if ($Passed) { 'PASS' } else { 'FAIL' }
        Detail = $Detail
    })
    if ($Passed) {
        Write-Host "PASS  $Name" -ForegroundColor Green
        return
    }
    $script:FailureCount++
    Write-Host "FAIL  $Name" -ForegroundColor Red
    if ($Detail) { Write-Host "      $Detail" -ForegroundColor Red }
    if (-not $ContinueOnFailure) {
        Write-Summary
        exit 1
    }
}

function Invoke-Layer {
    param(
        [string]$Name,
        [scriptblock]$Body
    )
    Write-Header $Name
    try {
        & $Body
        Complete-Layer -Name $Name -Passed $true
    } catch {
        Complete-Layer -Name $Name -Passed $false -Detail $_.Exception.Message
    }
}

# Runs a native command and throws when it exits non-zero, so every layer fails
# closed rather than silently continuing past a broken step.
function Invoke-Native {
    param(
        [string]$Command,
        [string[]]$CommandArgs,
        [string]$WorkingDirectory = $FrontendDir,
        [switch]$PassThruOutput
    )
    Push-Location $WorkingDirectory
    # Windows PowerShell 5.1 turns a native command's stderr into NativeCommandError
    # records when it is merged with 2>&1, which would abort under
    # $ErrorActionPreference = 'Stop' even for benign warnings (git's CRLF notice,
    # Node's FORCE_COLOR notice). Exit codes remain the source of truth here.
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        if ($PassThruOutput) {
            $output = & $Command @CommandArgs 2>&1 | ForEach-Object { $_.ToString() }
            $exit = $LASTEXITCODE
            $output | ForEach-Object { Write-Host $_ }
        } else {
            & $Command @CommandArgs
            $exit = $LASTEXITCODE
            $output = @()
        }
        if ($exit -ne 0) {
            throw "$Command $($CommandArgs -join ' ') exited with $exit"
        }
        return $output
    } finally {
        $ErrorActionPreference = $previousPreference
        Pop-Location
    }
}

function Get-CommandOutput {
    param(
        [string]$Command,
        [string[]]$CommandArgs,
        [string]$WorkingDirectory = $FrontendDir
    )
    Push-Location $WorkingDirectory
    # See Invoke-Native: stderr merged via 2>&1 must not be treated as a
    # terminating error, so the caller can judge on the exit code instead.
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = & $Command @CommandArgs 2>&1 | ForEach-Object { $_.ToString() }
        return [pscustomobject]@{
            ExitCode = $LASTEXITCODE
            Output   = ($output -join "`n")
        }
    } finally {
        $ErrorActionPreference = $previousPreference
        Pop-Location
    }
}

function Remove-GeneratedArtifacts {
    foreach ($name in @('.next', '.test-build', '.tools-build', 'test-results', 'playwright-report')) {
        $path = Join-Path $FrontendDir $name
        if (Test-Path $path) {
            Remove-Item -Recurse -Force $path
        }
    }
}

function Write-Summary {
    Write-Header 'Gauntlet summary'
    foreach ($result in $script:Results) {
        $color = if ($result.Status -eq 'PASS') { 'Green' } else { 'Red' }
        Write-Host ("{0,-4}  {1}" -f $result.Status, $result.Layer) -ForegroundColor $color
        if ($result.Status -eq 'FAIL' -and $result.Detail) {
            Write-Host ("      {0}" -f $result.Detail) -ForegroundColor Red
        }
    }
    Write-Host ''
    if ($script:FailureCount -eq 0) {
        Write-Host 'All applicable gauntlet layers passed.' -ForegroundColor Green
    } else {
        Write-Host "$script:FailureCount gauntlet layer(s) failed." -ForegroundColor Red
    }
}

if (-not (Test-Path $FrontendDir)) {
    Write-Host "Frontend directory not found at $FrontendDir" -ForegroundColor Red
    exit 1
}

Write-Host "Repository : $RepoRoot"
Write-Host "Frontend   : $FrontendDir"
Write-Host "Browser    : $(if ($SkipBrowser) { 'skipped (-SkipBrowser)' } else { "port $BrowserPort" })"

Write-Header 'Layer 0 - reset generated artifacts'
Remove-GeneratedArtifacts
Write-Host 'Removed .next, .test-build, .tools-build, test-results, playwright-report.'

# ---------------------------------------------------------------------------
# Layer 1 - exact package / alias / version verification plus npm ls
# ---------------------------------------------------------------------------
Invoke-Layer 'Layer 1 - manifest, aliases and resolved versions' {
    $manifestPath = Join-Path $FrontendDir 'package.json'
    $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
    $declared = @{}
    foreach ($section in @('dependencies', 'devDependencies')) {
        if ($manifest.PSObject.Properties.Name -contains $section -and $manifest.$section) {
            foreach ($property in $manifest.$section.PSObject.Properties) {
                $declared[$property.Name] = $property.Value
            }
        }
    }

    foreach ($entry in $ExpectedManifest.GetEnumerator()) {
        if (-not $declared.ContainsKey($entry.Key)) {
            throw "package.json does not declare '$($entry.Key)'"
        }
        if ($declared[$entry.Key] -ne $entry.Value) {
            throw "package.json pins '$($entry.Key)' to '$($declared[$entry.Key])', expected '$($entry.Value)'"
        }
        Write-Host ("  {0,-24} {1}" -f $entry.Key, $entry.Value)
    }

    if ($declared.ContainsKey('autoprefixer')) {
        throw 'autoprefixer is still a direct dependency; Tailwind v4 subsumes it'
    }
    Write-Host '  autoprefixer             removed'

    # No prerelease or floating range for any targeted package.
    foreach ($entry in $ExpectedManifest.GetEnumerator()) {
        $value = $declared[$entry.Key]
        if ($value -match '(canary|rc|beta|alpha|next|preview|latest)') {
            throw "'$($entry.Key)' resolves to a prerelease/floating specifier: $value"
        }
        if ($value -match '^[\^~*]' -or $value -match '@[\^~]') {
            throw "'$($entry.Key)' is not pinned to an exact version: $value"
        }
    }
    Write-Host '  no prerelease or floating specifiers for the targeted packages'

    $lsTargets = @('next', 'eslint-config-next', 'tailwindcss', '@tailwindcss/postcss', 'typescript', '@typescript/native')
    $ls = Get-CommandOutput -Command 'npm' -CommandArgs (@('ls') + $lsTargets)
    if ($ls.ExitCode -ne 0) {
        throw "npm ls reported an unmet/invalid dependency tree:`n$($ls.Output)"
    }
    Write-Host $ls.Output

    foreach ($expected in @(
        'next@16.3.1',
        'eslint-config-next@16.3.1',
        'tailwindcss@4.3.3',
        '@tailwindcss/postcss@4.3.3',
        '@typescript/native@npm:typescript@7.0.2',
        'typescript@npm:@typescript/typescript6@6.0.2'
    )) {
        if ($ls.Output -notmatch [regex]::Escape($expected)) {
            throw "npm ls output does not contain '$expected'"
        }
    }
}

# ---------------------------------------------------------------------------
# Layer 2 - compiler identities and project type check
# ---------------------------------------------------------------------------
Invoke-Layer 'Layer 2 - TypeScript compilers and npm run typecheck' {
    $tsc = Get-CommandOutput -Command 'npx' -CommandArgs @('--no-install', 'tsc', '--version')
    if ($tsc.ExitCode -ne 0) { throw "tsc --version failed:`n$($tsc.Output)" }
    if ($tsc.Output -notmatch [regex]::Escape($ExpectedTscVersion)) {
        throw "tsc reported '$($tsc.Output.Trim())', expected version $ExpectedTscVersion"
    }
    Write-Host "  tsc  -> $($tsc.Output.Trim())"

    $tsc6 = Get-CommandOutput -Command 'npx' -CommandArgs @('--no-install', 'tsc6', '--version')
    if ($tsc6.ExitCode -ne 0) { throw "tsc6 --version failed:`n$($tsc6.Output)" }
    if ($tsc6.Output -notmatch [regex]::Escape($ExpectedTsc6Version)) {
        throw "tsc6 reported '$($tsc6.Output.Trim())', expected compiler build $ExpectedTsc6Version"
    }
    Write-Host "  tsc6 -> $($tsc6.Output.Trim())"

    # The TypeScript 6 compatibility package must still expose the JavaScript
    # compiler API that ESLint and the Next build type checker consume.
    $apiPath = Join-Path $FrontendDir 'node_modules/typescript/lib/typescript.js'
    if (-not (Test-Path $apiPath)) {
        throw "TypeScript JavaScript API missing at $apiPath"
    }
    Write-Host '  typescript/lib/typescript.js present'

    Invoke-Native -Command 'npm' -CommandArgs @('run', 'typecheck')
}

# ---------------------------------------------------------------------------
# Layer 3 - every focused TypeScript test group named in Scenario 6
# ---------------------------------------------------------------------------
Invoke-Layer 'Layer 3 - focused TypeScript test suites' {
    $suites = @(
        'test:architecture',
        'test:replay',
        'test:position',
        'test:trade',
        'test:drawing',
        'test:drawing-persistence',
        'test:indicator-catalog',
        'test:watchlist',
        'test:alerts',
        'test:chart',
        'test:ui'
    )
    foreach ($suite in $suites) {
        Write-Host "  -> npm run $suite" -ForegroundColor DarkCyan
        Invoke-Native -Command 'npm' -CommandArgs @('run', $suite)
    }
}

# ---------------------------------------------------------------------------
# Layer 4 - lint with zero errors and no new warnings
# ---------------------------------------------------------------------------
Invoke-Layer 'Layer 4 - ESLint' {
    $lint = Get-CommandOutput -Command 'npm' -CommandArgs @('run', 'lint')
    Write-Host $lint.Output
    if ($lint.ExitCode -ne 0) {
        throw "npm run lint exited with $($lint.ExitCode)"
    }
    if ($lint.Output -match '(\d+)\s+problems?\s+\((\d+)\s+errors?,\s+(\d+)\s+warnings?\)') {
        $errors = [int]$Matches[2]
        $warnings = [int]$Matches[3]
        if ($errors -gt 0) {
            throw "ESLint reported $errors error(s)"
        }
        # One pre-existing react-hooks/exhaustive-deps warning in PriceChart.tsx
        # predates this upgrade and sits on code the upgrade did not touch.
        if ($warnings -gt 1) {
            throw "ESLint reported $warnings warning(s); the recorded pre-existing baseline is 1"
        }
        Write-Host "  errors=$errors warnings=$warnings (baseline warning budget: 1)"
    }
}

# ---------------------------------------------------------------------------
# Layer 5 - production build with type checking enabled
# ---------------------------------------------------------------------------
Invoke-Layer 'Layer 5 - next build with type checking enabled' {
    $nextConfig = Get-Content (Join-Path $FrontendDir 'next.config.mjs') -Raw
    if ($nextConfig -match 'ignoreBuildErrors\s*:\s*true') {
        throw 'next.config.mjs disables build type errors via typescript.ignoreBuildErrors'
    }

    $buildPath = Join-Path $FrontendDir '.next'
    if (Test-Path $buildPath) { Remove-Item -Recurse -Force $buildPath }

    $build = Get-CommandOutput -Command 'npm' -CommandArgs @('run', 'build')
    Write-Host $build.Output
    if ($build.ExitCode -ne 0) {
        throw "npm run build exited with $($build.ExitCode)"
    }
    if ($build.Output -notmatch 'Next\.js 16\.3\.1') {
        throw 'build output does not report Next.js 16.3.1'
    }
    # Proves the type checker actually ran rather than being skipped.
    if ($build.Output -notmatch 'Running TypeScript' -or $build.Output -notmatch 'Finished TypeScript') {
        throw 'build output does not show the TypeScript checking step running to completion'
    }
    Write-Host '  Next.js 16.3.1 build completed with TypeScript checking'
}

# ---------------------------------------------------------------------------
# Layer 6 - negative controls: the architecture checker must reject regressions
# ---------------------------------------------------------------------------
Invoke-Layer 'Layer 6 - architecture checker negative controls' {
    $mutations = @(
        @{
            Name    = 'Tailwind PostCSS plugin reverted to the v3 plugin'
            File    = Join-Path $FrontendDir 'postcss.config.mjs'
            Find    = "'@tailwindcss/postcss': {},"
            Replace = "tailwindcss: {},"
        },
        @{
            Name    = 'Next TypeScript checker flag removed'
            File    = Join-Path $FrontendDir 'next.config.mjs'
            Find    = 'useTypeScriptCli: false,'
            Replace = 'useTypeScriptCli: true,'
        },
        @{
            Name    = 'Tailwind v4 CSS entry point reverted to v3 directives'
            File    = Join-Path $FrontendDir 'src/app/globals.css'
            Find    = "@import 'tailwindcss';"
            Replace = "@tailwind base;`n@tailwind components;`n@tailwind utilities;"
        },
        @{
            Name    = 'baseUrl reintroduced into the root tsconfig'
            File    = Join-Path $FrontendDir 'tsconfig.json'
            Find    = '"paths": {'
            Replace = "`"baseUrl`": `".`",`n    `"paths`": {"
        }
    )

    # The architecture assertions read source files, so build the suite once and
    # rerun only the compiled checker between mutations.
    Invoke-Native -Command 'npm' -CommandArgs @('run', 'test:build')
    $checker = '.test-build/tests/architecture/frameworkToolchainUpgrade.test.js'

    $clean = Get-CommandOutput -Command 'node' -CommandArgs @('--test', $checker)
    if ($clean.ExitCode -ne 0) {
        throw "architecture checker fails on the clean tree:`n$($clean.Output)"
    }
    Write-Host '  clean tree: checker passes'

    foreach ($mutation in $mutations) {
        $original = Get-Content $mutation.File -Raw
        if ($original -notmatch [regex]::Escape($mutation.Find)) {
            throw "mutation anchor not found in $($mutation.File): $($mutation.Find)"
        }
        $mutated = $original.Replace($mutation.Find, $mutation.Replace)
        [System.IO.File]::WriteAllText($mutation.File, $mutated)
        try {
            $run = Get-CommandOutput -Command 'node' -CommandArgs @('--test', $checker)
            if ($run.ExitCode -eq 0) {
                throw "mutation survived undetected: $($mutation.Name)"
            }
            Write-Host "  detected: $($mutation.Name)"
        } finally {
            # Restore byte-for-byte, whatever the outcome above.
            [System.IO.File]::WriteAllText($mutation.File, $original)
        }
    }

    $restored = Get-CommandOutput -Command 'node' -CommandArgs @('--test', $checker)
    if ($restored.ExitCode -ne 0) {
        throw "architecture checker fails after restoring mutations:`n$($restored.Output)"
    }
    Write-Host '  restored tree: checker passes'
}

# ---------------------------------------------------------------------------
# Layer 7 - npm audit, compared against the recorded baseline
# ---------------------------------------------------------------------------
Invoke-Layer 'Layer 7 - npm audit (no new high/critical advisories)' {
    $audit = Get-CommandOutput -Command 'npm' -CommandArgs @('audit', '--json')
    $report = $audit.Output | ConvertFrom-Json
    $high = [int]$report.metadata.vulnerabilities.high
    $critical = [int]$report.metadata.vulnerabilities.critical
    Write-Host "  high=$high critical=$critical"

    # Baseline recorded on the pre-upgrade tree: 3 high, 0 critical.
    $baselineHigh = 3
    $baselineCritical = 0
    if ($critical -gt $baselineCritical) {
        throw "critical advisories rose from $baselineCritical to $critical"
    }
    if ($high -gt $baselineHigh) {
        throw "high advisories rose from $baselineHigh to $high"
    }
    if ($report.vulnerabilities) {
        foreach ($vuln in $report.vulnerabilities.PSObject.Properties) {
            if ($vuln.Value.severity -in @('high', 'critical')) {
                Write-Host "    $($vuln.Value.severity): $($vuln.Name)"
            }
        }
    }
}

# ---------------------------------------------------------------------------
# Layer 8 - diff hygiene: whitespace, intended files, secret scan
# ---------------------------------------------------------------------------
Invoke-Layer 'Layer 8 - diff hygiene and secret scan' {
    $check = Get-CommandOutput -Command 'git' -CommandArgs @('diff', '--check') -WorkingDirectory $RepoRoot
    if ($check.ExitCode -ne 0) {
        throw "git diff --check reported whitespace errors:`n$($check.Output)"
    }
    Write-Host '  git diff --check clean'

    $changed = (Get-CommandOutput -Command 'git' -CommandArgs @('status', '--porcelain') -WorkingDirectory $RepoRoot).Output
    $paths = @()
    foreach ($line in ($changed -split "`n")) {
        if (-not $line.Trim()) { continue }
        # Git prints CRLF normalization notices on stderr; they are merged into
        # the captured output and are not status entries.
        if ($line -match '^(warning|hint):') { continue }
        $paths += $line.Substring(3).Trim().Replace('\', '/')
    }

    # Nothing outside the frontend, the upgrade evidence, this script, and the
    # project memory documents may change. SECURITY.md is included because it
    # records the pinned dependency/audit contract this upgrade touches.
    $allowed = @(
        '^frontend/',
        '^docs/agent-evidence/frontend-framework-upgrade/',
        '^tools/verify-frontend-framework-upgrade\.ps1$',
        '^docs/(CURRENT_PROGRESS|NEXT_TASKS|HANDOFF|CHANGELOG|KNOWN_ISSUES|SECURITY)\.md$'
    )
    foreach ($path in $paths) {
        $ok = $false
        foreach ($pattern in $allowed) {
            if ($path -match $pattern) { $ok = $true; break }
        }
        if (-not $ok) {
            throw "unexpected change outside the intended surface: $path"
        }
    }
    Write-Host "  $($paths.Count) changed path(s), all within the intended surface"

    # No backend/database/trading/auth source may be touched by this task.
    foreach ($path in $paths) {
        if ($path -match '^(backend|infra|migrations)/') {
            throw "backend/deployment surface changed: $path"
        }
    }
    Write-Host '  no backend, migration or deployment source changed'

    $diff = (Get-CommandOutput -Command 'git' -CommandArgs @('diff') -WorkingDirectory $RepoRoot).Output
    $secretPatterns = @(
        'AKIA[0-9A-Z]{16}',
        '-----BEGIN [A-Z ]*PRIVATE KEY-----',
        'AIza[0-9A-Za-z_\-]{35}',
        'xox[baprs]-[0-9A-Za-z\-]{10,}',
        'gh[pousr]_[0-9A-Za-z]{36}'
    )
    foreach ($pattern in $secretPatterns) {
        if ($diff -match $pattern) {
            throw "possible secret matching /$pattern/ found in the diff"
        }
    }
    Write-Host '  no credential-shaped strings in the diff'
}

# ---------------------------------------------------------------------------
# Layer 9 - Playwright responsive regressions, twice consecutively
# ---------------------------------------------------------------------------
if ($SkipBrowser) {
    Write-Header 'Layer 9 - Playwright responsive regressions'
    Write-Host 'SKIPPED (-SkipBrowser)' -ForegroundColor Yellow
    $script:Results.Add([pscustomobject]@{
        Layer  = 'Layer 9 - Playwright responsive regressions'
        Status = 'SKIP'
        Detail = 'Requested with -SkipBrowser'
    })
} else {
    Invoke-Layer 'Layer 9 - Playwright responsive regressions (x2)' {
        $env:PLAYWRIGHT_PORT = "$BrowserPort"

        # Two assertions in platformUi.spec.ts already failed on the pre-upgrade
        # tree (verified by running these same specs against a clean worktree at
        # commit f94e346 with the Tailwind v3 / Next 16.2.12 / TypeScript 5.7.3
        # dependency set). They are recorded here so this layer still fails
        # closed on any NEW browser failure without pretending the suite was
        # green before the upgrade. See EVIDENCE.md and KNOWN_ISSUES.md.
        $preExisting = @(
            'mobile watchlist actions use the shared platform dialog',
            'desktop loads only the command-center presentation'
        )

        for ($pass = 1; $pass -le 2; $pass++) {
            Write-Host "  -> Playwright pass $pass of 2" -ForegroundColor DarkCyan
            $reportPath = Join-Path $FrontendDir "test-results/gauntlet-pass$pass.json"
            $reportDir = Split-Path -Parent $reportPath
            if (-not (Test-Path $reportDir)) {
                New-Item -ItemType Directory -Force $reportDir | Out-Null
            }
            $env:PLAYWRIGHT_JSON_OUTPUT_NAME = $reportPath

            # Traces, screenshots and the HTML report are retained on failure by
            # playwright.config.ts (trace: retain-on-failure).
            $run = Get-CommandOutput -Command 'npx' -CommandArgs @(
                '--no-install', 'playwright', 'test',
                'platformUi.spec.ts', 'mobileOverlayResponsive.spec.ts',
                '--reporter=json'
            )
            if (-not (Test-Path $reportPath)) {
                throw "Playwright pass $pass produced no JSON report:`n$($run.Output)"
            }

            $report = Get-Content $reportPath -Raw | ConvertFrom-Json
            $failed = [System.Collections.Generic.List[string]]::new()
            $script:passedSpecs = 0

            # Playwright nests suites arbitrarily deep (file suite -> describe
            # suite -> specs), and omits the key entirely when a level is empty.
            function Read-Suite {
                param($Suite, $Failed)
                $props = $Suite.PSObject.Properties.Name
                if ($props -contains 'specs' -and $Suite.specs) {
                    foreach ($spec in $Suite.specs) {
                        if ($spec.ok) { $script:passedSpecs++ } else { $Failed.Add($spec.title) }
                    }
                }
                if ($props -contains 'suites' -and $Suite.suites) {
                    foreach ($child in $Suite.suites) { Read-Suite -Suite $child -Failed $Failed }
                }
            }

            if ($report.PSObject.Properties.Name -notcontains 'suites') {
                throw "Playwright pass ${pass} report has no suites:`n$($run.Output)"
            }
            foreach ($suite in $report.suites) { Read-Suite -Suite $suite -Failed $failed }
            $passed = $script:passedSpecs
            Write-Host "     pass $pass -> $passed passed, $($failed.Count) failed"

            $unexpected = @($failed | Where-Object { $preExisting -notcontains $_ })
            foreach ($title in $failed) {
                if ($preExisting -contains $title) {
                    Write-Host "     pre-existing failure (also fails pre-upgrade): $title" -ForegroundColor Yellow
                } else {
                    Write-Host "     NEW failure: $title" -ForegroundColor Red
                }
            }
            if ($unexpected.Count -gt 0) {
                throw "Playwright pass ${pass}: $($unexpected.Count) failure(s) not present on the pre-upgrade baseline: $($unexpected -join '; ')"
            }
            if ($passed -eq 0) {
                throw "Playwright pass ${pass} recorded no passing specs; the run did not execute"
            }
        }
    }
}

Write-Summary
if ($script:FailureCount -gt 0) { exit 1 }
Write-Host ''
Write-Host "Evidence report: $EvidenceDir/EVIDENCE.md"
exit 0
