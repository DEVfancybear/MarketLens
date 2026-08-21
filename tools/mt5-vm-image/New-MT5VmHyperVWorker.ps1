[CmdletBinding()]
param(
  [long]$CapacityGeneration,
  [string]$PolicyPath,
  [switch]$Execute
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$script:ScaleMutex = $null

function Enter-MT5VmScaleLockBoundary {
  param([long]$CapacityGeneration)
  $created = $false
  $script:ScaleMutex = New-Object Threading.Mutex(
    $false,
    ('Local\MarketLens-MT5VmScale-' + $CapacityGeneration),
    [ref]$created
  )
  return $script:ScaleMutex.WaitOne([TimeSpan]::FromSeconds(10))
}

function Exit-MT5VmScaleLockBoundary {
  if ($null -ne $script:ScaleMutex) {
    $script:ScaleMutex.ReleaseMutex()
    $script:ScaleMutex.Dispose()
    $script:ScaleMutex = $null
  }
}

function Get-MT5VmScaleStateBoundary {
  param([long]$CapacityGeneration)
  if ($null -eq (Get-Command Get-VM -ErrorAction SilentlyContinue)) {
    throw 'HYPERV_NOT_AVAILABLE'
  }
  $workers = @(Get-VM | Where-Object { $_.Name -like 'marketlens-mt5-*' })
  $generationName = 'marketlens-mt5-g' + $CapacityGeneration
  $drive = Get-PSDrive -Name ([IO.Path]::GetPathRoot($script:ScalePolicy.vm_root).TrimEnd(':\'))
  [pscustomobject]@{
    generation_exists = @($workers | Where-Object { $_.Name -eq $generationName }).Count -gt 0
    worker_count = $workers.Count
    free_disk_gb = [math]::Floor($drive.Free / 1GB)
  }
}

function New-MT5VmWorkerCloneBoundary {
  param([long]$CapacityGeneration)
  $name = 'marketlens-mt5-g' + $CapacityGeneration
  $vmRoot = [IO.Path]::GetFullPath([string]$script:ScalePolicy.vm_root)
  $workerRoot = Join-Path $vmRoot $name
  if (Test-Path -LiteralPath $workerRoot) { throw 'WORKER_STAGE_ALREADY_EXISTS' }
  New-Item -ItemType Directory -Path $workerRoot | Out-Null
  $diskPath = Join-Path $workerRoot 'worker.vhdx'
  New-VHD -Path $diskPath -ParentPath $script:ScalePolicy.golden_vhdx_path `
    -Differencing | Out-Null
  New-VM -Name $name -MemoryStartupBytes ([long]$script:ScalePolicy.memory_bytes) `
    -VHDPath $diskPath -Path $workerRoot -SwitchName $script:ScalePolicy.switch_name |
    Set-VMProcessor -Count ([int]$script:ScalePolicy.cpu_count) -PassThru | Out-Null
  Start-VM -Name $name | Out-Null
  [pscustomobject]@{ worker_id = $name; capacity_generation = $CapacityGeneration }
}

function Test-MT5VmWorkerHealthBoundary { return $false }
function Register-MT5VmWorkerBoundary { throw 'WORKER_REGISTRATION_NOT_CONFIGURED' }

function Invoke-MT5VmHyperVScaleCore {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][ValidateRange(1, 9223372036854775807)]
    [long]$CapacityGeneration,
    [Parameter(Mandatory = $true)]$Policy,
    [switch]$Execute
  )

  if ([int]$Policy.max_workers -lt 1 -or [int]$Policy.max_workers -gt 128 -or
      [int]$Policy.minimum_free_disk_gb -lt 1) {
    throw 'INVALID_SCALE_POLICY'
  }
  if (-not $Execute) {
    return [pscustomobject]@{
      status = 'DRY_RUN'; dry_run = $true; capacity_generation = $CapacityGeneration
    }
  }
  if (-not (Enter-MT5VmScaleLockBoundary -CapacityGeneration $CapacityGeneration)) {
    throw 'SCALE_LOCK_TIMEOUT'
  }
  try {
    $state = Get-MT5VmScaleStateBoundary -CapacityGeneration $CapacityGeneration
    if ($state.generation_exists) {
      return [pscustomobject]@{
        status = 'COALESCED'; dry_run = $false; capacity_generation = $CapacityGeneration
      }
    }
    if ([int]$state.worker_count -ge [int]$Policy.max_workers) {
      throw 'MAX_WORKERS_REACHED'
    }
    if ([long]$state.free_disk_gb -lt [long]$Policy.minimum_free_disk_gb) {
      throw 'INSUFFICIENT_FREE_DISK'
    }
    $worker = New-MT5VmWorkerCloneBoundary -CapacityGeneration $CapacityGeneration
    if (-not (Test-MT5VmWorkerHealthBoundary -Worker $worker)) {
      throw 'WORKER_HEALTH_FAILED'
    }
    Register-MT5VmWorkerBoundary -Worker $worker
    [pscustomobject]@{
      status = 'CREATED'; dry_run = $false; capacity_generation = $CapacityGeneration;
      worker_id = [string]$worker.worker_id
    }
  } finally {
    Exit-MT5VmScaleLockBoundary
  }
}

if ($MyInvocation.InvocationName -ne '.') {
  if ([string]::IsNullOrWhiteSpace($PolicyPath) -or
      -not (Test-Path -LiteralPath $PolicyPath -PathType Leaf)) {
    throw 'PolicyPath must identify a local policy file.'
  }
  $script:ScalePolicy = Get-Content -LiteralPath $PolicyPath -Raw | ConvertFrom-Json
  Invoke-MT5VmHyperVScaleCore `
    -CapacityGeneration $CapacityGeneration -Policy $script:ScalePolicy -Execute:$Execute |
    ConvertTo-Json -Depth 6
}
