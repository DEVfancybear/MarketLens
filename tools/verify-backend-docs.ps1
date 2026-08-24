[CmdletBinding()]
param(
    [switch]$DocsOnly,
    [switch]$NegativeControl
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$backendDocs = Join-Path $repoRoot 'backend\docs'
$apiDoc = Join-Path $backendDocs 'API.md'
$configDoc = Join-Path $backendDocs 'CONFIGURATION.md'
$databaseDoc = Join-Path $backendDocs 'DATABASE.md'
$productionDoc = Join-Path $backendDocs 'PRODUCTION_BUILD.md'
$indexDoc = Join-Path $backendDocs 'README.md'

$script:checks = 0
$script:failures = [Collections.Generic.List[string]]::new()

function Assert-True {
    param(
        [Parameter(Mandatory = $true)][bool]$Condition,
        [Parameter(Mandatory = $true)][string]$Message
    )
    $script:checks++
    if (-not $Condition) {
        $script:failures.Add($Message)
    }
}

function Assert-Contains {
    param(
        [Parameter(Mandatory = $true)][string]$Text,
        [Parameter(Mandatory = $true)][string]$Needle,
        [Parameter(Mandatory = $true)][string]$Context
    )
    Assert-True -Condition ($Text.IndexOf($Needle, [StringComparison]::Ordinal) -ge 0) `
        -Message "$Context is missing '$Needle'"
}

if ($NegativeControl) {
    Assert-Contains -Text 'known-bad-document' -Needle 'required-current-contract' `
        -Context 'negative control'
    if ($script:failures.Count -eq 0) {
        throw 'negative control unexpectedly passed'
    }
    $script:failures | ForEach-Object { Write-Error $_ -ErrorAction Continue }
    exit 1
}

Write-Host 'Backend documentation gauntlet' -ForegroundColor Cyan

# Prove the custom assertion path rejects a known-bad in-memory document.
$previousErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try {
    $negativeOutput = & powershell -NoProfile -ExecutionPolicy Bypass -File $PSCommandPath `
        -NegativeControl 2>&1
    $negativeExit = $LASTEXITCODE
} finally {
    $ErrorActionPreference = $previousErrorActionPreference
}
Assert-True -Condition ($negativeExit -ne 0) `
    -Message 'negative control did not exit nonzero'
Write-Host "  negative control: rejected known-bad input (exit $negativeExit)"

$activeDocs = @(
    'backend\docs\README.md',
    'backend\docs\ARCHITECTURE.md',
    'backend\docs\API.md',
    'backend\docs\AUTH.md',
    'backend\docs\CONFIGURATION.md',
    'backend\docs\DATABASE.md',
    'backend\docs\PRODUCTION_BUILD.md',
    'backend\docs\BACKEND_IMPLEMENTATION_PLAN.md',
    'backend\README.md',
    'backend\execution\README.md',
    'backend\bridge\mt5_ea\README.md',
    'backend\bridge\mt5_session\README.md',
    'backend\bridge\mt5_stream\README.md',
    'backend\bridge\mt5_vm\README.md'
)

$activePaths = foreach ($relative in $activeDocs) {
    $path = Join-Path $repoRoot $relative
    Assert-True -Condition (Test-Path -LiteralPath $path -PathType Leaf) `
        -Message "required active document is missing: $relative"
    if (Test-Path -LiteralPath $path -PathType Leaf) { $path }
}

$migrationNames = @(Get-ChildItem -LiteralPath (Join-Path $repoRoot 'backend\migrations') `
    -Filter '*.up.sql' -File | Sort-Object Name | Select-Object -ExpandProperty BaseName)
Assert-True -Condition ($migrationNames.Count -gt 0) -Message 'no up migrations found'
$migrationHead = if ($migrationNames.Count -gt 0) { $migrationNames[-1].Split('_')[0] } else { '' }

$indexText = Get-Content -LiteralPath $indexDoc -Raw
$databaseText = Get-Content -LiteralPath $databaseDoc -Raw
$productionText = Get-Content -LiteralPath $productionDoc -Raw
$apiText = Get-Content -LiteralPath $apiDoc -Raw
$configText = Get-Content -LiteralPath $configDoc -Raw

Assert-Contains -Text $indexText -Needle "migration head: ``$migrationHead``" -Context 'backend docs index'
Assert-Contains -Text $databaseText -Needle "Migration head: ``$migrationHead``" -Context 'database reference'
Assert-Contains -Text $productionText -Needle '.\run-backend-production.ps1' -Context 'production runbook'
Assert-Contains -Text $productionText -Needle '.\tools\deploy-backend.ps1' -Context 'production runbook'
Assert-Contains -Text $productionText -Needle '-SkipPull -SkipBuild -SkipMigrations' `
    -Context 'artifact deploy delegation contract'

$requiredArchitectureFacts = @(
    'Go API/BFF',
    'Rust execution gateway',
    'common MT5 EA',
    'MT5 Windows worker',
    'Windows Credential Manager',
    '127.0.0.1:8790',
    '127.0.0.1:8791',
    'localhost:8765'
)
$architectureText = Get-Content -LiteralPath (Join-Path $backendDocs 'ARCHITECTURE.md') -Raw
foreach ($fact in $requiredArchitectureFacts) {
    Assert-Contains -Text $architectureText -Needle $fact -Context 'architecture reference'
}

$forbiddenActivePatterns = [ordered]@{
    'browser-local execution port 8787' = '(?i)\b8787\b'
    'removed mt5verify package' = '(?i)\bmt5verify\b'
    'removed ftmo_mt5 bridge' = '(?i)bridge[/\\]ftmo_mt5'
    'removed MT5 verifier variables' = '(?i)\bMT5_VERIFY_[A-Z0-9_]+'
    'removed frontend bridge variable' = '(?i)\bNEXT_PUBLIC_MT5_BRIDGE_URL\b'
    'obsolete planned Phase 13 statement' = '(?i)Phase 13 resources remain planned'
    'removed Vault runtime dependency' = '(?i)\b(?:MT5_VAULT_[A-Z0-9_]+|internal[/\\]mt5vault|Vault KV v2)\b'
}
foreach ($entry in $forbiddenActivePatterns.GetEnumerator()) {
    foreach ($path in Get-ChildItem -LiteralPath $backendDocs -Filter '*.md' -File) {
        $matches = [regex]::Matches((Get-Content -LiteralPath $path.FullName -Raw), $entry.Value)
        Assert-True -Condition ($matches.Count -eq 0) `
            -Message "$($path.Name) contains $($entry.Key)"
    }
}

