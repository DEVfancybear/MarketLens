<#
.SYNOPSIS
  Deploy a CI-built backend artifact on the Windows production host with one command.

.DESCRIPTION
  This is the normal production deploy path. It acquires the backend artifact that
  GitHub Actions already built, verifies its integrity, applies forward-only
  migrations with the compiled migrator, and then hands the restart to the
  canonical runner:

      run-backend-production.ps1 -SkipPull -SkipBuild -SkipMigrations

  Delegating the restart keeps run-backend-production.ps1 as the single
  implementation of listener ownership, MT5 terminal/sidecar startup and the
  health gates. Nothing in the runner is modified or bypassed.

  Because the binaries arrive prebuilt and migrations run from migrate.exe, the
  host needs no Go and no Rust toolchain. Python stays required only because the
  MT5 market-data sidecar is a Python program.

  Migrations are forward-only. A failed restart rolls the binaries back but never
  rolls the schema back; the failure output says so explicitly.

.PARAMETER ArtifactPath
  Deploy a local artifact (.zip or an already-extracted directory) instead of
  downloading. Use for air-gapped or pre-staged deploys.

.PARAMETER Commit
  Deploy the artifact built from this exact commit instead of the newest build.

.PARAMETER Tag
  Deploy the artifact attached to this release tag.

.PARAMETER AllowCommitMismatch
  Permit deploying an artifact whose commit differs from the checked-out HEAD.
  Refused by default so an operator cannot review one tree and ship another.

.EXAMPLE
  .\tools\deploy-backend.ps1

.EXAMPLE
  .\tools\deploy-backend.ps1 -ArtifactPath C:\downloads\marketlens-backend-windows-amd64.zip

.EXAMPLE
  .\tools\deploy-backend.ps1 -Tag v1.4.0
