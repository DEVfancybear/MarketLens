[CmdletBinding()]
param(
  [switch]$SkipMT5PythonSetup
)

$ErrorActionPreference = "Stop"

# Builds the deployable Go API and Next.js frontend without starting either
# service. Runtime secrets stay in ignored .env/.env.local files. By default it
# also provisions the Python runtime required by per-user MT5 verification.
$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir = Join-Path $repoRoot "backend"
$frontendDir = Join-Path $repoRoot "frontend"
$mt5VenvDir = Join-Path $backendDir ".venv-mt5"
$mt5Python = Join-Path $mt5VenvDir "Scripts\python.exe"
$mt5Requirements = Join-Path $backendDir "bridge\ftmo_mt5\requirements.txt"

if (-not $SkipMT5PythonSetup) {
  if ($env:OS -ne "Windows_NT") {
    throw "MT5 Python setup requires Windows because the MetaTrader5 package is Windows-only. Use -SkipMT5PythonSetup only for a non-MT5 build."
  }

  if (-not (Test-Path -LiteralPath $mt5Python -PathType Leaf)) {
    Write-Host "Creating MT5 verifier Python environment..." -ForegroundColor Cyan
    $configuredPython = $env:MT5_VERIFY_PYTHON
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
        throw "Python 3 was not found. Install 64-bit Python for Windows (or set MT5_VERIFY_PYTHON to an existing python.exe) and rerun."
      }
    }
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $mt5Python -PathType Leaf)) {
      throw "Failed to create backend\.venv-mt5."
    }
  }

  Write-Host "Installing MT5 verifier dependencies..." -ForegroundColor Cyan
  & $mt5Python -m pip install --disable-pip-version-check --requirement $mt5Requirements
  if ($LASTEXITCODE -ne 0) { throw "MT5 Python dependency install failed (exit $LASTEXITCODE)." }

  & $mt5Python -c "import MetaTrader5, websockets"
  if ($LASTEXITCODE -ne 0) { throw "MT5 Python dependency check failed (exit $LASTEXITCODE)." }

  if ($env:MT5_VERIFY_TERMINAL_PATH -and -not (Test-Path -LiteralPath $env:MT5_VERIFY_TERMINAL_PATH -PathType Leaf)) {
    throw "MT5_VERIFY_TERMINAL_PATH does not point to terminal64.exe: $env:MT5_VERIFY_TERMINAL_PATH"
  }
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
  $env:GOTOOLCHAIN = "local"
  New-Item -ItemType Directory -Path ".\bin" -Force | Out-Null
  & $goPath build -trimpath -ldflags="-s -w" -o ".\bin\api.exe" ".\cmd\api"
  if ($LASTEXITCODE -ne 0) { throw "Go API build failed (exit $LASTEXITCODE)." }
} finally {
  Pop-Location
}

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

Write-Host "Production build complete." -ForegroundColor Green
Write-Host "Go artifact: backend\bin\api.exe"
Write-Host "Next artifact: frontend\.next"
if (-not $SkipMT5PythonSetup) {
  Write-Host "MT5 verifier Python: backend\.venv-mt5\Scripts\python.exe"
  Write-Host "The Go API auto-detects this venv when MT5_VERIFY_PYTHON is unset."
}
