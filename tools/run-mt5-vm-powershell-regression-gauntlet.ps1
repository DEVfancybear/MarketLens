[CmdletBinding()]
param(
  [switch]$IncludeRealExnessProbe,
  [switch]$IncludeRealReadonlyMatrix,
  [switch]$NegativeControl
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
$bridgeRoot = Join-Path $repoRoot 'backend\bridge\mt5_vm'
$imageToolRoot = Join-Path $repoRoot 'tools\mt5-vm-image'
$changedPowerShell = @(
  'Mt5VmProcess.ps1',
  'Invoke-MT5VmPhase0.ps1',
  'Invoke-MT5VmPhase1.ps1',
  'Invoke-MT5VmPhase1TwoAccount.ps1',
  'Save-MT5VmPhase0Credential.ps1',
  'Mt5VmTerminalUi.ps1',
  'Invoke-MT5VmTerminalPythonApiBootstrap.ps1',
  'Invoke-MT5VmLiveReadonlyMatrix.ps1'
)
$changedImagePowerShell = @(
  'Install-MT5VmTerminalSlots.ps1',
  'Test-MT5VmImageManifest.ps1',
  'New-MT5VmGoldenImage.ps1',
  'New-MT5VmHyperVWorker.ps1',
  'Enable-MT5VmHyperV.ps1',
  'Enroll-MT5VmServerCatalog.ps1'
)

function Assert-PowerShellParses {
  param([Parameter(Mandatory = $true)][string]$Path)

  $tokens = $null
  $errors = $null
  $null = [Management.Automation.Language.Parser]::ParseFile(
    $Path,
    [ref]$tokens,
    [ref]$errors
  )
  if ($errors.Count -ne 0) {
    $messages = ($errors | ForEach-Object { $_.Message }) -join '; '
    throw "PowerShell parse failed for $Path`: $messages"
  }
}

function Assert-NoCredentialMaterial {
  param([Parameter(Mandatory = $true)][string]$Text)

  $forbidden = @(
    '"encrypted_payload"\s*:\s*"[A-Za-z0-9+/=]{40,}"',
    '-----BEGIN (?:PRIVATE KEY|ENCRYPTED PRIVATE KEY)-----',
    '(?i)(?:password|access_token|refresh_token)\s*[:=]\s*["''][^"'']{20,}["'']'
  )
  foreach ($pattern in $forbidden) {
    if ($Text -match $pattern) {
      throw 'Potential credential material detected in task repository output.'
    }
  }
}

function Assert-NoCredentialProcessArguments {
  param([Parameter(Mandatory = $true)][string[]]$Paths)

  $pattern = '(?m)\$startInfo\.Arguments\s*=.*\$(?:secret|plainPayload|plainPassword|credential)'
  foreach ($path in $Paths) {
    $source = Get-Content -LiteralPath $path -Raw
    if ($source -match $pattern) {
      throw 'Credential-shaped data reached a child process argument assignment.'
    }
  }
}

if ($NegativeControl) {
  $negativePath = Join-Path ([System.IO.Path]::GetTempPath()) (
    'mt5-vm-invalid-' + [guid]::NewGuid().ToString('N') + '.ps1'
  )
  try {
    [System.IO.File]::WriteAllText($negativePath, 'if (', (New-Object Text.UTF8Encoding($false)))
    Assert-PowerShellParses -Path $negativePath
    throw 'Parser negative control unexpectedly passed.'
  } finally {
    if (Test-Path -LiteralPath $negativePath -PathType Leaf) {
      Remove-Item -LiteralPath $negativePath -Force
    }
  }
}

Push-Location $repoRoot
try {
  $testModules = @(
    'backend.bridge.mt5_vm.test_phase0_probe',
    'backend.bridge.mt5_vm.test_phase1_adapter',
    'backend.bridge.mt5_vm.test_phase1_control_harness',
    'backend.bridge.mt5_vm.test_phase4_snapshots',
    'backend.bridge.mt5_vm.test_powershell_process_contracts',
    'backend.bridge.mt5_vm.test_terminal_python_api_bootstrap',
    'backend.bridge.mt5_vm.test_live_readonly_matrix',
    'backend.bridge.mt5_vm.test_local_image_automation'
  )
  & python -m unittest @testModules -v
  if ($LASTEXITCODE -ne 0) {
    throw 'MT5 bridge unit tests failed.'
  }

  & python -m compileall -q backend\bridge\mt5_vm
  if ($LASTEXITCODE -ne 0) {
    throw 'Python compile check failed.'
  }

  foreach ($name in $changedPowerShell) {
    Assert-PowerShellParses -Path (Join-Path $bridgeRoot $name)
  }
  foreach ($name in $changedImagePowerShell) {
    Assert-PowerShellParses -Path (Join-Path $imageToolRoot $name)
  }
  Write-Host "PARSE_OK=$($changedPowerShell.Count + $changedImagePowerShell.Count)" `
    -ForegroundColor Green

  & (Join-Path $PSScriptRoot 'Test-MT5VmPowerShellMutations.ps1')

  & git diff --check
  if ($LASTEXITCODE -ne 0) {
    throw 'git diff --check failed.'
  }

  $taskFiles = @(
    (Join-Path $bridgeRoot 'Mt5VmProcess.ps1'),
    (Join-Path $bridgeRoot 'Invoke-MT5VmPhase0.ps1'),
    (Join-Path $bridgeRoot 'phase0_probe.py'),
    (Join-Path $bridgeRoot 'test_phase0_probe.py'),
    (Join-Path $bridgeRoot 'Invoke-MT5VmPhase1.ps1'),
    (Join-Path $bridgeRoot 'phase1_adapter.py'),
    (Join-Path $bridgeRoot 'test_phase1_adapter.py'),
    (Join-Path $bridgeRoot 'Invoke-MT5VmPhase1TwoAccount.ps1'),
    (Join-Path $bridgeRoot 'Save-MT5VmPhase0Credential.ps1'),
    (Join-Path $bridgeRoot 'test_powershell_process_contracts.py'),
    (Join-Path $bridgeRoot 'Mt5VmTerminalUi.ps1'),
    (Join-Path $bridgeRoot 'Invoke-MT5VmTerminalPythonApiBootstrap.ps1'),
    (Join-Path $bridgeRoot 'test_terminal_python_api_bootstrap.py'),
    (Join-Path $bridgeRoot 'Invoke-MT5VmLiveReadonlyMatrix.ps1'),
    (Join-Path $bridgeRoot 'test_live_readonly_matrix.py'),
    (Join-Path $bridgeRoot 'test_local_image_automation.py'),
    (Join-Path $imageToolRoot 'Install-MT5VmTerminalSlots.ps1'),
    (Join-Path $imageToolRoot 'Test-MT5VmImageManifest.ps1'),
    (Join-Path $imageToolRoot 'New-MT5VmGoldenImage.ps1'),
    (Join-Path $imageToolRoot 'New-MT5VmHyperVWorker.ps1'),
    (Join-Path $imageToolRoot 'Enable-MT5VmHyperV.ps1'),
    (Join-Path $imageToolRoot 'Enroll-MT5VmServerCatalog.ps1'),
    (Join-Path $PSScriptRoot 'Test-MT5VmPowerShellMutations.ps1'),
    (Join-Path $PSScriptRoot 'run-mt5-vm-powershell-regression-gauntlet.ps1')
  )
  $taskText = ($taskFiles | ForEach-Object {
      if (-not (Test-Path -LiteralPath $_ -PathType Leaf)) {
        throw "Task file is missing: $_"
      }
      Get-Content -LiteralPath $_ -Raw
    }) -join "`n"
  Assert-NoCredentialMaterial -Text $taskText
  Write-Host 'SECRET_GATE_OK=task-files' -ForegroundColor Green
  Assert-NoCredentialProcessArguments -Paths @(
    (Join-Path $bridgeRoot 'Invoke-MT5VmPhase0.ps1'),
    (Join-Path $bridgeRoot 'Invoke-MT5VmPhase1.ps1'),
    (Join-Path $bridgeRoot 'Invoke-MT5VmPhase1TwoAccount.ps1'),
    (Join-Path $bridgeRoot 'Invoke-MT5VmLiveReadonlyMatrix.ps1'),
    (Join-Path $imageToolRoot 'Enroll-MT5VmServerCatalog.ps1')
  )
  Write-Host 'PROCESS_ARGUMENT_GATE_OK=runtime-files' -ForegroundColor Green

  if ($IncludeRealExnessProbe) {
    $probeResult = Join-Path $env:LOCALAPPDATA (
      'MarketLens\phase0-results\mt5-vm-exness-mt5-demo.json'
    )
    $probe = Join-Path $bridgeRoot 'Invoke-MT5VmTerminalPythonApiBootstrap.ps1'
    $bootstrapOutput = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $probe `
      -AccountAlias exness-mt5-demo `
      -TerminalPath 'C:\Program Files\MetaTrader 5 Exness Clean\terminal64.exe' `
      -RestartTerminalAfterSettings
    $probeExit = $LASTEXITCODE
    $bootstrap = ($bootstrapOutput -join '') | ConvertFrom-Json
    if (-not (Test-Path -LiteralPath $probeResult -PathType Leaf)) {
      throw 'Real Exness probe produced no result file.'
    }
    $result = Get-Content -LiteralPath $probeResult -Raw | ConvertFrom-Json
    if ($result.phase -ne 'mt5_windows_vm_phase0' -or
        $result.account_alias -ne 'exness-mt5-demo' -or
        $result.error_class -eq 'JSONDecodeError') {
      throw 'Real Exness probe failed the no-BOM transport contract.'
    }
    if ($result.last_error_code -eq -10005 -and -not $bootstrap.RolledBack) {
      throw 'Real terminal bootstrap did not roll back after IPC timeout.'
    }
    if ($result.last_error_code -ne -10005 -and -not $bootstrap.SettingsRetained) {
      throw 'Real terminal bootstrap discarded settings after a distinct result.'
    }
    if (-not $bootstrap.TerminalRestarted) {
      throw 'Real terminal bootstrap did not report the approved controlled restart.'
    }
    $realTerminalPath = [System.IO.Path]::GetFullPath(
      'C:\Program Files\MetaTrader 5 Exness Clean\terminal64.exe'
    )
    $settledProcesses = @()
    $settledProcess = $null
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
      $settledProcesses = @(Get-CimInstance Win32_Process -Filter "Name='terminal64.exe'" |
        Where-Object {
          -not [string]::IsNullOrWhiteSpace([string]$_.ExecutablePath) -and
          [string]::Equals(
            [System.IO.Path]::GetFullPath([string]$_.ExecutablePath),
            $realTerminalPath,
            [StringComparison]::OrdinalIgnoreCase
          )
        })
      if ($settledProcesses.Count -eq 1) {
        $settledProcess = Get-Process `
          -Id ([int]$settledProcesses[0].ProcessId) `
          -ErrorAction SilentlyContinue
        if ($null -ne $settledProcess -and
            $settledProcess.MainWindowHandle -ne 0 -and
            $settledProcess.Responding) {
          break
        }
      }
      Start-Sleep -Milliseconds 500
    }
    if ($settledProcesses.Count -ne 1 -or
        $null -eq $settledProcess -or
        $settledProcess.MainWindowHandle -eq 0 -or
        -not $settledProcess.Responding) {
      throw 'Real terminal process did not settle to one responsive exact-path instance.'
    }
    Write-Host "REAL_TERMINAL_BOOTSTRAP_OK=exit-$probeExit" -ForegroundColor Green
  }

  if ($IncludeRealReadonlyMatrix) {
    $matrixPath = Join-Path $bridgeRoot 'Invoke-MT5VmLiveReadonlyMatrix.ps1'
    . (Join-Path $bridgeRoot 'Mt5VmTerminalUi.ps1')
    $legacyPath = [IO.Path]::GetFullPath(
      'C:\Program Files\MetaTrader 5 Exness\terminal64.exe'
    )
    $legacyMatches = @(Get-MT5VmTerminalProcessesBoundary | Where-Object {
        -not [string]::IsNullOrWhiteSpace([string]$_.ExecutablePath) -and
        [string]::Equals(
          [IO.Path]::GetFullPath([string]$_.ExecutablePath),
          $legacyPath,
          [StringComparison]::OrdinalIgnoreCase
        )
      })
    if ($legacyMatches.Count -gt 1) {
      throw 'The legacy Exness isolation target has multiple exact-path processes.'
    }
    $legacyWasPresent = $legacyMatches.Count -eq 1
    if ($legacyWasPresent) {
      Close-MT5VmTerminalForRestartBoundary `
        -TerminalPath $legacyPath -ProcessId ([int]$legacyMatches[0].ProcessId)
    }
    try {
      $matrixOutput = & $matrixPath `
        -Execute `
        -AccountAlias @('ftmo-free-trial', 'exness-mt5-demo') `
        -TerminalPath @(
          'C:\Program Files\MetaTrader 5\terminal64.exe',
          'C:\Program Files\MetaTrader 5 Exness Clean\terminal64.exe'
        )
    } finally {
      if ($legacyWasPresent) {
        $legacyRestored = Resolve-MT5VmTerminalProcess -TerminalPath $legacyPath
        if (-not $legacyRestored.WasStarted) {
          throw 'The legacy Exness terminal was not restored after matrix isolation.'
        }
      }
    }
    $matrix = ($matrixOutput -join '') | ConvertFrom-Json
    if ($matrix.phase -ne 'mt5_vm_live_readonly_matrix' -or
        $matrix.status -ne 'PASS') {
      throw 'The real read-only two-terminal matrix did not pass.'
    }
    Write-Host 'REAL_READONLY_MATRIX_OK=2-single+2-coexisting' -ForegroundColor Green
  }

  Write-Host 'MT5_VM_POWERSHELL_GAUNTLET=PASS' -ForegroundColor Green
} finally {
  Pop-Location
}