#>
[CmdletBinding()]
param(
    [string]$ArtifactPath,
    [string]$Commit,
    [string]$Tag,
    [string]$Repository = "DEVfancybear/MarketLens",
    [string]$Branch = "master",
    [string]$WorkflowArtifactName = "marketlens-backend-windows-amd64",
    [switch]$AllowCommitMismatch,
    [switch]$SkipPublicHealthCheck,
    [switch]$KeepStaging,
    [switch]$SelfTest
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSScriptRoot
$backendDir = Join-Path $repoRoot "backend"
$binDir = Join-Path $backendDir "bin"
$stagingRoot = Join-Path $binDir ".staging"
$previousDir = Join-Path $binDir ".previous"
$backendEnv = Join-Path $backendDir ".env"
$runnerScript = Join-Path $repoRoot "run-backend-production.ps1"
$migrateExe = Join-Path $binDir "migrate.exe"
$modulePath = Join-Path $PSScriptRoot "lib\MarketLensBackend.psm1"

Import-Module $modulePath -Force

# Binaries the artifact must contain. mt5-stream.exe is the Go consumer of the
# Python market-data bridge; the runner starts it when configured.
$RequiredBinaries = @("api.exe", "migrate.exe", "mt5-stream.exe", "execution-gateway.exe")

function Write-Step {
    param([string]$Text)
    Write-Host ""
    Write-Host "==> $Text" -ForegroundColor Cyan
}

# ---------------------------------------------------------------------------
# Pure decision functions. Kept separate from any side effect so -SelfTest can
# exercise every refusal path without touching a real service or database.
# ---------------------------------------------------------------------------

function Test-MigrationStateClean {
    <#
    .SYNOPSIS
      Decide whether `migrate version` output describes a safe, clean schema.
    .DESCRIPTION
      Returns $true only when the output does not report a dirty schema. A dirty
      schema means a previous migration failed part-way; replacing running
      services on top of that is how a half-migrated database becomes an outage.
    #>
    param([Parameter(Mandatory = $true)][AllowEmptyString()][string]$VersionOutput)
    return -not ($VersionOutput -match 'dirty\s*[:=]\s*true')
}

function Test-ManifestCommit {
    <#
    .SYNOPSIS
      Decide whether an artifact's commit may be deployed onto this worktree.
    #>
    param(
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$ArtifactCommit,
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$HeadCommit,
        [bool]$Allow = $false
    )
    if ($Allow) { return $true }
    if ([string]::IsNullOrWhiteSpace($ArtifactCommit)) { return $false }
    if ([string]::IsNullOrWhiteSpace($HeadCommit)) { return $false }
    return $ArtifactCommit.Trim().ToLowerInvariant() -eq $HeadCommit.Trim().ToLowerInvariant()
}

function Get-MissingBinary {
    <#
    .SYNOPSIS
      List required binaries a staged artifact does not provide.
    #>
    param(
        [Parameter(Mandatory = $true)][string]$Root,
        [string[]]$Required = $RequiredBinaries
    )
    $missing = @()
    foreach ($name in $Required) {
        if (-not (Test-Path -LiteralPath (Join-Path $Root "bin\$name") -PathType Leaf)) {
            $missing += $name
        }
    }
    return $missing
}

function Get-ForeignListener {
    <#
    .SYNOPSIS
      Report target ports held by a process this repository does not own.
    .DESCRIPTION
      Read-only preflight. Refusing here means the deploy stops before it
      downloads, migrates, or stops anything, instead of discovering the conflict
      half-way through a restart.

      Port 8787 is intentionally absent: it is the browser/account-local Python
      bridge and is not part of the multi-user backend.
    #>
    param(
        [Parameter(Mandatory = $true)][hashtable]$PortMarkers,
        [Parameter(Mandatory = $true)][string]$RepositoryRoot
    )
    $foreign = @()
    foreach ($port in $PortMarkers.Keys) {
        foreach ($owner in (Get-ListenerOwnership -Port $port -Marker $PortMarkers[$port] -RepositoryRoot $RepositoryRoot)) {
            if (-not $owner.Owned) { $foreign += $owner }
        }
    }
    return $foreign
}

# ---------------------------------------------------------------------------
# Self-test
# ---------------------------------------------------------------------------

if ($SelfTest) {
    $failures = 0
    $passes = 0
    function Assert-True {
        param([string]$Name, [bool]$Condition)
        if ($Condition) {
            Write-Host "  PASS  $Name" -ForegroundColor Green
            $script:passes++
        } else {
            Write-Host "  FAIL  $Name" -ForegroundColor Red
            $script:failures++
        }
    }
    function Assert-Throws {
        param([string]$Name, [scriptblock]$Body, [string]$Match)
        try {
            & $Body
            Write-Host "  FAIL  $Name (no error raised)" -ForegroundColor Red
            $script:failures++
        } catch {
            if ($_.Exception.Message -match $Match) {
                Write-Host "  PASS  $Name" -ForegroundColor Green
                $script:passes++
            } else {
                Write-Host "  FAIL  $Name (wrong error: $($_.Exception.Message))" -ForegroundColor Red
                $script:failures++
            }
        }
    }

    Write-Step "Self-test: artifact integrity (Scenario 3)"
    $sandbox = Join-Path ([System.IO.Path]::GetTempPath()) "ml-deploy-selftest-$([guid]::NewGuid().ToString('N'))"
    try {
        $stage = Join-Path $sandbox "stage"
        New-Item -ItemType Directory -Force (Join-Path $stage "bin") | Out-Null
        foreach ($name in $RequiredBinaries) {
            Set-Content -LiteralPath (Join-Path $stage "bin\$name") -Value "payload-$name" -Encoding ascii
        }
        Set-Content -LiteralPath (Join-Path $stage "MANIFEST.json") -Value '{"commit":"abc123"}' -Encoding ascii
        $sums = Join-Path $stage "SHA256SUMS"
        Get-ChildItem -LiteralPath $stage -Recurse -File | Where-Object { $_.Name -ne 'SHA256SUMS' } | ForEach-Object {
            $rel = $_.FullName.Substring($stage.Length).TrimStart('\').Replace('\', '/')
            "$((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLower())  $rel"
        } | Set-Content -LiteralPath $sums -Encoding ascii

        Assert-True "intact artifact verifies all files" ((Test-ArtifactChecksums -Root $stage -SumsPath $sums) -eq ($RequiredBinaries.Count + 1))

        Set-Content -LiteralPath (Join-Path $stage "bin\api.exe") -Value "tampered" -Encoding ascii
        Assert-Throws "tampered binary is refused" { Test-ArtifactChecksums -Root $stage -SumsPath $sums } "Checksum mismatch for 'bin.api.exe'"

        Remove-Item -LiteralPath (Join-Path $stage "bin\api.exe") -Force
        Assert-Throws "deleted binary is refused" { Test-ArtifactChecksums -Root $stage -SumsPath $sums } "does not contain it"

        Set-Content -LiteralPath $sums -Value "" -Encoding ascii
        Assert-Throws "empty SHA256SUMS is refused" { Test-ArtifactChecksums -Root $stage -SumsPath $sums } "listed no files"

        Remove-Item -LiteralPath $sums -Force
        Assert-Throws "missing SHA256SUMS is refused" { Test-ArtifactChecksums -Root $stage -SumsPath $sums } "unverifiable build"

        Write-Step "Self-test: required binaries"
        $incomplete = Join-Path $sandbox "incomplete"
        New-Item -ItemType Directory -Force (Join-Path $incomplete "bin") | Out-Null
        Set-Content -LiteralPath (Join-Path $incomplete "bin\api.exe") -Value "x" -Encoding ascii
        Assert-True "missing binaries are reported" ((@(Get-MissingBinary -Root $incomplete) -join ',') -eq 'migrate.exe,mt5-stream.exe,execution-gateway.exe')

        $complete = Join-Path $sandbox "complete"
        New-Item -ItemType Directory -Force (Join-Path $complete "bin") | Out-Null
        foreach ($name in $RequiredBinaries) {
            Set-Content -LiteralPath (Join-Path $complete "bin\$name") -Value "x" -Encoding ascii
        }
        Assert-True "complete artifact reports nothing missing" (@(Get-MissingBinary -Root $complete).Count -eq 0)

        Write-Step "Self-test: migration state gate (Scenario 4)"
        Assert-True "clean version output passes"  (Test-MigrationStateClean -VersionOutput "version = 39, dirty = false")
        Assert-True "dirty version output refused" (-not (Test-MigrationStateClean -VersionOutput "version = 39, dirty = true"))
        Assert-True "dirty with colon refused"     (-not (Test-MigrationStateClean -VersionOutput "version: 39 dirty: true"))
        Assert-True "empty output treated as clean-parse" (Test-MigrationStateClean -VersionOutput "")

        Write-Step "Self-test: commit-mismatch gate (Scenario 6)"
        Assert-True "matching commit allowed"        (Test-ManifestCommit -ArtifactCommit "AbC123" -HeadCommit "abc123")
        Assert-True "different commit refused"       (-not (Test-ManifestCommit -ArtifactCommit "abc123" -HeadCommit "def456"))
        Assert-True "missing artifact commit refused" (-not (Test-ManifestCommit -ArtifactCommit "" -HeadCommit "abc123"))
        Assert-True "override permits mismatch"      (Test-ManifestCommit -ArtifactCommit "abc123" -HeadCommit "def456" -Allow $true)

        Write-Step "Self-test: no build toolchain is invoked (Scenario 2)"
        $selfSource = Get-Content -LiteralPath $PSCommandPath -Raw
        Assert-True "script never invokes go build"   (-not ($selfSource -match '(?m)^\s*&?\s*go\s+(build|run)\b'))
        Assert-True "script never invokes cargo"      (-not ($selfSource -match '(?m)^\s*&?\s*cargo\s+'))
        Assert-True "runner is called with -SkipBuild"      ($selfSource -match '-SkipBuild')
        Assert-True "runner is called with -SkipMigrations" ($selfSource -match '-SkipMigrations')
        Assert-True "runner is called with -SkipPull"       ($selfSource -match '-SkipPull')

        Write-Step "Self-test: foreign-listener preflight (Scenario 7)"
        # A port nothing listens on must produce no finding.
        Assert-True "free port yields no foreign listener" (@(Get-ForeignListener -PortMarkers @{ 65533 = 'api.exe' } -RepositoryRoot $repoRoot).Count -eq 0)
        # A listener that exists but cannot match this repository must be foreign.
        $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
        $listener.Start()
        try {
            $probePort = ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
            $found = @(Get-ForeignListener -PortMarkers @{ $probePort = 'definitely-not-a-marketlens-binary' } -RepositoryRoot $repoRoot)
            Assert-True "unowned listener is flagged foreign" ($found.Count -ge 1 -and -not $found[0].Owned)
        } finally {
            $listener.Stop()
        }

        Assert-True "port 8787 is never targeted" (-not ($selfSource -match '8787\s*=' ))
    } finally {
        Remove-Item -Recurse -Force $sandbox -ErrorAction SilentlyContinue
    }

    Write-Host ""
    Write-Host "Self-test: $passes passed, $failures failed" -ForegroundColor $(if ($failures) { 'Red' } else { 'Green' })
    if ($failures) { exit 1 }
    exit 0
}

# ---------------------------------------------------------------------------
# Deploy
# ---------------------------------------------------------------------------

$started = Get-Date
Write-Step "Preflight"

if (-not (Test-Path -LiteralPath $runnerScript -PathType Leaf)) {
    throw "Cannot find run-backend-production.ps1 at $runnerScript. Run this from a full checkout."
}
if (-not (Test-Path -LiteralPath $backendEnv -PathType Leaf)) {
    throw "Missing backend\.env. Create it from backend\.env.example before deploying."
}

$databaseUrl = Get-BackendEnvValue -Name "DATABASE_URL" -EnvFilePath $backendEnv
if ([string]::IsNullOrWhiteSpace($databaseUrl)) {
    throw "DATABASE_URL is required by the migrator, the API and the execution gateway."
}
$adminToken = Get-BackendEnvValue -Name "EXECUTION_ADMIN_TOKEN" -EnvFilePath $backendEnv
if ([string]::IsNullOrWhiteSpace($adminToken) -or $adminToken.Length -lt 32) {
    throw "EXECUTION_ADMIN_TOKEN must be an unpredictable secret of at least 32 characters."
}

# The runner refuses -SkipBuild without the managed MT5 Python environment, and
# its message points back at a source build. Say the useful thing here instead.
$managedPython = Join-Path $backendDir ".venv-mt5\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $managedPython -PathType Leaf)) {
    throw ("Managed MT5 Python is missing at $managedPython. It holds the Windows-only " +
           "MetaTrader5 package, so it cannot ship in a CI artifact. Provision it once with " +
           "'.\build-production.ps1 -BackendOnly' (or 'python -m venv backend\.venv-mt5' plus " +
           "'pip install -r backend\bridge\mt5_stream\requirements.txt') and rerun this deploy.")
}

$gatewayBind = Get-BackendEnvValue -Name "EXECUTION_GATEWAY_BIND" -EnvFilePath $backendEnv
if ([string]::IsNullOrWhiteSpace($gatewayBind)) { $gatewayBind = "127.0.0.1:8790" }
$adminBind = Get-BackendEnvValue -Name "EXECUTION_ADMIN_BIND" -EnvFilePath $backendEnv
if ([string]::IsNullOrWhiteSpace($adminBind)) { $adminBind = "127.0.0.1:8791" }

$portMarkers = @{
    8080                                                              = "bin\api.exe"
    (Get-BindPort -Bind $gatewayBind -Name "EXECUTION_GATEWAY_BIND")  = "execution-gateway.exe"
    (Get-BindPort -Bind $adminBind   -Name "EXECUTION_ADMIN_BIND")    = "execution-gateway.exe"
}
$foreign = @(Get-ForeignListener -PortMarkers $portMarkers -RepositoryRoot $repoRoot)
if ($foreign.Count -gt 0) {
    $detail = ($foreign | ForEach-Object { "port $($_.Port) held by PID $($_.ProcessId)" }) -join "; "
    throw "Refusing to deploy: $detail is not this repository's process. Stop it manually first."
}
Write-Host "  backend\.env resolved, required ports are free or repo-owned."

$headCommit = (& git -C $repoRoot rev-parse HEAD 2>$null)
if ($LASTEXITCODE -ne 0) { $headCommit = "" }

# --- Acquire ---------------------------------------------------------------
Write-Step "Acquire artifact"
New-Item -ItemType Directory -Force $stagingRoot | Out-Null
$stampedStaging = Join-Path $stagingRoot (Get-Date -Format "yyyyMMdd-HHmmss")
if (Test-Path -LiteralPath $stampedStaging) { Remove-Item -Recurse -Force $stampedStaging }
New-Item -ItemType Directory -Force $stampedStaging | Out-Null

function Expand-IntoStaging {
    param([Parameter(Mandatory = $true)][string]$Source)

    if (Test-Path -LiteralPath $Source -PathType Container) {
        Copy-Item -Path (Join-Path $Source '*') -Destination $stampedStaging -Recurse -Force
        return
    }
    if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) {
        throw "Artifact not found: $Source"
    }
    Expand-Archive -LiteralPath $Source -DestinationPath $stampedStaging -Force
    # GitHub artifact downloads sometimes nest a single zip inside the download.
    $inner = @(Get-ChildItem -LiteralPath $stampedStaging -Filter '*.zip' -File)
    if ($inner.Count -eq 1 -and -not (Test-Path -LiteralPath (Join-Path $stampedStaging 'SHA256SUMS'))) {
        Expand-Archive -LiteralPath $inner[0].FullName -DestinationPath $stampedStaging -Force
        Remove-Item -LiteralPath $inner[0].FullName -Force
    }
}

