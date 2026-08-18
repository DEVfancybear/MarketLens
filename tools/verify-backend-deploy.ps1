<#
.SYNOPSIS
  Fail-closed verification gauntlet for the one-command backend deploy path.

.DESCRIPTION
  Covers the CI artifact job, tools/deploy-backend.ps1, the shared module, and the
  live local API run. Exits non-zero on the first failing layer unless
  -ContinueOnFailure is given.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\verify-backend-deploy.ps1
#>
[CmdletBinding()]
param(
    # Skip the layer that starts real services and probes the API. Use on a host
    # without a reachable PostgreSQL.
    [switch]$SkipLiveApi,
    [switch]$ContinueOnFailure
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$ToolsDir = Join-Path $RepoRoot 'tools'
$BackendDir = Join-Path $RepoRoot 'backend'

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
    param([string]$Name, [bool]$Passed, [string]$Detail = '')
    $script:Results.Add([pscustomobject]@{ Layer = $Name; Status = $(if ($Passed) { 'PASS' } else { 'FAIL' }); Detail = $Detail })
    if ($Passed) { Write-Host "PASS  $Name" -ForegroundColor Green; return }
    $script:FailureCount++
    Write-Host "FAIL  $Name" -ForegroundColor Red
    if ($Detail) { Write-Host "      $Detail" -ForegroundColor Red }
    if (-not $ContinueOnFailure) { Write-Summary; exit 1 }
}

function Invoke-Layer {
    param([string]$Name, [scriptblock]$Body)
    Write-Header $Name
    try { & $Body; Complete-Layer -Name $Name -Passed $true }
    catch { Complete-Layer -Name $Name -Passed $false -Detail $_.Exception.Message }
}

# Windows PowerShell 5.1 turns native stderr merged with 2>&1 into terminating
# NativeCommandError records. Exit codes stay the source of truth.
function Get-CommandOutput {
    param([string]$Command, [string[]]$CommandArgs, [string]$WorkingDirectory = $RepoRoot)
    Push-Location $WorkingDirectory
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = & $Command @CommandArgs 2>&1 | ForEach-Object { $_.ToString() }
        return [pscustomobject]@{ ExitCode = $LASTEXITCODE; Output = ($output -join "`n") }
    } finally {
        $ErrorActionPreference = $previous
        Pop-Location
    }
}

function Write-Summary {
    Write-Header 'Gauntlet summary'
    foreach ($result in $script:Results) {
        $colour = switch ($result.Status) { 'PASS' { 'Green' } 'SKIP' { 'Yellow' } default { 'Red' } }
        Write-Host ("{0,-4}  {1}" -f $result.Status, $result.Layer) -ForegroundColor $colour
        if ($result.Status -eq 'FAIL' -and $result.Detail) { Write-Host ("      {0}" -f $result.Detail) -ForegroundColor Red }
    }
    Write-Host ''
    if ($script:FailureCount -eq 0) { Write-Host 'All applicable gauntlet layers passed.' -ForegroundColor Green }
    else { Write-Host "$script:FailureCount gauntlet layer(s) failed." -ForegroundColor Red }
}

Write-Host "Repository: $RepoRoot"

# ---------------------------------------------------------------------------
Invoke-Layer 'Layer 1 - PowerShell and YAML parse' {
    $files = @(
        (Join-Path $ToolsDir 'deploy-backend.ps1'),
        (Join-Path $ToolsDir 'verify-backend-local.ps1'),
        (Join-Path $ToolsDir 'verify-backend-deploy.ps1'),
        (Join-Path $ToolsDir 'lib\MarketLensBackend.psm1'),
        (Join-Path $RepoRoot 'run-backend-production.ps1'),
        (Join-Path $RepoRoot 'build-production.ps1')
    )
    foreach ($file in $files) {
        if (-not (Test-Path -LiteralPath $file)) { throw "missing $file" }
        $errors = $null
        $null = [System.Management.Automation.Language.Parser]::ParseFile($file, [ref]$null, [ref]$errors)
        if ($errors -and $errors.Count -gt 0) {
            throw "$([IO.Path]::GetFileName($file)): $($errors[0].Message)"
        }
        Write-Host "  parsed $([IO.Path]::GetFileName($file))"
    }

    $workflow = Join-Path $RepoRoot '.github\workflows\ci.yml'
    $probe = @"
import sys, yaml
d = yaml.safe_load(open(r'$workflow', encoding='utf-8'))
jobs = list(d['jobs'].keys())
assert 'backend-artifact' in jobs, 'backend-artifact job missing'
job = d['jobs']['backend-artifact']
assert job['runs-on'] == 'windows-latest', 'artifact job must build on Windows'
assert set(job['needs']) == {'backend', 'execution-rust'}, 'artifact job must gate on the test jobs'
for existing in ('replay-client-boundary', 'backend', 'execution-rust'):
    assert existing in jobs, 'pre-existing job ' + existing + ' was removed'
print('jobs=' + ','.join(jobs))
"@
    $probeFile = Join-Path ([IO.Path]::GetTempPath()) "ml-yaml-probe-$([guid]::NewGuid().ToString('N')).py"
    Set-Content -LiteralPath $probeFile -Value $probe -Encoding utf8
    try {
        $result = Get-CommandOutput -Command 'python' -CommandArgs @($probeFile)
        if ($result.ExitCode -ne 0) { throw "ci.yml validation failed: $($result.Output)" }
        Write-Host "  ci.yml $($result.Output)"
    } finally {
        Remove-Item -LiteralPath $probeFile -Force -ErrorAction SilentlyContinue
    }
}

