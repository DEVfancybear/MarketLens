[CmdletBinding()]
param(
  [switch]$EnableHyperV,
  [switch]$AllowReboot
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Get-MT5VmHyperVBootstrapPlan {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][bool]$HyperVPresent,
    [Parameter(Mandatory = $true)][bool]$EnableHyperV,
    [Parameter(Mandatory = $true)][bool]$AllowReboot,
    [ValidateRange(0, 100000)][int]$TradingWorkerCount = 0
  )

  if ($TradingWorkerCount -gt 0 -and -not $HyperVPresent -and $EnableHyperV) {
    throw 'TRADING_WORKER_RUNNING'
  }
  $changeAllowed = -not $HyperVPresent -and $EnableHyperV -and $AllowReboot
  [pscustomobject][ordered]@{
    status = if ($HyperVPresent) {
      'ALREADY_ENABLED'
    } elseif ($changeAllowed) {
      'READY_TO_ENABLE'
    } else {
      'BLOCKED'
    }
    hyperv_present = $HyperVPresent
    change_allowed = $changeAllowed
    reboot_allowed = $changeAllowed -and $AllowReboot
  }
}

if ($MyInvocation.InvocationName -ne '.') {
  $feature = Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V-All
  $present = $feature.State -eq 'Enabled'
  $workerCount = @(Get-Process -Name mt5-vm-agent -ErrorAction SilentlyContinue).Count
  $plan = Get-MT5VmHyperVBootstrapPlan `
    -HyperVPresent:$present `
    -EnableHyperV:$EnableHyperV `
    -AllowReboot:$AllowReboot `
    -TradingWorkerCount $workerCount
  if ($plan.change_allowed) {
    Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V-All `
      -All -NoRestart | Out-Null
    Restart-Computer -Force
  } else {
    $plan | ConvertTo-Json -Compress
  }
}