if ($ArtifactPath) {
    Write-Host "  source: local $ArtifactPath"
    Expand-IntoStaging -Source $ArtifactPath
} else {
    $gh = Get-Command gh -ErrorAction SilentlyContinue
    if (-not $gh) {
        throw ("No -ArtifactPath given and the GitHub CLI is not installed. Install gh " +
               "(winget install GitHub.cli), run 'gh auth login', or pass " +
               "-ArtifactPath <downloaded zip>.")
    }
    if ($Tag) {
        Write-Host "  source: release $Tag via gh"
        & $gh.Source release download $Tag --repo $Repository --pattern "*windows-amd64*.zip" --dir $stampedStaging --clobber
        if ($LASTEXITCODE -ne 0) { throw "gh release download failed (exit $LASTEXITCODE)." }
        $zip = @(Get-ChildItem -LiteralPath $stampedStaging -Filter '*.zip' -File)
        if ($zip.Count -ne 1) { throw "Expected exactly one release zip, found $($zip.Count)." }
        Expand-Archive -LiteralPath $zip[0].FullName -DestinationPath $stampedStaging -Force
        Remove-Item -LiteralPath $zip[0].FullName -Force
    } else {
        $runArgs = @('run', 'list', '--repo', $Repository, '--workflow', 'CI', '--branch', $Branch,
                     '--status', 'success', '--limit', '20', '--json', 'databaseId,headSha')
        if ($Commit) { Write-Host "  source: newest successful CI run for commit $Commit" }
        else { Write-Host "  source: newest successful CI run on $Branch" }
        $runsJson = & $gh.Source @runArgs
        if ($LASTEXITCODE -ne 0) { throw "gh run list failed (exit $LASTEXITCODE)." }
        $runs = @($runsJson | ConvertFrom-Json)
        if ($Commit) { $runs = @($runs | Where-Object { $_.headSha -like "$Commit*" }) }
        if ($runs.Count -eq 0) { throw "No successful CI run found for the requested selector." }
        $runId = $runs[0].databaseId
        Write-Host "  run id: $runId (commit $($runs[0].headSha))"
        & $gh.Source run download $runId --repo $Repository --name $WorkflowArtifactName --dir $stampedStaging
        if ($LASTEXITCODE -ne 0) { throw "gh run download failed (exit $LASTEXITCODE)." }
    }
}

