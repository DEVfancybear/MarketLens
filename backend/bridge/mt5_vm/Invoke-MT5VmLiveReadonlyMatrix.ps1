[CmdletBinding()]
param(
  [ValidateCount(2, 2)]
  [string[]]$TerminalPath,

  [ValidateCount(2, 2)]
  [string[]]$AccountAlias,

  [ValidateRange(1000, 60000)]
  [int]$TimeoutMs = 60000,

  [string]$PythonPath,
  [string]$OutputDirectory,
  [switch]$Execute
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$uiHelperPath = Join-Path $PSScriptRoot 'Mt5VmTerminalUi.ps1'
$phase0Path = Join-Path $PSScriptRoot 'Invoke-MT5VmPhase0.ps1'
. $uiHelperPath

function Get-MT5VmLiveReadonlyMatrixStateBoundary {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string[]]$TerminalPaths
  )

  $currentSessionId = [Diagnostics.Process]::GetCurrentProcess().SessionId
  return @($TerminalPaths | ForEach-Object {
      $canonicalPath = [IO.Path]::GetFullPath($_)
      Assert-MT5VmTrustedTerminalBoundary -TerminalPath $canonicalPath
      $matches = @(Get-MT5VmTerminalProcessesBoundary | Where-Object {
          -not [string]::IsNullOrWhiteSpace([string]$_.ExecutablePath) -and
          [string]::Equals(
            [IO.Path]::GetFullPath([string]$_.ExecutablePath),
            $canonicalPath,
            [StringComparison]::OrdinalIgnoreCase
          )
        })
      if ($matches.Count -gt 1) {
        throw 'Multiple terminal processes match one live-matrix path.'
      }
      $processId = if ($matches.Count -eq 1) { [int]$matches[0].ProcessId } else { $null }
      if ($null -ne $processId) {
        $process = Get-Process -Id $processId -ErrorAction Stop
        if ($process.SessionId -ne $currentSessionId) {
          throw 'A live-matrix terminal belongs to another Windows session.'
        }
      }
      [pscustomobject]@{
        TerminalPath = $canonicalPath
        Present = $null -ne $processId
        ProcessId = $processId
      }
    })
}

function Set-MT5VmLiveReadonlyMatrixPresenceBoundary {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$TerminalPath,
    [Parameter(Mandatory = $true)][bool]$Present
  )

  $canonicalPath = [IO.Path]::GetFullPath($TerminalPath)
  $state = @(Get-MT5VmLiveReadonlyMatrixStateBoundary -TerminalPaths @($canonicalPath))
  if ($state.Count -ne 1) {
    throw 'Live-matrix process state is malformed.'
  }
  if ($Present -and -not $state[0].Present) {
    $resolved = Resolve-MT5VmTerminalProcess -TerminalPath $canonicalPath
    if ($null -eq $resolved -or
        -not [string]::Equals(
          [IO.Path]::GetFullPath([string]$resolved.TerminalPath),
          $canonicalPath,
          [StringComparison]::OrdinalIgnoreCase
        )) {
      throw 'Live-matrix terminal start did not resolve to the exact path.'
    }
  } elseif (-not $Present -and $state[0].Present) {
    Close-MT5VmTerminalForRestartBoundary `
      -TerminalPath $canonicalPath `
      -ProcessId ([int]$state[0].ProcessId)
  }

  $verified = @(Get-MT5VmLiveReadonlyMatrixStateBoundary -TerminalPaths @($canonicalPath))
  if ($verified.Count -ne 1 -or [bool]$verified[0].Present -ne $Present) {
    throw 'Live-matrix process presence postcondition failed.'
  }
}

function Read-MT5VmLiveReadonlyResult {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$AccountAlias
  )

  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw 'The live-matrix probe did not create a sanitized result.'
  }
  $result = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
  if ($result.schema_version -ne 1 -or
      $result.phase -ne 'mt5_windows_vm_phase0' -or
      $result.mode -ne 'account' -or
      $result.account_alias -ne $AccountAlias) {
    throw 'The live-matrix probe result is malformed.'
  }
  return $result
}