# Every environment key in the canonical backend example must be discoverable in the config reference.
$envKeys = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
foreach ($line in Get-Content -LiteralPath (Join-Path $repoRoot 'backend\.env.example')) {
    if ($line -match '^([A-Z][A-Z0-9_]*)=') { [void]$envKeys.Add($Matches[1]) }
}
foreach ($key in ($envKeys | Sort-Object)) {
    Assert-Contains -Text $configText -Needle "``$key``" -Context 'configuration reference'
}

# Derive Go route literals from current registrars and require a literal METHOD + full path catalog.
$routeFiles = @(
    Get-ChildItem -LiteralPath (Join-Path $repoRoot 'backend\internal') -Recurse -File -Filter '*.go' |
        Where-Object {
            $_.Name -notlike '*_test.go' -and
            ($_.Name -eq 'handler.go' -or $_.Name -eq 'integrations.go' -or
             $_.Name -eq 'mt5_connector_handler.go')
        }
)
$goRoutes = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
foreach ($file in $routeFiles) {
    $raw = Get-Content -LiteralPath $file.FullName -Raw
    $groups = @{ router = '' }
    foreach ($match in [regex]::Matches(
        $raw,
        '(?ms)([A-Za-z_][A-Za-z0-9_]*)\s*:=\s*router\.Group\(\s*"([^"]+)"'
    )) {
        $groups[$match.Groups[1].Value] = $match.Groups[2].Value
    }
    foreach ($match in [regex]::Matches(
        $raw,
        '(?ms)([A-Za-z_][A-Za-z0-9_]*)\.(Get|Post|Put|Patch|Delete)\(\s*"([^"]+)"'
    )) {
        $receiver = $match.Groups[1].Value
        if (-not $groups.ContainsKey($receiver)) { continue }
        $method = $match.Groups[2].Value.ToUpperInvariant()
        $route = "$($groups[$receiver])$($match.Groups[3].Value)"
        if ($route.StartsWith('/execution-ea/')) { continue }
        $route = ('/api/v1' + $route).TrimEnd('/')
        [void]$goRoutes.Add("$method $route")
    }
}
[void]$goRoutes.Add('GET /health')
[void]$goRoutes.Add('GET /health/ready')
[void]$goRoutes.Add('GET /execution-ea/health')
[void]$goRoutes.Add('POST /execution-ea/v1/ea/sessions')
[void]$goRoutes.Add('POST /execution-ea/v1/ea/poll')
[void]$goRoutes.Add('POST /execution-ea/v1/ea/events')
foreach ($route in ($goRoutes | Sort-Object)) {
    Assert-Contains -Text $apiText -Needle $route -Context 'API route catalog'
}