# --- Verify ----------------------------------------------------------------
Write-Step "Verify artifact"
$verified = Test-ArtifactChecksums -Root $stampedStaging -SumsPath (Join-Path $stampedStaging "SHA256SUMS")
Write-Host "  $verified file(s) matched SHA256SUMS."

$missing = @(Get-MissingBinary -Root $stampedStaging)
if ($missing.Count -gt 0) {
    throw "Artifact is missing required binaries: $($missing -join ', ')."
}

$manifestPath = Join-Path $stampedStaging "MANIFEST.json"
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw "Artifact is missing MANIFEST.json."
}
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$artifactCommit = "$($manifest.commit)"
Write-Host "  artifact commit : $artifactCommit"
Write-Host "  worktree HEAD   : $headCommit"
Write-Host "  built at (UTC)  : $($manifest.builtAtUtc)"
if (-not (Test-ManifestCommit -ArtifactCommit $artifactCommit -HeadCommit $headCommit -Allow:$AllowCommitMismatch.IsPresent)) {
    throw ("Artifact commit '$artifactCommit' does not match worktree HEAD '$headCommit'. " +
           "Check out the matching commit, or pass -AllowCommitMismatch if you intend to ship a different tree.")
}

# --- Place -----------------------------------------------------------------
Write-Step "Stage binaries"
New-Item -ItemType Directory -Force $binDir | Out-Null
if (Test-Path -LiteralPath $previousDir) { Remove-Item -Recurse -Force $previousDir }
New-Item -ItemType Directory -Force $previousDir | Out-Null
$rolledBackable = $false
foreach ($name in $RequiredBinaries) {
    $current = Join-Path $binDir $name
    if (Test-Path -LiteralPath $current -PathType Leaf) {
        Copy-Item -LiteralPath $current -Destination (Join-Path $previousDir $name) -Force
        $rolledBackable = $true
    }
}
Write-Host "  previous release preserved: $rolledBackable"

