[CmdletBinding()]
param(
  [switch]$SkipMT5PythonSetup,
  [switch]$BackendOnly,
  [switch]$StageApi
)

$ErrorActionPreference = "Stop"

# Builds the deployable Go API and Next.js frontend without starting either
# service. Runtime secrets stay in ignored .env/.env.local files. By default it
# also provisions the Python runtime required by the private MT5 market-data
# sidecar. The Rust execution gateway is always part of the backend artifact.
$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir = Join-Path $repoRoot "backend"
$frontendDir = Join-Path $repoRoot "frontend"
$mt5VenvDir = Join-Path $backendDir ".venv-mt5"
$mt5Python = Join-Path $mt5VenvDir "Scripts\python.exe"
$mt5Requirements = Join-Path $backendDir "bridge\mt5_stream\requirements.txt"
$apiArtifactName = if ($StageApi) { "api.next.exe" } else { "api.exe" }
$apiArtifact = Join-Path $backendDir "bin\$apiArtifactName"
$gatewayArtifactName = if ($StageApi) { "execution-gateway.next.exe" } else { "execution-gateway.exe" }
$gatewayArtifact = Join-Path $backendDir "bin\$gatewayArtifactName"
$executionManifest = Join-Path $backendDir "execution\Cargo.toml"
$builtGateway = Join-Path $backendDir "execution\target\release\execution-gateway.exe"
$eaPublishScript = Join-Path $backendDir "bridge\mt5_ea\Publish-SMCExecutionEA.ps1"

if (-not $SkipMT5PythonSetup) {
  if ($env:OS -ne "Windows_NT") {
    throw "MT5 Python setup requires Windows because the MetaTrader5 package is Windows-only. Use -SkipMT5PythonSetup only for a non-MT5 build."
  }

  if (-not (Test-Path -LiteralPath $mt5Python -PathType Leaf)) {
    Write-Host "Creating MT5 market-data Python environment..." -ForegroundColor Cyan
    $configuredPython = $env:MT5_STREAM_PYTHON
    if ($configuredPython -and (Test-Path -LiteralPath $configuredPython -PathType Leaf)) {
      & $configuredPython -m venv $mt5VenvDir
    } else {
      $pyLauncher = Get-Command py.exe -ErrorAction SilentlyContinue
      $pythonCommand = Get-Command python.exe -ErrorAction SilentlyContinue
      if ($pyLauncher) {
        & $pyLauncher.Source -3 -m venv $mt5VenvDir
      } elseif ($pythonCommand) {
        & $pythonCommand.Source -m venv $mt5VenvDir
      } else {
        throw "Python 3 was not found. Install 64-bit Python for Windows (or set MT5_STREAM_PYTHON to an existing python.exe) and rerun."
      }
    }
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $mt5Python -PathType Leaf)) {
      throw "Failed to create backend\.venv-mt5."
    }
  }

  Write-Host "Installing MT5 market-data dependencies..." -ForegroundColor Cyan
  & $mt5Python -m pip install --disable-pip-version-check --requirement $mt5Requirements
  if ($LASTEXITCODE -ne 0) { throw "MT5 Python dependency install failed (exit $LASTEXITCODE)." }

  & $mt5Python -c "import MetaTrader5, websockets"
  if ($LASTEXITCODE -ne 0) { throw "MT5 Python dependency check failed (exit $LASTEXITCODE)." }

}

$go = Get-Command go -ErrorAction SilentlyContinue
if (-not $go -and (Test-Path "C:\Program Files\Go\bin\go.exe")) {
  $goPath = "C:\Program Files\Go\bin\go.exe"
} elseif ($go) {
  $goPath = $go.Source
} else {
  throw "Go SDK not found. Install Go and rerun this script."
}

