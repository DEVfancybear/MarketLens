[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$frontendRoot = Join-Path $repositoryRoot 'frontend'

function Invoke-NpmScript {
  param([Parameter(Mandatory)][string]$Name)

  Write-Host "==> npm run $Name"
  & npm.cmd run $Name
  if ($LASTEXITCODE -ne 0) {
    throw "npm run $Name failed with exit code $LASTEXITCODE"
  }
}

function Invoke-NpmScriptWithGitBash {
  param([Parameter(Mandatory)][string]$Name)

  $gitBash = 'C:\Program Files\Git\bin\bash.exe'
  if (-not (Test-Path -LiteralPath $gitBash)) {
    throw "Git Bash is required to reproduce the Ubuntu glob behavior for npm run $Name"
  }

  $previousScriptShell = $env:npm_config_script_shell
  try {
    $env:npm_config_script_shell = $gitBash
    Invoke-NpmScript $Name
  } finally {
    $env:npm_config_script_shell = $previousScriptShell
  }
}

Push-Location $frontendRoot
try {
  $package = Get-Content -LiteralPath 'package.json' -Raw | ConvertFrom-Json
  $expectedTradeCommand = "npm run test:build && node -e `"const fs=require('node:fs'),cp=require('node:child_process'),dir='.test-build/tests/trade',files=fs.readdirSync(dir).filter(f=>f.endsWith('.test.js')).sort().map(f=>dir+'/'+f); if(files.length===0) process.exit(1); const result=cp.spawnSync(process.execPath,['--require','./.test-build/tests/shims/ky.js','--test',...files],{stdio:'inherit'}); process.exit(result.status??1)`""
  if ($package.scripts.'test:trade' -cne $expectedTradeCommand) {
    throw 'test:trade must preload the Ky bridge and select individual compiled trade test files'
  }

  Invoke-NpmScript 'test:trade'

  $sourceTests = @(Get-ChildItem -LiteralPath 'tests/trade' -Filter '*.test.ts' -File)
  $compiledTests = @(Get-ChildItem -LiteralPath '.test-build/tests/trade' -Filter '*.test.js' -File)
  if ($sourceTests.Count -eq 0 -or $compiledTests.Count -ne $sourceTests.Count) {
    throw "Trade test discovery mismatch: source=$($sourceTests.Count), compiled=$($compiledTests.Count)"
  }

  Invoke-NpmScript 'test:trade'
  Invoke-NpmScript 'check:replay-client-boundary'
  Invoke-NpmScriptWithGitBash 'test:replay'
  Invoke-NpmScript 'typecheck'
  Invoke-NpmScript 'lint'
  Invoke-NpmScript 'build'

  & git diff --exit-code -- package-lock.json
  if ($LASTEXITCODE -ne 0) {
    throw 'Supply-chain check failed: package-lock.json changed'
  }
} finally {
  Pop-Location
}

Write-Host 'GITHUB_CICD_REPAIR_GAUNTLET_OK'