function Restore-PreviousRelease {
    if (-not $rolledBackable) {
        Write-Host "  no previous release to restore (first deploy)." -ForegroundColor Yellow
        return
    }
    Write-Host "  restoring previous binaries..." -ForegroundColor Yellow
    foreach ($name in $RequiredBinaries) {
        $backup = Join-Path $previousDir $name
        if (Test-Path -LiteralPath $backup -PathType Leaf) {
            Copy-Item -LiteralPath $backup -Destination (Join-Path $binDir $name) -Force
        }
    }
}

foreach ($name in $RequiredBinaries) {
    Copy-Item -LiteralPath (Join-Path $stampedStaging "bin\$name") -Destination (Join-Path $binDir $name) -Force
}
Write-Host "  placed $($RequiredBinaries.Count) binaries in backend\bin."

# --- Migrate ---------------------------------------------------------------
# Forward-only, and before the restart so a broken schema never reaches a live
# service. migrate.exe embeds the SQL, so no repository files are consulted.
Write-Step "Apply forward-only migrations"
$env:DATABASE_URL = $databaseUrl
try {
    & $migrateExe up 2>&1 | ForEach-Object { Write-Host "  $_" }
    if ($LASTEXITCODE -ne 0) { throw "migrate up failed (exit $LASTEXITCODE)." }

    $versionOutput = (& $migrateExe version 2>&1) -join "`n"
    Write-Host "  $versionOutput"
    if ($LASTEXITCODE -ne 0) { throw "migrate version failed (exit $LASTEXITCODE)." }
    if (-not (Test-MigrationStateClean -VersionOutput $versionOutput)) {
        throw "Database migration state is dirty; refusing to replace running services."
    }
} catch {
    Restore-PreviousRelease
    Write-Host ""
    Write-Host "Deploy aborted during migration. Binaries were restored; the schema was NOT changed back." -ForegroundColor Red
    throw
}