function Invoke-MT5VmLiveReadonlySingleProbeBoundary {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$TerminalPath,
    [Parameter(Mandatory = $true)][string]$AccountAlias,
    [Parameter(Mandatory = $true)][int]$TimeoutMs
  )

  $resultPath = Join-Path $script:MatrixOutputDirectory "single-$AccountAlias.json"
  $arguments = @(
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', $phase0Path, '-Mode', 'Account',
    '-TerminalPath', [IO.Path]::GetFullPath($TerminalPath),
    '-AccountAlias', $AccountAlias,
    '-TimeoutMs', [string]$TimeoutMs,
    '-OutputPath', $resultPath
  )
  if (-not [string]::IsNullOrWhiteSpace($script:MatrixPythonPath)) {
    $arguments += @('-PythonPath', $script:MatrixPythonPath)
  }
  $captured = & powershell.exe @arguments 2>&1
  try {
    return Read-MT5VmLiveReadonlyResult -Path $resultPath -AccountAlias $AccountAlias
  } finally {
    $captured = $null
  }
}

function ConvertTo-MT5VmLiveReadonlyQuotedArgument {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$Value
  )

  if ($Value.Contains('"')) {
    throw 'A live-matrix process argument contains a quote.'
  }
  return '"' + $Value + '"'
}

function Start-MT5VmLiveReadonlyProbeProcess {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$TerminalPath,
    [Parameter(Mandatory = $true)][string]$AccountAlias,
    [Parameter(Mandatory = $true)][int]$TimeoutMs,
    [Parameter(Mandatory = $true)][string]$ResultPath
  )

  $arguments = @(
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
    (ConvertTo-MT5VmLiveReadonlyQuotedArgument -Value $phase0Path),
    '-Mode', 'Account', '-TerminalPath',
    (ConvertTo-MT5VmLiveReadonlyQuotedArgument -Value ([IO.Path]::GetFullPath($TerminalPath))),
    '-AccountAlias', $AccountAlias,
    '-TimeoutMs', [string]$TimeoutMs,
    '-OutputPath', (ConvertTo-MT5VmLiveReadonlyQuotedArgument -Value $ResultPath)
  )
  if (-not [string]::IsNullOrWhiteSpace($script:MatrixPythonPath)) {
    $arguments += @(
      '-PythonPath',
      (ConvertTo-MT5VmLiveReadonlyQuotedArgument -Value $script:MatrixPythonPath)
    )
  }
  $startInfo = New-Object Diagnostics.ProcessStartInfo
  $startInfo.FileName = (Join-Path $PSHOME 'powershell.exe')
  $startInfo.Arguments = $arguments -join ' '
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $process = New-Object Diagnostics.Process
  $process.StartInfo = $startInfo
  if (-not $process.Start()) {
    throw 'A concurrent live-matrix probe could not start.'
  }
  return $process
}

function Invoke-MT5VmLiveReadonlyConcurrentProbeBoundary {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string[]]$TerminalPaths,
    [Parameter(Mandatory = $true)][string[]]$AccountAliases,
    [Parameter(Mandatory = $true)][int]$TimeoutMs
  )

  $processes = @()
  $resultPaths = @()
  try {
    for ($index = 0; $index -lt 2; $index++) {
      $resultPath = Join-Path $script:MatrixOutputDirectory "coexisting-$($AccountAliases[$index]).json"
      $resultPaths += $resultPath
      $processes += Start-MT5VmLiveReadonlyProbeProcess `
        -TerminalPath $TerminalPaths[$index] `
        -AccountAlias $AccountAliases[$index] `
        -TimeoutMs $TimeoutMs `
        -ResultPath $resultPath
    }
    foreach ($process in $processes) {
      $stdout = $process.StandardOutput.ReadToEnd()
      $stderr = $process.StandardError.ReadToEnd()
      $process.WaitForExit()
      $stdout = $null
      $stderr = $null
    }
    return @(for ($index = 0; $index -lt 2; $index++) {
        Read-MT5VmLiveReadonlyResult `
          -Path $resultPaths[$index] `
          -AccountAlias $AccountAliases[$index]
      })
  } finally {
    foreach ($process in $processes) {
      $process.Dispose()
    }
  }
}