# ---------------------------------------------------------------------------
Invoke-Layer 'Layer 2 - deploy-backend self-test (refusal paths)' {
    $result = Get-CommandOutput -Command 'powershell' -CommandArgs @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass',
        '-File', (Join-Path $ToolsDir 'deploy-backend.ps1'), '-SelfTest')
    Write-Host $result.Output
    if ($result.ExitCode -ne 0) { throw "self-test exited with $($result.ExitCode)" }
    if ($result.Output -notmatch '(\d+) passed, 0 failed') { throw 'self-test did not report a clean run' }
}

# ---------------------------------------------------------------------------
Invoke-Layer 'Layer 3 - reproduce the CI artifact recipe locally' {
    # Builds exactly what the workflow builds (Go half; the Rust binary is reused
    # from target/release because a release build is far slower than this gate).
    $stage = Join-Path ([IO.Path]::GetTempPath()) "ml-artifact-$([guid]::NewGuid().ToString('N'))"
    New-Item -ItemType Directory -Force (Join-Path $stage 'bin') | Out-Null
    try {
        $env:CGO_ENABLED = '0'; $env:GOOS = 'windows'; $env:GOARCH = 'amd64'
        foreach ($cmd in @('api', 'migrate', 'mt5-stream')) {
            $build = Get-CommandOutput -Command 'go' -CommandArgs @(
                'build', '-trimpath', '-o', (Join-Path $stage "bin\$cmd.exe"), "./cmd/$cmd") -WorkingDirectory $BackendDir
            if ($build.ExitCode -ne 0) { throw "go build ./cmd/$cmd failed: $($build.Output)" }
            Write-Host "  built $cmd.exe"
        }
        $gateway = Join-Path $BackendDir 'execution\target\release\execution-gateway.exe'
        if (-not (Test-Path -LiteralPath $gateway)) {
            throw "execution-gateway.exe not found; run 'cargo build --release -p execution-gateway' in backend/execution first."
        }
        Copy-Item -LiteralPath $gateway -Destination (Join-Path $stage 'bin') -Force

        # Manifest + checksums, mirroring the workflow's packaging step.
        $manifest = [ordered]@{
            commit     = (& git -C $RepoRoot rev-parse HEAD)
            builtAtUtc = (Get-Date).ToUniversalTime().ToString('o')
            binaries   = @('api.exe', 'migrate.exe', 'mt5-stream.exe', 'execution-gateway.exe')
        }
        $manifest | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $stage 'MANIFEST.json') -Encoding utf8
        Push-Location $stage
        try {
            $lines = Get-ChildItem -Recurse -File | Where-Object { $_.Name -ne 'SHA256SUMS' } | ForEach-Object {
                $rel = $_.FullName.Substring($stage.Length).TrimStart('\').Replace('\', '/')
                "$((Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLower())  $rel"
            }
            $lines | Set-Content 'SHA256SUMS' -Encoding ascii
        } finally { Pop-Location }

        Import-Module (Join-Path $ToolsDir 'lib\MarketLensBackend.psm1') -Force
        $verified = Test-ArtifactChecksums -Root $stage -SumsPath (Join-Path $stage 'SHA256SUMS')
        Write-Host "  packaged and verified $verified file(s)"
        if ($verified -ne 5) { throw "expected 5 packaged files, got $verified" }

        # The packaged migrator must run standalone, proving the SQL really is
        # embedded and no repository file is consulted. With a reachable database
        # it must report a version; without one it must fail with its own explicit
        # configuration error rather than a missing-migrations error.
        Import-Module (Join-Path $ToolsDir 'lib\MarketLensBackend.psm1') -Force
        $envFile = Join-Path $BackendDir '.env'
        $databaseUrl = ''
        if (Test-Path -LiteralPath $envFile) {
            $databaseUrl = Get-BackendEnvValue -Name 'DATABASE_URL' -EnvFilePath $envFile
        }
        if ($databaseUrl) { $env:DATABASE_URL = $databaseUrl }
        $migrate = Get-CommandOutput -Command (Join-Path $stage 'bin\migrate.exe') -CommandArgs @('version')
        if ($databaseUrl) {
            if ($migrate.Output -notmatch 'version=\d+') {
                throw "packaged migrate.exe did not report a version: $($migrate.Output)"
            }
        } elseif ($migrate.Output -notmatch 'DATABASE_URL is not set') {
            throw "packaged migrate.exe did not run as expected: $($migrate.Output)"
        }
        Write-Host "  packaged migrate.exe reports: $($migrate.Output.Trim())"
    } finally {
        Remove-Item -Recurse -Force $stage -ErrorAction SilentlyContinue
        Remove-Item Env:CGO_ENABLED, Env:GOOS, Env:GOARCH -ErrorAction SilentlyContinue
        # Do not leak the migrator's connection string into later layers.
        Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
    }
}

