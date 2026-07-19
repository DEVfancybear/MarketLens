[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$packageDir = Split-Path -Parent $PSCommandPath
$backendDir = Split-Path -Parent (Split-Path -Parent $packageDir)
$buildVenv = Join-Path $backendDir ".venv-connector-build"
$python = Join-Path $buildVenv "Scripts\python.exe"
$managedPython = Join-Path $backendDir ".venv-mt5\Scripts\python.exe"
$requirements = Join-Path $packageDir "requirements-connector-build.txt"
$spec = Join-Path $packageDir "TradingTerminalMT5Connector.spec"
$distDir = Join-Path $backendDir "dist"
$workDir = Join-Path ([System.IO.Path]::GetTempPath()) "TradingTerminalMT5Connector-build"
$artifact = Join-Path $distDir "TradingTerminalMT5Connector.exe"
$userGuide = Join-Path $packageDir "USER_GUIDE.txt"
$releaseStage = Join-Path $distDir "TradingTerminal-MT5-Connector"
$releaseZip = Join-Path $distDir "TradingTerminal-MT5-Connector.zip"
$frontendDownloads = Join-Path (Split-Path -Parent $backendDir) "frontend\public\downloads"
$publishedZip = Join-Path $frontendDownloads "TradingTerminal-MT5-Connector.zip"

if (-not (Test-Path -LiteralPath $python -PathType Leaf)) {
  if (Test-Path -LiteralPath $managedPython -PathType Leaf) {
    & $managedPython -m venv $buildVenv
  } elseif (Get-Command py -ErrorAction SilentlyContinue) {
    & py -3.12 -m venv $buildVenv
  } else {
    throw "Python 3.12 is unavailable for the Connector build."
  }
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $python -PathType Leaf)) {
    throw "Unable to create the isolated MT5 Connector build environment."
  }
}

& $python -m pip install --disable-pip-version-check -r $requirements
if ($LASTEXITCODE -ne 0) {
  throw "Unable to install MT5 Connector build dependencies."
}

& $python -m PyInstaller `
  --noconfirm `
  --clean `
  --distpath $distDir `
  --workpath $workDir `
  $spec
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $artifact -PathType Leaf)) {
  throw "MT5 Connector packaging failed."
}

if (-not (Test-Path -LiteralPath $userGuide -PathType Leaf)) {
  throw "MT5 Connector user guide is missing."
}
if (Test-Path -LiteralPath $releaseStage) {
  Remove-Item -LiteralPath $releaseStage -Recurse -Force
}
New-Item -ItemType Directory -Path $releaseStage -Force | Out-Null
Copy-Item -LiteralPath $artifact -Destination (Join-Path $releaseStage "TradingTerminalMT5Connector.exe")
Copy-Item -LiteralPath $userGuide -Destination (Join-Path $releaseStage "READ-ME.txt")
Compress-Archive -LiteralPath $releaseStage -DestinationPath $releaseZip -CompressionLevel Optimal -Force
New-Item -ItemType Directory -Path $frontendDownloads -Force | Out-Null
Copy-Item -LiteralPath $releaseZip -Destination $publishedZip -Force

Write-Host "MT5 Connector artifact: $artifact" -ForegroundColor Green
Write-Host "MT5 Connector download: $publishedZip" -ForegroundColor Green