Write-Host "Building Go API..." -ForegroundColor Cyan
Push-Location $backendDir
try {
  $env:GOTOOLCHAIN = "auto"
  $env:GOCACHE = Join-Path $repoRoot ".gocache"
  $env:GOTMPDIR = Join-Path $repoRoot ".gotmp"
  New-Item -ItemType Directory -Path $env:GOCACHE, $env:GOTMPDIR -Force | Out-Null
  New-Item -ItemType Directory -Path ".\bin" -Force | Out-Null
  & $goPath build -trimpath -ldflags="-s -w" -o $apiArtifact ".\cmd\api"
  if ($LASTEXITCODE -ne 0) { throw "Go API build failed (exit $LASTEXITCODE)." }
} finally {
  Pop-Location
}

$cargo = Get-Command cargo.exe -ErrorAction SilentlyContinue
if (-not $cargo) { $cargo = Get-Command cargo -ErrorAction SilentlyContinue }
$cargoPath = if ($cargo) { $cargo.Source } else { "" }
$cargoPrefix = @()
if (-not $cargoPath) {
  $portableCargo = Join-Path $repoRoot ".tools\cargo\bin\cargo.exe"
  $portableRustupHome = Join-Path $repoRoot ".tools\rustup"
  if ((Test-Path -LiteralPath $portableCargo -PathType Leaf) -and
      (Test-Path -LiteralPath $portableRustupHome -PathType Container)) {
    $cargoPath = $portableCargo
    $env:CARGO_HOME = Join-Path $repoRoot ".tools\cargo"
    $env:RUSTUP_HOME = $portableRustupHome
    $cargoPrefix = @("+stable-x86_64-pc-windows-gnu")
    $llvmRoot = Join-Path $repoRoot ".tools\llvm-mingw"
    $llvmBin = Get-ChildItem -LiteralPath $llvmRoot -Directory -ErrorAction SilentlyContinue |
      ForEach-Object { Join-Path $_.FullName "bin" } |
      Where-Object { Test-Path -LiteralPath $_ -PathType Container } |
      Select-Object -First 1
    if ($llvmBin) {
      $env:PATH = "$llvmBin;$($env:CARGO_HOME)\bin;$env:PATH"
    }
  }
}
if (-not $cargoPath) {
  throw "Rust Cargo was not found. Install stable Rust or provision the repository toolchain."
}

Write-Host "Building Rust execution gateway..." -ForegroundColor Cyan
& $cargoPath @cargoPrefix build --manifest-path $executionManifest --workspace --locked --release
if ($LASTEXITCODE -ne 0) { throw "Rust execution gateway build failed (exit $LASTEXITCODE)." }
if (-not (Test-Path -LiteralPath $builtGateway -PathType Leaf)) {
  throw "Rust build did not produce backend\execution\target\release\execution-gateway.exe."
}
Copy-Item -LiteralPath $builtGateway -Destination $gatewayArtifact -Force

if (-not $BackendOnly) {
  Write-Host "Verifying downloadable MT5 EA release..." -ForegroundColor Cyan
  & $eaPublishScript -VerifyOnly

  Write-Host "Building Next.js frontend..." -ForegroundColor Cyan
  Push-Location $frontendDir
  try {
    $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if (-not $npm) { $npm = Get-Command npm -ErrorAction SilentlyContinue }
    if (-not $npm) { throw "npm was not found. Install Node.js and rerun this script." }
    if (-not (Test-Path -LiteralPath ".\node_modules" -PathType Container)) {
      Write-Host "Installing frontend dependencies with npm ci..." -ForegroundColor Cyan
      & $npm.Source ci
      if ($LASTEXITCODE -ne 0) { throw "npm ci failed (exit $LASTEXITCODE)." }
    }
    & $npm.Source run build
    if ($LASTEXITCODE -ne 0) { throw "Next.js build failed (exit $LASTEXITCODE)." }
  } finally {
    Pop-Location
  }
}

Write-Host "Production build complete." -ForegroundColor Green
Write-Host "Go artifact: backend\bin\$apiArtifactName"
Write-Host "Rust artifact: backend\bin\$gatewayArtifactName"
if (-not $BackendOnly) { Write-Host "Next artifact: frontend\.next" }
if (-not $SkipMT5PythonSetup) {
  Write-Host "MT5 market-data Python: backend\.venv-mt5\Scripts\python.exe"
}