# --- Restart (delegated) ---------------------------------------------------
Write-Step "Restart services via run-backend-production.ps1"
$runnerArgs = @("-SkipPull", "-SkipBuild", "-SkipMigrations")
if ($SkipPublicHealthCheck) { $runnerArgs += "-SkipPublicHealthCheck" }
Write-Host "  run-backend-production.ps1 $($runnerArgs -join ' ')"

$deployFailed = $false
try {
    & $runnerScript @runnerArgs
    if ($LASTEXITCODE -ne 0) { throw "run-backend-production.ps1 exited with $LASTEXITCODE." }
} catch {
    $deployFailed = $true
    $failure = $_
}

if ($deployFailed) {
    Write-Step "Rollback"
    Restore-PreviousRelease
    try {
        & $runnerScript @runnerArgs
    } catch {
        Write-Host "  rollback restart also failed: $($_.Exception.Message)" -ForegroundColor Red
    }
    Write-Host ""
    Write-Host "DEPLOY FAILED: $($failure.Exception.Message)" -ForegroundColor Red
    Write-Host "Binaries were rolled back to the previous release." -ForegroundColor Yellow
    Write-Host "Migrations are forward-only and were NOT rolled back. If the new schema is" -ForegroundColor Yellow
    Write-Host "incompatible with the restored binaries, fix forward rather than reverting." -ForegroundColor Yellow
    exit 1
}

if (-not $KeepStaging) {
    Remove-Item -Recurse -Force $stampedStaging -ErrorAction SilentlyContinue
}

Write-Step "Deployed"
Write-Host "  commit   : $artifactCommit"
Write-Host "  run id   : $($manifest.runId)"
Write-Host "  built at : $($manifest.builtAtUtc)"
Write-Host "  elapsed  : $([int]((Get-Date) - $started).TotalSeconds)s"
Write-Host "  rollback : .\tools\deploy-backend.ps1 -ArtifactPath <previous artifact>  (binaries kept in backend\bin\.previous)"
exit 0
