[CmdletBinding()]
param(
  [string]$TaskName,
  [string]$WorkerIdentity,
  [string]$PowerShellPath,
  [string]$LauncherPath,
  [string]$AgentPath,
  [ValidatePattern('^[A-Fa-f0-9]{64}$')][string]$AgentSha256,
  [string]$ConfigPath,
  [ValidatePattern('^[A-Fa-f0-9]{64}$')][string]$ConfigSha256
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Get-MT5BareMetalTaskArgumentsBoundary {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$LauncherPath,
    [Parameter(Mandatory = $true)][string]$AgentPath,
    [Parameter(Mandatory = $true)][string]$ConfigPath,
    [Parameter(Mandatory = $true)][string]$ExpectedAgentSha256,
    [Parameter(Mandatory = $true)][string]$ExpectedConfigSha256
  )
  foreach ($value in @($LauncherPath, $AgentPath, $ConfigPath)) {
    if ([string]::IsNullOrWhiteSpace($value) -or $value.IndexOfAny([char[]]"`"`r`n`0") -ge 0) {
      throw 'BAREMETAL_TASK_ARGUMENT_INVALID'
    }
  }
  foreach ($hash in @($ExpectedAgentSha256, $ExpectedConfigSha256)) {
    if ($hash -notmatch '^[A-Fa-f0-9]{64}$') {
      throw 'BAREMETAL_TASK_ARGUMENT_INVALID'
    }
  }
  return '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" -AgentPath "{1}" -ConfigPath "{2}" -ExpectedAgentSha256 {3} -ExpectedConfigSha256 {4}' -f `
    $LauncherPath, $AgentPath, $ConfigPath, `
    $ExpectedAgentSha256.ToLowerInvariant(), $ExpectedConfigSha256.ToLowerInvariant()
}

function Assert-MT5BareMetalTaskContractBoundary {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][object]$Task,
    [Parameter(Mandatory = $true)][string]$WorkerIdentity,
    [Parameter(Mandatory = $true)][string]$PowerShellPath,
    [Parameter(Mandatory = $true)][string]$ExpectedArguments
  )
  $actions = @($Task.Actions)
  $triggers = @($Task.Triggers)
  if ($actions.Count -ne 1 -or $triggers.Count -ne 1 -or $null -eq $Task.Principal) {
    throw 'BAREMETAL_TASK_CONTRACT_INVALID'
  }
  if (-not [string]::Equals(
        [string]$actions[0].Execute,
        $PowerShellPath,
        [StringComparison]::OrdinalIgnoreCase
      ) -or
      [string]$actions[0].Arguments -cne $ExpectedArguments -or
      -not [string]::Equals(
        [string]$Task.Principal.UserId,
        $WorkerIdentity,
        [StringComparison]::OrdinalIgnoreCase
      ) -or
      [string]$Task.Principal.LogonType -cne 'Interactive' -or
      [string]$Task.Principal.RunLevel -cne 'Limited' -or
      -not [bool]$triggers[0].Enabled -or
      -not [string]::Equals(
        [string]$triggers[0].UserId,
        $WorkerIdentity,
        [StringComparison]::OrdinalIgnoreCase
      ) -or
      [string]$triggers[0].CimClass.CimClassName -cne 'MSFT_TaskLogonTrigger') {
    throw 'BAREMETAL_TASK_CONTRACT_INVALID'
  }
}

function Get-MT5BareMetalWorkerStatusCore {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$TaskName,
    [Parameter(Mandatory = $true)][string]$WorkerIdentity,
    [Parameter(Mandatory = $true)][string]$PowerShellPath,
    [Parameter(Mandatory = $true)][string]$LauncherPath,
    [Parameter(Mandatory = $true)][string]$AgentPath,
    [Parameter(Mandatory = $true)][string]$AgentSha256,
    [Parameter(Mandatory = $true)][string]$ConfigPath,
    [Parameter(Mandatory = $true)][string]$ConfigSha256
  )
  foreach ($entry in @(
    [pscustomobject]@{ path = $AgentPath; hash = $AgentSha256; code = 'BAREMETAL_STATUS_AGENT_INVALID' },
    [pscustomobject]@{ path = $ConfigPath; hash = $ConfigSha256; code = 'BAREMETAL_STATUS_CONFIG_INVALID' },
    [pscustomobject]@{ path = $LauncherPath; hash = $null; code = 'BAREMETAL_STATUS_LAUNCHER_INVALID' },
    [pscustomobject]@{ path = $PowerShellPath; hash = $null; code = 'BAREMETAL_STATUS_POWERSHELL_INVALID' }
  )) {
    $full = [IO.Path]::GetFullPath([string]$entry.path)
    if (-not (Test-Path -LiteralPath $full -PathType Leaf) -or
        ((Get-Item -LiteralPath $full -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
      throw [string]$entry.code
    }
    if ($null -ne $entry.hash) {
      $actual = (Get-FileHash -LiteralPath $full -Algorithm SHA256).Hash
      if (-not [string]::Equals(
          $actual,
          [string]$entry.hash,
          [StringComparison]::OrdinalIgnoreCase
        )) {
        throw [string]$entry.code
      }
    }
  }
  $config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
  if ($config.worker_substrate -cne 'bare_metal' -or
      $config.process.terminal_slots.Count -lt 1 -or
      $config.process.terminal_slots.Count -gt 4 -or
      -not [string]::Equals(
        [string]$config.process.artifact_pins.agent_sha256,
        $AgentSha256,
        [StringComparison]::OrdinalIgnoreCase
      )) {
    throw 'BAREMETAL_STATUS_CONFIG_INVALID'
  }
  $expectedArguments = Get-MT5BareMetalTaskArgumentsBoundary `
    -LauncherPath $LauncherPath -AgentPath $AgentPath -ConfigPath $ConfigPath `
    -ExpectedAgentSha256 $AgentSha256 -ExpectedConfigSha256 $ConfigSha256
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
  Assert-MT5BareMetalTaskContractBoundary -Task $task `
    -WorkerIdentity $WorkerIdentity -PowerShellPath $PowerShellPath `
    -ExpectedArguments $expectedArguments
  $taskInfo = Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction Stop
  $lastTaskResult = [int]$taskInfo.LastTaskResult
  # Task Scheduler reports SCHED_S_TASK_RUNNING (0x00041301) while a
  # long-lived worker action is healthy and still executing.
  $healthyResults = @(0, 0x00041301)
  $healthy = [string]$task.State -ceq 'Running' -and $lastTaskResult -in $healthyResults
  [pscustomobject][ordered]@{
    status = if ($healthy) { 'HEALTHY' } else { 'DEGRADED' }
    task_state = [string]$task.State
    last_task_result = $lastTaskResult
    slot_count = @($config.process.terminal_slots).Count
  }
}

if ($MyInvocation.InvocationName -ne '.') {
  Get-MT5BareMetalWorkerStatusCore @PSBoundParameters | ConvertTo-Json -Depth 4
}
