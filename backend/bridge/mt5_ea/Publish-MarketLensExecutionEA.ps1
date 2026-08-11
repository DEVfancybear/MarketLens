[CmdletBinding()]
param(
    [string]$MetaEditorPath = "",
    [switch]$VerifyOnly
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$sourcePath = Join-Path $PSScriptRoot "MarketLensExecutionEA.mq5"
$compiledPath = Join-Path $PSScriptRoot "MarketLensExecutionEA.ex5"
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\..\.."))
$releaseDirectory = Join-Path $repoRoot "frontend\public\downloads"
$releasePath = Join-Path $releaseDirectory "MarketLensExecutionEA.ex5"
$checksumPath = Join-Path $releaseDirectory "MarketLensExecutionEA.sha256.txt"
$manifestPath = Join-Path $releaseDirectory "MarketLensExecutionEA.release.json"

function Get-Sha256([string]$Path) {
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToUpperInvariant()
}

function Assert-Release {
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
        throw "EA source was not found: $sourcePath"
    }
    if (-not (Test-Path -LiteralPath $releasePath -PathType Leaf)) {
        throw "Published EA was not found: $releasePath"
    }
    if (-not (Test-Path -LiteralPath $checksumPath -PathType Leaf)) {
        throw "EA checksum was not found: $checksumPath"
    }
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        throw "EA release manifest was not found: $manifestPath"
    }

    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    $sourceHash = Get-Sha256 $sourcePath
    $binaryHash = Get-Sha256 $releasePath
    if ($manifest.schemaVersion -ne 1) {
        throw "Unsupported EA release manifest schema."
    }
    if ($manifest.sourceSha256 -ne $sourceHash) {
        throw "Published EA is stale. Run backend\bridge\mt5_ea\Publish-MarketLensExecutionEA.ps1 on a trusted Windows build host."
    }
    if ($manifest.binarySha256 -ne $binaryHash) {
        throw "Published EA hash does not match its release manifest."
    }

    $checksum = (Get-Content -LiteralPath $checksumPath -Raw).Trim()
    $expectedChecksum = "$binaryHash  MarketLensExecutionEA.ex5"
    if ($checksum -cne $expectedChecksum) {
        throw "Published EA checksum file does not match the binary."
    }

    Write-Host "Verified MT5 EA release: $binaryHash" -ForegroundColor Green
}

function Resolve-MetaEditor {
    if ($MetaEditorPath) {
        if (-not (Test-Path -LiteralPath $MetaEditorPath -PathType Leaf)) {
            throw "MetaEditor64.exe was not found: $MetaEditorPath"
        }
        return (Get-Item -LiteralPath $MetaEditorPath).FullName
    }

    $candidates = [System.Collections.Generic.List[string]]::new()
    if ($env:METAEDITOR64_PATH) {
        $candidates.Add($env:METAEDITOR64_PATH)
    }
    $command = Get-Command MetaEditor64.exe -ErrorAction SilentlyContinue
    if ($command) {
        $candidates.Add($command.Source)
    }
    $candidates.Add("C:\Program Files\MetaTrader 5\MetaEditor64.exe")

    $terminalRoot = Join-Path ([Environment]::GetFolderPath("ApplicationData")) "MetaQuotes\Terminal"
    if (Test-Path -LiteralPath $terminalRoot -PathType Container) {
        Get-ChildItem -LiteralPath $terminalRoot -Directory -ErrorAction SilentlyContinue |
            ForEach-Object {
                $originPath = Join-Path $_.FullName "origin.txt"
                if (Test-Path -LiteralPath $originPath -PathType Leaf) {
                    $terminalDirectory = (Get-Content -LiteralPath $originPath -Raw).Trim()
                    if ($terminalDirectory) {
                        $candidates.Add((Join-Path $terminalDirectory "MetaEditor64.exe"))
                    }
                }
            }
    }

    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            return (Get-Item -LiteralPath $candidate).FullName
        }
    }
    throw "MetaEditor64.exe was not found. Set METAEDITOR64_PATH or pass -MetaEditorPath."
}

if ($VerifyOnly) {
    Assert-Release
    return
}

$metaEditor = Resolve-MetaEditor
$compileLog = Join-Path $PSScriptRoot "MarketLensExecutionEA.compile.log"
Remove-Item -LiteralPath $compileLog -Force -ErrorAction SilentlyContinue

Write-Host "Compiling the common MT5 EA..." -ForegroundColor Cyan
$compile = Start-Process -FilePath $metaEditor `
    -ArgumentList "/compile:`"$sourcePath`"", "/log:`"$compileLog`"" `
    -WindowStyle Hidden `
    -Wait `
    -PassThru
$compileOutput = Get-Content -LiteralPath $compileLog -Raw -ErrorAction SilentlyContinue
if ($compileOutput -notmatch "Result:\s+0 errors,\s+0 warnings") {
    throw "MQL5 compilation did not finish with 0 errors and 0 warnings (MetaEditor exit $($compile.ExitCode)). See $compileLog"
}
if (-not (Test-Path -LiteralPath $compiledPath -PathType Leaf)) {
    throw "MetaEditor did not produce $compiledPath"
}

New-Item -ItemType Directory -Path $releaseDirectory -Force | Out-Null
Copy-Item -LiteralPath $compiledPath -Destination $releasePath -Force

$sourceHash = Get-Sha256 $sourcePath
$binaryHash = Get-Sha256 $releasePath
"$binaryHash  MarketLensExecutionEA.ex5" |
    Set-Content -LiteralPath $checksumPath -Encoding ascii -NoNewline
[ordered]@{
    schemaVersion = 1
    fileName = "MarketLensExecutionEA.ex5"
    sourceSha256 = $sourceHash
    binarySha256 = $binaryHash
} |
    ConvertTo-Json |
    Set-Content -LiteralPath $manifestPath -Encoding utf8

Assert-Release
Write-Host "Published EA: frontend\public\downloads\MarketLensExecutionEA.ex5" -ForegroundColor Green
