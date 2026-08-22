<#
.SYNOPSIS
  Fail-closed verification gauntlet for the MarketLens project avatar.

.DESCRIPTION
  Implements docs/agent-evidence/project-avatar/SPEC.md. The command removes
  only known generated frontend directories, runs the complete compiled test
  inventory plus type/lint/build checks, proves the favicon checker rejects a
  corrupt ICO header, exercises the production Next server, and exports the
  final embedded PNG previews for manual inspection.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\verify-project-avatar.ps1
#>
[CmdletBinding()]
param(
    [ValidateRange(1024, 65535)]
    [int]$Port = 3177
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Net.Http

$RepoRoot = Split-Path -Parent $PSScriptRoot
$FrontendDir = Join-Path $RepoRoot 'frontend'
$FaviconPath = Join-Path $FrontendDir 'src/app/favicon.ico'
$FocusedTestPath = Join-Path $FrontendDir '.test-build/tests/architecture/projectAvatar.test.js'
$PreviewDir = Join-Path $FrontendDir '.test-build/project-avatar'
$ExpectedPackageHash = 'AD16B498D95783751C099BF86C72D374DEA5F15DFB3276143ED9D5B5A18E53F4'
$ExpectedLockHash = '3E59C8326ABE025B5C9790D8D85160768C0BB11240153B803EACF7B6AA1399FC'

function Write-Layer {
    param([string]$Name)
    Write-Host ''
    Write-Host ('=' * 78) -ForegroundColor DarkGray
    Write-Host $Name -ForegroundColor Cyan
    Write-Host ('=' * 78) -ForegroundColor DarkGray
}

function Invoke-Native {
    param(
        [Parameter(Mandatory)]
        [string]$FilePath,
        [string[]]$Arguments = @()
    )

    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Native command failed with exit code $LASTEXITCODE`: $FilePath $($Arguments -join ' ')"
    }
}

function Remove-GeneratedDirectory {
    param([Parameter(Mandatory)][string]$Path)

    $frontendRoot = [IO.Path]::GetFullPath($FrontendDir).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
    $resolved = [IO.Path]::GetFullPath($Path)
    if (-not $resolved.StartsWith($frontendRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to remove a path outside frontend: $resolved"
    }
    if (Test-Path -LiteralPath $resolved) {
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}

function Get-Sha256Hex {
    param([Parameter(Mandatory)][byte[]]$Bytes)

    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        return ([BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace('-', '').ToLowerInvariant()
    } finally {
        $sha.Dispose()
    }
}

function Invoke-CompleteTestInventory {
    $compiledTests = @(
        Get-ChildItem -LiteralPath (Join-Path $FrontendDir '.test-build/tests') -Recurse -Filter '*.test.js' |
            Sort-Object FullName |
            ForEach-Object FullName
    )
    if ($compiledTests.Count -eq 0) {
        throw 'The compiled test inventory is empty.'
    }

    New-Item -ItemType Directory -Path $PreviewDir -Force | Out-Null
    $testLog = Join-Path $PreviewDir 'full-tests.log'
    $testOutput = @(& node --test @compiledTests 2>&1)
    $testExit = $LASTEXITCODE
    $testOutput | Set-Content -LiteralPath $testLog -Encoding utf8

    if ($testExit -ne 0) {
        $testOutput | Select-Object -Last 100 | ForEach-Object { Write-Host $_ }
        throw "Complete test inventory failed with exit code $testExit; full log: $testLog"
    }

    Write-Host "Compiled test files: $($compiledTests.Count)"
    $summary = @($testOutput | Where-Object { "$_" -match '^[^A-Za-z0-9]*(tests|suites|pass|fail|cancelled|skipped|todo|duration_ms)\s+' })
    if ($summary.Count -lt 4) {
        throw "Could not parse the Node test summary; full log: $testLog"
    }
    $summary | ForEach-Object { Write-Host $_ }
}

function Invoke-FaviconNegativeControl {
    $original = [IO.File]::ReadAllBytes($FaviconPath)
    $originalHash = Get-Sha256Hex -Bytes $original
    if ($original.Length -lt 6) {
        throw 'Favicon is too short to contain an ICO header.'
    }

    $mutant = [byte[]]$original.Clone()
    $mutant[2] = 2
    try {
        [IO.File]::WriteAllBytes($FaviconPath, $mutant)
        $mutantOutput = @(& node --test $FocusedTestPath 2>&1)
        $mutantExit = $LASTEXITCODE
        if ($mutantExit -eq 0) {
            throw 'Negative control failed open: corrupt ICO type was accepted.'
        }
        if (($mutantOutput -join "`n") -notmatch 'ICO type must identify an icon') {
            $mutantOutput | Select-Object -Last 40 | ForEach-Object { Write-Host $_ }
            throw 'Negative control failed for an unexpected reason.'
        }
    } finally {
        [IO.File]::WriteAllBytes($FaviconPath, $original)
    }

    $restoredHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $FaviconPath).Hash.ToLowerInvariant()
    if ($restoredHash -ne $originalHash) {
        throw 'Favicon negative control did not restore the original bytes.'
    }

    Invoke-Native -FilePath 'node' -Arguments @('--test', $FocusedTestPath)
    Write-Host "Corrupt-header negative control: killed; restored SHA-256 $restoredHash"
}

