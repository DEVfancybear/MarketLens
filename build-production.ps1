$ErrorActionPreference = "Stop"

# Builds the deployable Go API and Next.js frontend without starting either
# service. Runtime secrets stay in ignored .env/.env.local files.
$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir = Join-Path $repoRoot "backend"
$frontendDir = Join-Path $repoRoot "frontend"

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
  & $goPath build -trimpath -ldflags="-s -w" -o ".\bin\api.exe" ".\cmd\api"
  if ($LASTEXITCODE -ne 0) { throw "Go API build failed (exit $LASTEXITCODE)." }
} finally {
  Pop-Location
}

Write-Host "Building Next.js frontend..." -ForegroundColor Cyan
Push-Location $frontendDir
try {
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "Next.js build failed (exit $LASTEXITCODE)." }
} finally {
  Pop-Location
}

Write-Host "Production build complete." -ForegroundColor Green
Write-Host "Go artifact: backend\bin\api.exe"
Write-Host "Next artifact: frontend\.next"