function Invoke-MT5VmLiveReadonlyMatrixCore {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string[]]$TerminalPaths,
    [Parameter(Mandatory = $true)][string[]]$AccountAliases,
    [ValidateRange(1000, 60000)][int]$TimeoutMs = 60000
  )

  if ($TerminalPaths.Count -ne 2 -or $AccountAliases.Count -ne 2 -or
      $AccountAliases[0] -eq $AccountAliases[1] -or
      $AccountAliases.Where({ $_ -notmatch '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$' }).Count -gt 0) {
    throw 'The live matrix requires two distinct safe account aliases and terminal paths.'
  }
  $canonicalPaths = @($TerminalPaths | ForEach-Object { [IO.Path]::GetFullPath($_) })
  if ([string]::Equals(
      $canonicalPaths[0], $canonicalPaths[1], [StringComparison]::OrdinalIgnoreCase
    )) {
    throw 'The live matrix requires two distinct terminal paths.'
  }

  $initial = @(Get-MT5VmLiveReadonlyMatrixStateBoundary -TerminalPaths $canonicalPaths)
  if ($initial.Count -ne 2) {
    throw 'The initial live-matrix process state is malformed.'
  }
  $single = @()
  $coexisting = @()
  try {
    for ($index = 0; $index -lt 2; $index++) {
      Set-MT5VmLiveReadonlyMatrixPresenceBoundary `
        -TerminalPath $canonicalPaths[$index] -Present $false
    }
    for ($index = 0; $index -lt 2; $index++) {
      $single += Invoke-MT5VmLiveReadonlySingleProbeBoundary `
        -TerminalPath $canonicalPaths[$index] `
        -AccountAlias $AccountAliases[$index] `
        -TimeoutMs $TimeoutMs
      Set-MT5VmLiveReadonlyMatrixPresenceBoundary `
        -TerminalPath $canonicalPaths[$index] -Present $false
    }
    for ($index = 0; $index -lt 2; $index++) {
      Set-MT5VmLiveReadonlyMatrixPresenceBoundary `
        -TerminalPath $canonicalPaths[$index] -Present $true
    }
    $coexisting = @(Invoke-MT5VmLiveReadonlyConcurrentProbeBoundary `
        -TerminalPaths $canonicalPaths `
        -AccountAliases $AccountAliases `
        -TimeoutMs $TimeoutMs)
    return [pscustomobject][ordered]@{
      Single = $single
      Coexisting = $coexisting
    }
  } finally {
    for ($index = 0; $index -lt 2; $index++) {
      Set-MT5VmLiveReadonlyMatrixPresenceBoundary `
        -TerminalPath $canonicalPaths[$index] `
        -Present ([bool]$initial[$index].Present)
    }
    $restored = @(Get-MT5VmLiveReadonlyMatrixStateBoundary -TerminalPaths $canonicalPaths)
    if ($restored.Count -ne 2 -or
        [bool]$restored[0].Present -ne [bool]$initial[0].Present -or
        [bool]$restored[1].Present -ne [bool]$initial[1].Present) {
      throw 'The live-matrix process topology was not restored.'
    }
  }
}

if ($MyInvocation.InvocationName -ne '.') {
  if (-not $Execute -or $null -eq $TerminalPath -or $null -eq $AccountAlias) {
    throw 'Live matrix execution requires -Execute plus two terminal paths and aliases.'
  }
  if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $OutputDirectory = Join-Path $env:LOCALAPPDATA 'MarketLens\phase0-matrix-results'
  }
  $script:MatrixOutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
  $repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..')).TrimEnd('\')
  if ($script:MatrixOutputDirectory.StartsWith(
      $repoRoot + [IO.Path]::DirectorySeparatorChar,
      [StringComparison]::OrdinalIgnoreCase
    )) {
    throw 'Live-matrix output must remain outside the repository.'
  }
  New-Item -ItemType Directory -Path $script:MatrixOutputDirectory -Force | Out-Null
  $script:MatrixPythonPath = if ([string]::IsNullOrWhiteSpace($PythonPath)) {
    $null
  } else {
    [IO.Path]::GetFullPath($PythonPath)
  }
  $result = Invoke-MT5VmLiveReadonlyMatrixCore `
    -TerminalPaths $TerminalPath `
    -AccountAliases $AccountAlias `
    -TimeoutMs $TimeoutMs
  [pscustomobject][ordered]@{
    phase = 'mt5_vm_live_readonly_matrix'
    status = if (@($result.Single + $result.Coexisting | Where-Object {
          $_.status -ne 'PASS'
        }).Count -eq 0) { 'PASS' } else { 'BLOCKED' }
    single_statuses = @($result.Single | ForEach-Object { [string]$_.status })
    coexisting_statuses = @($result.Coexisting | ForEach-Object { [string]$_.status })
  } | ConvertTo-Json -Compress
}