# ---------------------------------------------------------------------------
Invoke-Layer 'Layer 4 - architecture invariants' {
    $deploySource = Get-Content -LiteralPath (Join-Path $ToolsDir 'deploy-backend.ps1') -Raw
    $moduleSource = Get-Content -LiteralPath (Join-Path $ToolsDir 'lib\MarketLensBackend.psm1') -Raw

    # The deploy path must never roll a migration back. Match an actual
    # invocation (a call operator or an .exe path followed by the rollback verb)
    # rather than any mention, so this file can describe the rule it enforces.
    $rollbackPattern = '(&\s*\$?[\w:\\.]*migrate[\w.]*|migrate\.exe)\s+(?i:down)\b'
    foreach ($file in (Get-ChildItem -LiteralPath $ToolsDir -Recurse -Filter '*.ps1')) {
        $text = Get-Content -LiteralPath $file.FullName -Raw
        if ($text -cmatch $rollbackPattern) {
            throw "$($file.Name) invokes a migration rollback; migrations must stay forward-only."
        }
    }
    Write-Host '  no tools script invokes a migration rollback'

    # The canonical runner must remain behaviourally untouched by this task.
    $runnerDiff = Get-CommandOutput -Command 'git' -CommandArgs @('diff', 'HEAD', '--', 'run-backend-production.ps1')
    if ($runnerDiff.Output.Trim()) { throw 'run-backend-production.ps1 was modified; the deploy path must delegate to it unchanged.' }
    Write-Host '  run-backend-production.ps1 unchanged'

    # Delegation, not duplication.
    foreach ($flag in @('-SkipPull', '-SkipBuild', '-SkipMigrations')) {
        if ($deploySource -notmatch [regex]::Escape($flag)) { throw "deploy script does not pass $flag to the runner" }
    }
    if ($deploySource -notmatch 'run-backend-production\.ps1') { throw 'deploy script does not delegate to the canonical runner' }
    Write-Host '  deploy delegates restart to the runner with the recovery switches'

    # Port 8787 stays out of scope, matching the runner and AGENTS.md. Match the
    # port-table assignment form so the script may still name the port in prose
    # and in the assertion that keeps it out.
    if ($deploySource -match '(?m)^\s*8787\s*=') {
        throw 'deploy script targets port 8787, which is browser/account-local.'
    }
    Write-Host '  port 8787 is not a deploy target'

    # Integrity verification must not be optional.
    if ($deploySource -match 'SkipChecksum|SkipVerify|NoVerify') { throw 'deploy script exposes a switch that skips integrity verification.' }
    if ($moduleSource -notmatch 'listed no files') { throw 'checksum verifier does not reject an empty manifest.' }
    Write-Host '  artifact verification cannot be switched off'

    # No credential-shaped literal in the new files.
    foreach ($pattern in @('AKIA[0-9A-Z]{16}', '-----BEGIN [A-Z ]*PRIVATE KEY-----', 'gh[pousr]_[0-9A-Za-z]{36}')) {
        if (($deploySource + $moduleSource) -match $pattern) { throw "possible secret matching /$pattern/ in the new tools" }
    }
    Write-Host '  no credential-shaped strings in the new tools'
}

