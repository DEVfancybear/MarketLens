param(
    [string]$TerminalPath = "C:\Program Files\MetaTrader 5\terminal64.exe",
    [switch]$LaunchWithHelper
)

$ErrorActionPreference = "Stop"

$terminal = Get-Item -LiteralPath $TerminalPath
$terminalDirectory = $terminal.Directory.FullName
$metaEditor = Join-Path $terminalDirectory "MetaEditor64.exe"
if (-not (Test-Path -LiteralPath $metaEditor)) {
    throw "MetaEditor64.exe was not found beside $TerminalPath"
}

$terminalRoot = Join-Path ([Environment]::GetFolderPath("ApplicationData")) "MetaQuotes\Terminal"
$dataDirectory = Get-ChildItem -LiteralPath $terminalRoot -Directory |
    Where-Object { $_.Name -ne "Common" } |
    Where-Object {
        $origin = Join-Path $_.FullName "origin.txt"
        if (-not (Test-Path -LiteralPath $origin)) { return $false }
        $installedAt = (Get-Content -LiteralPath $origin -Raw).Trim()
        return [System.StringComparer]::OrdinalIgnoreCase.Equals(
            [System.IO.Path]::GetFullPath($installedAt).TrimEnd('\'),
            [System.IO.Path]::GetFullPath($terminalDirectory).TrimEnd('\')
        )
    } |
    Select-Object -First 1

if (-not $dataDirectory) {
    throw "MT5 data directory was not found. Start this terminal once, then run the installer again."
}

$source = Join-Path $PSScriptRoot "TradingSessionBridge.mq5"
$expertDirectory = Join-Path $dataDirectory.FullName "MQL5\Experts\MarketLens"
$expertSource = Join-Path $expertDirectory "TradingSessionBridge.mq5"
$compileLog = Join-Path $PSScriptRoot "TradingSessionBridge.compile.log"
New-Item -ItemType Directory -Path $expertDirectory -Force | Out-Null
Copy-Item -LiteralPath $source -Destination $expertSource -Force

$compile = Start-Process -FilePath $metaEditor `
    -ArgumentList "/compile:`"$expertSource`"", "/log:`"$compileLog`"" `
    -Wait -PassThru
$logText = Get-Content -LiteralPath $compileLog -Raw -ErrorAction SilentlyContinue
if ($logText -notmatch "Result:\s+0 errors") {
    throw "MQL5 helper compilation failed. See $compileLog"
}

Write-Host "Installed exact MT5 session helper: $expertSource"

if ($LaunchWithHelper) {
    $runningTerminal = Get-CimInstance Win32_Process -Filter "Name = 'terminal64.exe'" |
        Where-Object {
            $_.ExecutablePath -and
            [System.StringComparer]::OrdinalIgnoreCase.Equals($_.ExecutablePath, $terminal.FullName)
        } |
        Select-Object -First 1
    if ($runningTerminal) {
        throw "MT5 is already running. Close it first, then rerun with -LaunchWithHelper."
    }
    $startupConfig = Join-Path $PSScriptRoot "mt5-session-startup.ini"
    Start-Process -FilePath $terminal.FullName -ArgumentList "/config:`"$startupConfig`""
    Write-Host "MT5 launched with TradingSessionBridge attached to a non-trading chart."
} else {
    Write-Host "Attach MarketLens\TradingSessionBridge to one chart, or rerun with -LaunchWithHelper after closing MT5."
}