function Export-FaviconPreviews {
    $bytes = [IO.File]::ReadAllBytes($FaviconPath)
    $count = [BitConverter]::ToUInt16($bytes, 4)
    New-Item -ItemType Directory -Path $PreviewDir -Force | Out-Null
    $exported = [System.Collections.Generic.List[string]]::new()

    for ($index = 0; $index -lt $count; $index++) {
        $entryOffset = 6 + (16 * $index)
        $size = if ($bytes[$entryOffset] -eq 0) { 256 } else { [int]$bytes[$entryOffset] }
        if ($size -notin @(16, 32, 256)) {
            continue
        }
        $payloadLength = [BitConverter]::ToUInt32($bytes, $entryOffset + 8)
        $payloadOffset = [BitConverter]::ToUInt32($bytes, $entryOffset + 12)
        if ($payloadOffset + $payloadLength -gt $bytes.Length) {
            throw "ICO preview payload $size is out of bounds."
        }
        $payload = [byte[]]::new($payloadLength)
        [Array]::Copy($bytes, $payloadOffset, $payload, 0, $payloadLength)
        $previewPath = Join-Path $PreviewDir ("favicon-{0}.png" -f $size)
        [IO.File]::WriteAllBytes($previewPath, $payload)
        $exported.Add($previewPath)
    }

    foreach ($expectedSize in @(16, 32, 256)) {
        if (-not (Test-Path -LiteralPath (Join-Path $PreviewDir ("favicon-{0}.png" -f $expectedSize)))) {
            throw "Expected $expectedSize px preview was not exported."
        }
    }
    Write-Host 'Preview files:'
    $exported | ForEach-Object { Write-Host "  $_" }
}

function Invoke-ProductionSmoke {
    $nodePath = (Get-Command node -ErrorAction Stop).Source
    $stdoutPath = Join-Path $PreviewDir 'next-start.stdout.log'
    $stderrPath = Join-Path $PreviewDir 'next-start.stderr.log'
    $process = $null
    $client = [Net.Http.HttpClient]::new()
    $client.Timeout = [TimeSpan]::FromSeconds(3)
    $rootUri = [Uri]("http://127.0.0.1:{0}/" -f $Port)

    try {
        $process = Start-Process -FilePath $nodePath `
            -ArgumentList @('node_modules/next/dist/bin/next', 'start', '-p', "$Port") `
            -WorkingDirectory $FrontendDir `
            -RedirectStandardOutput $stdoutPath `
            -RedirectStandardError $stderrPath `
            -WindowStyle Hidden `
            -PassThru

        $html = $null
        for ($attempt = 0; $attempt -lt 60; $attempt++) {
            if ($process.HasExited) {
                break
            }
            try {
                $response = $client.GetAsync($rootUri).GetAwaiter().GetResult()
                if ($response.IsSuccessStatusCode) {
                    $html = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
                    $response.Dispose()
                    break
                }
                $response.Dispose()
            } catch {
                # Startup connection failures are expected until the local socket is ready.
            }
            Start-Sleep -Milliseconds 500
        }

        if ($null -eq $html) {
            $serverError = if (Test-Path -LiteralPath $stderrPath) {
                (Get-Content -LiteralPath $stderrPath -Raw)
            } else {
                '<no stderr log>'
            }
            throw "Next production server did not become ready. $serverError"
        }

        $iconHref = $null
        foreach ($match in [regex]::Matches($html, '<link\b[^>]*>', [Text.RegularExpressions.RegexOptions]::IgnoreCase)) {
            $tag = $match.Value
            if ($tag -notmatch 'rel\s*=\s*["'']icon["'']') {
                continue
            }
            $hrefMatch = [regex]::Match($tag, 'href\s*=\s*["'']([^"'']+)["'']', [Text.RegularExpressions.RegexOptions]::IgnoreCase)
            if ($hrefMatch.Success -and $hrefMatch.Groups[1].Value.StartsWith('/favicon.ico', [StringComparison]::Ordinal)) {
                $iconHref = [Net.WebUtility]::HtmlDecode($hrefMatch.Groups[1].Value)
                break
            }
        }
        if ($null -eq $iconHref) {
            throw 'Rendered root HTML did not publish a /favicon.ico link.'
        }

        $iconUri = [Uri]::new($rootUri, $iconHref)
        $iconResponse = $client.GetAsync($iconUri).GetAwaiter().GetResult()
        try {
            if (-not $iconResponse.IsSuccessStatusCode) {
                throw "Favicon request returned HTTP $([int]$iconResponse.StatusCode)."
            }
            $contentType = $iconResponse.Content.Headers.ContentType.MediaType
            if ($null -eq $contentType -or -not $contentType.StartsWith('image/', [StringComparison]::OrdinalIgnoreCase)) {
                throw "Favicon response content type was not an image: $contentType"
            }
            $servedBytes = $iconResponse.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()
        } finally {
            $iconResponse.Dispose()
        }

        $fileHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $FaviconPath).Hash.ToLowerInvariant()
        $servedHash = Get-Sha256Hex -Bytes $servedBytes
        if ($servedHash -ne $fileHash) {
            throw "Served favicon hash $servedHash did not match source hash $fileHash."
        }

        Write-Host "Root HTML favicon href: $iconHref"
        Write-Host "Favicon HTTP: 200 $contentType $($servedBytes.Length) bytes"
        Write-Host "Favicon SHA-256: $servedHash"
    } finally {
        $client.Dispose()
        if ($null -ne $process -and -not $process.HasExited) {
            Stop-Process -Id $process.Id -Force
            Wait-Process -Id $process.Id -ErrorAction SilentlyContinue
        }
        if ($null -ne $process) {
            $process.Dispose()
        }
    }
}