$rustBoundaryFacts = @(
    '/v1/ea/sessions',
    '/v1/admin/accounts',
    '/v1/mt5-vm/workers/hello',
    '/v1/admin/mt5-vm/accounts'
)
foreach ($route in $rustBoundaryFacts) {
    Assert-Contains -Text $apiText -Needle $route -Context 'Rust boundary catalog'
}

# Resolve relative Markdown links in the active set. Anchors and external schemes are excluded.
foreach ($path in $activePaths) {
    $raw = Get-Content -LiteralPath $path -Raw
    foreach ($match in [regex]::Matches($raw, '\[[^\]]+\]\(([^)]+)\)')) {
        $target = $match.Groups[1].Value.Trim().Trim('<', '>')
        if ($target -match '^(?i:https?|mailto):' -or $target.StartsWith('#')) { continue }
        $target = ($target -split '#', 2)[0]
        if ([string]::IsNullOrWhiteSpace($target)) { continue }
        $resolved = [IO.Path]::GetFullPath((Join-Path (Split-Path -Parent $path) $target))
        Assert-True -Condition (Test-Path -LiteralPath $resolved) `
            -Message "broken relative link in $path`: $target"
    }
}

foreach ($path in $activePaths) {
    $lineNumber = 0
    foreach ($line in Get-Content -LiteralPath $path) {
        $lineNumber++
        Assert-True -Condition (-not $line.EndsWith(' ')) `
            -Message "trailing whitespace: $path`:$lineNumber"
    }
}

$allActiveText = ($activePaths | ForEach-Object { Get-Content -LiteralPath $_ -Raw }) -join "`n"
foreach ($secretPattern in @('-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----', 'ghp_[A-Za-z0-9]{30,}')) {
    Assert-True -Condition (-not [regex]::IsMatch($allActiveText, $secretPattern)) `
        -Message "active backend docs contain a secret-like pattern: $secretPattern"
}

if (-not $DocsOnly) {
    Write-Host '  running targeted Go contract tests...'
    Push-Location (Join-Path $repoRoot 'backend')
    try {
        & go test ./internal/config ./internal/auth ./internal/httpserver ./internal/execution ./internal/tradeauth ./cmd/api
        Assert-True -Condition ($LASTEXITCODE -eq 0) -Message 'targeted Go contract tests failed'
    } finally {
        Pop-Location
    }
}

if ($script:failures.Count -gt 0) {
    Write-Host "Backend documentation gauntlet FAILED: $($script:failures.Count) of $script:checks checks failed." -ForegroundColor Red
    $script:failures | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
    exit 1
}

Write-Host "Backend documentation gauntlet PASSED: $script:checks checks; $($goRoutes.Count) Go routes; $($envKeys.Count) environment keys; migration head $migrationHead." -ForegroundColor Green
exit 0
