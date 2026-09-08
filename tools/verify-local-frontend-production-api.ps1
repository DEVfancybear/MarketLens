$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$frontend = Join-Path $repo 'frontend'
$runDir = Join-Path $repo ('.runtime-logs/local-frontend-production-api/' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $runDir -Force | Out-Null
$results = [System.Collections.Generic.List[object]]::new()
function Invoke-Layer([string]$Name, [string]$Program, [string[]]$Arguments) {
    $log = Join-Path $runDir ($Name + '.log')
    & $Program @Arguments *> $log
    $code = $LASTEXITCODE
    $results.Add([pscustomobject]@{ layer=$Name; exitCode=$code; log=$log })
    $results | ConvertTo-Json | Set-Content (Join-Path $runDir 'results.json')
    Write-Host "$Name exit=$code log=$log"
    if ($code -ne 0) { Get-Content -LiteralPath $log -Tail 35; throw "$Name failed with exit $code" }
}
Push-Location $frontend
try {
    Invoke-Layer 'compile-tests' 'npm.cmd' @('run', 'test:build')
    Invoke-Layer 'full-suite' 'node' @('tools/run-dev-api-suite.mjs')
    Invoke-Layer 'types' 'npm.cmd' @('run', 'typecheck')
    Invoke-Layer 'lint' 'npm.cmd' @('run', 'lint')
    Invoke-Layer 'dev-lint' 'node' @('node_modules/eslint/bin/eslint.js', 'tools/dev-api-proxy.mjs', 'tools/dev-server.mjs', 'tools/verify-dev-api.mjs', 'tools/run-dev-api-suite.mjs', 'tests/dev/')
    Invoke-Layer 'mutations' 'node' @('tools/verify-dev-api.mjs')
    Invoke-Layer 'transport-coverage' 'node' @('--test', '--experimental-test-coverage', '--test-coverage-include=tools/dev-api-proxy.mjs', '--test-coverage-lines=100', 'tests/dev/api-resolution.test.mjs', 'tests/dev/proxy.test.mjs')
    Invoke-Layer 'runtime' 'node' @('--test', 'tests/dev/runtime.test.mjs')
    Invoke-Layer 'build' 'npm.cmd' @('run', 'build')
    Invoke-Layer 'diff-check' 'git' @('-c', 'core.safecrlf=false', 'diff', '--check')
    Write-Host 'FRONTEND_GAUNTLET_OK (production integration deferred by user)'
} finally {
    $results | ConvertTo-Json | Set-Content (Join-Path $runDir 'results.json')
    $state = @(& git rev-parse HEAD; & node --version; & npm.cmd --version)
    $state | Set-Content (Join-Path $runDir 'source-toolchain.txt')
    @('tools/dev-api-proxy.mjs','tools/dev-server.mjs','src/services/api/client.ts','package.json',
      'tools/verify-dev-api.mjs','tools/run-dev-api-suite.mjs','tests/dev/api-resolution.test.mjs',
      'tests/dev/proxy.test.mjs','tests/dev/runtime.test.mjs','../tools/verify-local-frontend-production-api.ps1') |
        ForEach-Object { Get-FileHash -Algorithm SHA256 $_ } |
        Format-Table -AutoSize | Out-String | Set-Content (Join-Path $runDir 'source-hashes.txt')
    Pop-Location
}