# ---------------------------------------------------------------------------
Invoke-Layer 'Layer 5 - backend source suites (no regression)' {
    # The config package asserts defaults, so it must not inherit whatever the
    # operator's shell happens to export. Earlier layers and manual verification
    # both set some of these; clear them for the duration and restore after.
    $perturbing = @(
        'DATABASE_URL', 'APP_ENV', 'PORT',
        'FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY',
        'AUTH_JWT_SECRET', 'AUTH_ACCESS_TTL', 'AUTH_REFRESH_TTL',
        'EXECUTION_ADMIN_TOKEN', 'EXECUTION_GATEWAY_BIND', 'EXECUTION_ADMIN_BIND',
        'EXECUTION_EA_URL', 'EXECUTION_ADMIN_URL', 'EXECUTION_DATABASE_MAX_CONNECTIONS',
        'CHART_TIME_ZONE', 'PUSH_WORKER_SECRET'
    )
    $saved = @{}
    foreach ($name in $perturbing) {
        $saved[$name] = [Environment]::GetEnvironmentVariable($name)
        if ($null -ne $saved[$name]) { Remove-Item "Env:$name" -ErrorAction SilentlyContinue }
    }
    try {
        $vet = Get-CommandOutput -Command 'go' -CommandArgs @('vet', './...') -WorkingDirectory $BackendDir
        if ($vet.ExitCode -ne 0) { throw "go vet failed:`n$($vet.Output)" }
        Write-Host '  go vet clean'

        $test = Get-CommandOutput -Command 'go' -CommandArgs @('test', './...') -WorkingDirectory $BackendDir
        if ($test.ExitCode -ne 0) {
            throw "go test failed:`n$(($test.Output -split "`n" | Select-String -Pattern '^(--- )?FAIL' | Select-Object -First 8) -join "`n")"
        }
        Write-Host '  go test ./... passed'
    } finally {
        foreach ($name in $perturbing) {
            if ($null -ne $saved[$name]) { Set-Item "Env:$name" -Value $saved[$name] }
        }
    }
}

# ---------------------------------------------------------------------------
if ($SkipLiveApi) {
    Write-Header 'Layer 6 - live local API run'
    Write-Host 'SKIPPED (-SkipLiveApi)' -ForegroundColor Yellow
    $script:Results.Add([pscustomobject]@{ Layer = 'Layer 6 - live local API run'; Status = 'SKIP'; Detail = 'requested' })
} else {
    Invoke-Layer 'Layer 6 - live local API run (starts real services)' {
        $result = Get-CommandOutput -Command 'powershell' -CommandArgs @(
            '-NoProfile', '-ExecutionPolicy', 'Bypass',
            '-File', (Join-Path $ToolsDir 'verify-backend-local.ps1'))
        Write-Host $result.Output
        if ($result.ExitCode -ne 0) { throw "live API verification exited with $($result.ExitCode)" }
        if ($result.Output -notmatch 'All \d+ API probes passed') { throw 'live API verification did not report a clean run' }
    }
}

# ---------------------------------------------------------------------------
Invoke-Layer 'Layer 7 - diff hygiene' {
    $check = Get-CommandOutput -Command 'git' -CommandArgs @('diff', '--check')
    if ($check.ExitCode -ne 0) { throw "git diff --check reported whitespace errors:`n$($check.Output)" }
    Write-Host '  git diff --check clean'

    $status = (Get-CommandOutput -Command 'git' -CommandArgs @('status', '--porcelain')).Output
    $allowed = @(
        '^tools/',
        '^\.github/workflows/ci\.yml$',
        '^docs/agent-evidence/backend-oneshot-deploy/',
        '^AGENTS\.md$',
        '^docs/(CURRENT_PROGRESS|NEXT_TASKS|HANDOFF|CHANGELOG|KNOWN_ISSUES|OPERATIONS)\.md$'
    )
    $paths = @()
    foreach ($line in ($status -split "`n")) {
        if (-not $line.Trim()) { continue }
        if ($line -match '^(warning|hint):') { continue }
        $paths += $line.Substring(3).Trim().Replace('\', '/')
    }
    foreach ($path in $paths) {
        $ok = $false
        foreach ($pattern in $allowed) { if ($path -match $pattern) { $ok = $true; break } }
        if (-not $ok) { throw "unexpected change outside the intended surface: $path" }
    }
    Write-Host "  $($paths.Count) changed path(s), all within the intended surface"

    foreach ($path in $paths) {
        if ($path -match '^(backend|frontend)/') { throw "application source changed: $path" }
    }
    Write-Host '  no backend or frontend source changed'
}

Write-Summary
if ($script:FailureCount -gt 0) { exit 1 }
exit 0