function Test-SecretPatterns {
    param([Parameter(Mandatory)][string]$Text)

    $patterns = @(
        '(?<![A-Z0-9])AKIA[A-Z0-9]{16}(?![A-Z0-9])',
        '-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',
        '(?<![A-Za-z0-9])ghp_[A-Za-z0-9]{36}(?![A-Za-z0-9])'
    )
    foreach ($pattern in $patterns) {
        if ($Text -match $pattern) {
            return $true
        }
    }
    return $false
}

function Invoke-TaskScopeChecks {
    $packageHash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $FrontendDir 'package.json')).Hash
    $lockHash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $FrontendDir 'package-lock.json')).Hash
    if ($packageHash -ne $ExpectedPackageHash -or $lockHash -ne $ExpectedLockHash) {
        throw 'Frontend package manifests changed from the approved dependency baseline.'
    }

    $taskTextPaths = @(
        (Join-Path $RepoRoot 'docs/agent-evidence/project-avatar/SPEC.md'),
        (Join-Path $FrontendDir 'tests/architecture/projectAvatar.test.ts'),
        (Join-Path $RepoRoot 'tools/verify-project-avatar.ps1')
    )
    $knownBadControl = 'AKIA' + ('A' * 16)
    if (-not (Test-SecretPatterns -Text $knownBadControl)) {
        throw 'Secret checker negative control failed open.'
    }
    foreach ($path in $taskTextPaths) {
        if (-not (Test-Path -LiteralPath $path)) {
            throw "Expected task file is missing: $path"
        }
        if (Test-SecretPatterns -Text (Get-Content -LiteralPath $path -Raw)) {
            throw "Potential credential pattern detected in task file: $path"
        }
    }

    Push-Location $RepoRoot
    try {
        Invoke-Native -FilePath 'git' -Arguments @(
            'diff', '--check', '--',
            'docs/agent-evidence/project-avatar/SPEC.md',
            'frontend/tests/architecture/projectAvatar.test.ts',
            'tools/verify-project-avatar.ps1'
        )
    } finally {
        Pop-Location
    }

    Write-Host 'Dependency hashes unchanged; no credential pattern found in task text files.'
    Write-Host 'Capability review: one static favicon; no new runtime API, network, process, filesystem, or environment access.'
}

Write-Layer 'Toolchain and fresh generated state'
$nodeVersion = (& node --version).Trim()
$npmVersion = (& npm --version).Trim()
$nextVersion = (Get-Content -LiteralPath (Join-Path $FrontendDir 'node_modules/next/package.json') -Raw | ConvertFrom-Json).version
$sharpVersion = (Get-Content -LiteralPath (Join-Path $FrontendDir 'node_modules/sharp/package.json') -Raw | ConvertFrom-Json).version
Write-Host "Node $nodeVersion; npm $npmVersion; Next $nextVersion; Sharp $sharpVersion"
Remove-GeneratedDirectory -Path (Join-Path $FrontendDir '.test-build')
Remove-GeneratedDirectory -Path (Join-Path $FrontendDir '.next')

Push-Location $FrontendDir
try {
    Write-Layer 'Complete TypeScript test inventory'
    Invoke-Native -FilePath 'npm' -Arguments @('run', 'test:build')
    Invoke-CompleteTestInventory

    Write-Layer 'Static type checking'
    Invoke-Native -FilePath 'npm' -Arguments @('run', 'typecheck')

    Write-Layer 'Lint'
    Invoke-Native -FilePath 'npm' -Arguments @('run', 'lint')

    Write-Layer 'Favicon checker negative control'
    Invoke-FaviconNegativeControl

    Write-Layer 'Production build'
    Invoke-Native -FilePath 'npm' -Arguments @('run', 'build')

    Write-Layer 'Real Next.js production execution'
    New-Item -ItemType Directory -Path $PreviewDir -Force | Out-Null
    Invoke-ProductionSmoke

    Write-Layer 'Embedded visual previews'
    Export-FaviconPreviews
} finally {
    Pop-Location
}

Write-Layer 'Task scope, dependency, capability, and secret checks'
Invoke-TaskScopeChecks

Write-Host ''
Write-Host 'All applicable project-avatar gauntlet layers passed.' -ForegroundColor Green
