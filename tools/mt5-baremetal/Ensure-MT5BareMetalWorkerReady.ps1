[CmdletBinding()]
param(
  [string]$ReceiptPath,
  [string]$AdminUrl,
  [ValidateRange(5, 300)][int]$TimeoutSeconds = 90
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Test-MT5ReadinessInteger {
  [CmdletBinding()]
  param($Value)
  return $Value -is [byte] -or
    $Value -is [sbyte] -or
    $Value -is [int16] -or
    $Value -is [uint16] -or
    $Value -is [int32] -or
    $Value -is [uint32] -or
    $Value -is [int64] -or
    $Value -is [uint64]
}

function Test-MT5ReadinessProperty {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][object]$InputObject,
    [Parameter(Mandatory = $true)][string]$Name
  )
  return $null -ne $InputObject.PSObject.Properties[$Name]
}

function Assert-MT5ReceiptString {
  [CmdletBinding()]
  param(
    $Value,
    [ValidateRange(1, 65536)][int]$MaximumLength = 65536
  )
  if ($Value -isnot [string] -or
      [string]::IsNullOrWhiteSpace($Value) -or
      $Value.Length -gt $MaximumLength -or
      $Value -match '[\x00-\x1f\x7f]') {
    throw 'MANAGED_MT5_WORKER_RECEIPT_INVALID'
  }
  return [string]$Value
}

function Assert-MT5ReceiptAbsolutePath {
  [CmdletBinding()]
  param($Value)
  $candidate = Assert-MT5ReceiptString -Value $Value
  if (-not [IO.Path]::IsPathRooted($candidate)) {
    throw 'MANAGED_MT5_WORKER_RECEIPT_INVALID'
  }
  try {
    return [IO.Path]::GetFullPath($candidate)
  } catch {
    throw 'MANAGED_MT5_WORKER_RECEIPT_INVALID'
  }
}

function Read-MT5BareMetalWorkerReceipt {
  [CmdletBinding()]
  param([Parameter(Mandatory = $true)][string]$Path)
  try {
    $fullPath = Assert-MT5ReceiptAbsolutePath -Value $Path
    if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
      throw 'MANAGED_MT5_WORKER_RECEIPT_INVALID'
    }
    $item = Get-Item -LiteralPath $fullPath -Force
    if ($item -isnot [IO.FileInfo] -or $item.Length -lt 1 -or $item.Length -gt 65536) {
      throw 'MANAGED_MT5_WORKER_RECEIPT_INVALID'
    }
    $cursor = $item
    while ($null -ne $cursor) {
      if (($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw 'MANAGED_MT5_WORKER_RECEIPT_INVALID'
      }
      $cursor = if ($cursor -is [IO.FileInfo]) { $cursor.Directory } else { $cursor.Parent }
    }
    $receipt = Get-Content -LiteralPath $fullPath -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
    if ($null -eq $receipt -or $receipt -is [array]) {
      throw 'MANAGED_MT5_WORKER_RECEIPT_INVALID'
    }
    $required = @(
      'schema_version', 'worker_id', 'task_name', 'worker_identity', 'slot_count',
      'config_path', 'config_sha256', 'launcher_path', 'agent_path', 'agent_sha256',
      'powershell_path'
    )
    foreach ($name in $required) {
      if (-not (Test-MT5ReadinessProperty -InputObject $receipt -Name $name)) {
        throw 'MANAGED_MT5_WORKER_RECEIPT_INVALID'
      }
    }
    if (-not (Test-MT5ReadinessInteger -Value $receipt.schema_version) -or
        [int64]$receipt.schema_version -ne 1 -or
        -not (Test-MT5ReadinessInteger -Value $receipt.slot_count) -or
        [int64]$receipt.slot_count -lt 1 -or [int64]$receipt.slot_count -gt 4) {
      throw 'MANAGED_MT5_WORKER_RECEIPT_INVALID'
    }
    $workerId = Assert-MT5ReceiptString -Value $receipt.worker_id -MaximumLength 64
    if ($workerId -cnotmatch '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$') {
      throw 'MANAGED_MT5_WORKER_RECEIPT_INVALID'
    }
    $taskName = Assert-MT5ReceiptString -Value $receipt.task_name -MaximumLength 96
    $workerIdentity = Assert-MT5ReceiptString -Value $receipt.worker_identity
    $configHash = Assert-MT5ReceiptString -Value $receipt.config_sha256 -MaximumLength 64
    $agentHash = Assert-MT5ReceiptString -Value $receipt.agent_sha256 -MaximumLength 64
    if ($configHash -cnotmatch '^[A-Fa-f0-9]{64}$' -or
        $agentHash -cnotmatch '^[A-Fa-f0-9]{64}$') {
      throw 'MANAGED_MT5_WORKER_RECEIPT_INVALID'
    }
    return [pscustomobject][ordered]@{
      schema_version = 1
      worker_id = $workerId
      task_name = $taskName
      worker_identity = $workerIdentity
      slot_count = [int]$receipt.slot_count
      config_path = Assert-MT5ReceiptAbsolutePath -Value $receipt.config_path
      config_sha256 = $configHash.ToLowerInvariant()
      launcher_path = Assert-MT5ReceiptAbsolutePath -Value $receipt.launcher_path
      agent_path = Assert-MT5ReceiptAbsolutePath -Value $receipt.agent_path
      agent_sha256 = $agentHash.ToLowerInvariant()
      powershell_path = Assert-MT5ReceiptAbsolutePath -Value $receipt.powershell_path
    }
  } catch {
    throw 'MANAGED_MT5_WORKER_RECEIPT_INVALID'
  }
}

function Test-MT5ManagedWorkerRegistryReady {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$Workers,
    [Parameter(Mandatory = $true)][string]$ExpectedWorkerId,
    [Parameter(Mandatory = $true)][int]$ExpectedSlotCount,
    [Parameter(Mandatory = $true)][long]$NowUnixMilliseconds
  )
  if ([string]::IsNullOrWhiteSpace($ExpectedWorkerId) -or
      $ExpectedSlotCount -lt 1 -or $ExpectedSlotCount -gt 4) {
    return [pscustomobject][ordered]@{ ready = $false; code = 'MANAGED_MT5_WORKER_EXPECTATION_INVALID' }
  }
  $matching = @($Workers | Where-Object {
    $null -ne $_ -and
      (Test-MT5ReadinessProperty -InputObject $_ -Name 'workerId') -and
      $_.workerId -is [string] -and
      [string]$_.workerId -ceq $ExpectedWorkerId
  })
  if ($matching.Count -ne 1) {
    return [pscustomobject][ordered]@{ ready = $false; code = 'MANAGED_MT5_WORKER_ID_UNAVAILABLE' }
  }
  $worker = $matching[0]
  foreach ($name in @('status', 'drain', 'capacity', 'activeLeases', 'heartbeatExpiresAtMs')) {
    if (-not (Test-MT5ReadinessProperty -InputObject $worker -Name $name)) {
      return [pscustomobject][ordered]@{ ready = $false; code = 'MANAGED_MT5_WORKER_REGISTRY_INVALID' }
    }
  }
  if ($worker.status -isnot [string] -or
      $worker.drain -isnot [bool] -or
      -not (Test-MT5ReadinessInteger -Value $worker.capacity) -or
      -not (Test-MT5ReadinessInteger -Value $worker.activeLeases) -or
      -not (Test-MT5ReadinessInteger -Value $worker.heartbeatExpiresAtMs)) {
    return [pscustomobject][ordered]@{ ready = $false; code = 'MANAGED_MT5_WORKER_REGISTRY_INVALID' }
  }
  try {
    $capacity = [int64]$worker.capacity
    $activeLeases = [int64]$worker.activeLeases
    $heartbeatExpiresAtMs = [int64]$worker.heartbeatExpiresAtMs
  } catch {
    return [pscustomobject][ordered]@{ ready = $false; code = 'MANAGED_MT5_WORKER_REGISTRY_INVALID' }
  }
  if ([string]$worker.status -cne 'healthy' -or [bool]$worker.drain) {
    return [pscustomobject][ordered]@{ ready = $false; code = 'MANAGED_MT5_WORKER_NOT_HEALTHY' }
  }
  if ($capacity -ne $ExpectedSlotCount -or $capacity -lt 1 -or
      $activeLeases -lt 0 -or $activeLeases -gt $capacity) {
    return [pscustomobject][ordered]@{ ready = $false; code = 'MANAGED_MT5_WORKER_CAPACITY_INVALID' }
  }
  if ($heartbeatExpiresAtMs -le $NowUnixMilliseconds) {
    return [pscustomobject][ordered]@{ ready = $false; code = 'MANAGED_MT5_WORKER_HEARTBEAT_EXPIRED' }
  }
  return [pscustomobject][ordered]@{
    ready = $true
    code = 'MANAGED_MT5_WORKER_READY'
    worker_id = $ExpectedWorkerId
    capacity = [int]$capacity
    active_leases = [int]$activeLeases
    heartbeat_expires_at_ms = $heartbeatExpiresAtMs
  }
}

function Ensure-MT5BareMetalWorkerReadyCore {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][object]$Receipt,
    [Parameter(Mandatory = $true)][scriptblock]$GetTaskStatus,
    [Parameter(Mandatory = $true)][scriptblock]$StartTask,
    [Parameter(Mandatory = $true)][scriptblock]$GetWorkers,
    [Parameter(Mandatory = $true)][scriptblock]$GetNowMilliseconds,
    [Parameter(Mandatory = $true)][scriptblock]$Wait,
    [ValidateRange(1, 300)][int]$MaxAttempts = 30
  )
  $started = $false
  for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
    $taskStatus = & $GetTaskStatus $Receipt
    if ($null -eq $taskStatus -or
        -not (Test-MT5ReadinessProperty -InputObject $taskStatus -Name 'status') -or
        -not (Test-MT5ReadinessProperty -InputObject $taskStatus -Name 'task_state') -or
        -not (Test-MT5ReadinessProperty -InputObject $taskStatus -Name 'worker_id') -or
        -not (Test-MT5ReadinessProperty -InputObject $taskStatus -Name 'slot_count') -or
        $taskStatus.status -isnot [string] -or
        $taskStatus.task_state -isnot [string] -or
        $taskStatus.worker_id -isnot [string] -or
        -not (Test-MT5ReadinessInteger -Value $taskStatus.slot_count)) {
      throw 'MANAGED_MT5_TASK_STATUS_INVALID'
    }
    $status = [string]$taskStatus.status
    $taskState = [string]$taskStatus.task_state
    if ([string]$taskStatus.worker_id -cne [string]$Receipt.worker_id -or
        [int64]$taskStatus.slot_count -ne [int64]$Receipt.slot_count) {
      throw 'MANAGED_MT5_TASK_STATUS_MISMATCH'
    }
    if ($status -cne 'HEALTHY' -and $taskState -cne 'Running' -and -not $started) {
      & $StartTask ([string]$Receipt.task_name)
      $started = $true
    }
    if ($status -ceq 'HEALTHY' -and $taskState -ceq 'Running') {
      $workers = @(& $GetWorkers)
      $now = [long](& $GetNowMilliseconds)
      $assessment = Test-MT5ManagedWorkerRegistryReady `
        -Workers $workers `
        -ExpectedWorkerId ([string]$Receipt.worker_id) `
        -ExpectedSlotCount ([int]$Receipt.slot_count) `
        -NowUnixMilliseconds $now
      if ($assessment.ready) {
        return [pscustomobject][ordered]@{
          ready = $true
          code = 'MANAGED_MT5_WORKER_READY'
          worker_id = $assessment.worker_id
          capacity = $assessment.capacity
          active_leases = $assessment.active_leases
          task_started = $started
          attempts = $attempt
        }
      }
    }
    if ($attempt -lt $MaxAttempts) {
      & $Wait
    }
  }
  throw 'MANAGED_MT5_WORKER_READY_TIMEOUT'
}

function Get-MT5LoopbackAdminUrl {
  [CmdletBinding()]
  param([Parameter(Mandatory = $true)][string]$Url)
  try {
    $parsed = [Uri]$Url
  } catch {
    throw 'MANAGED_MT5_ADMIN_URL_INVALID'
  }
  if (-not $parsed.IsAbsoluteUri -or
      $parsed.Scheme -cne 'http' -or
      -not [string]::IsNullOrEmpty($parsed.UserInfo) -or
      -not [string]::IsNullOrEmpty($parsed.Query) -or
      -not [string]::IsNullOrEmpty($parsed.Fragment) -or
      $parsed.AbsolutePath -cne '/') {
    throw 'MANAGED_MT5_ADMIN_URL_INVALID'
  }
  $loopback = [string]::Equals($parsed.Host, 'localhost', [StringComparison]::OrdinalIgnoreCase)
  if (-not $loopback) {
    $address = $null
    $loopback = [Net.IPAddress]::TryParse($parsed.Host, [ref]$address) -and
      [Net.IPAddress]::IsLoopback($address)
  }
  if (-not $loopback) {
    throw 'MANAGED_MT5_ADMIN_URL_INVALID'
  }
  $authority = $parsed.GetLeftPart([UriPartial]::Authority)
  if (-not [string]::Equals($Url.TrimEnd('/'), $authority, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'MANAGED_MT5_ADMIN_URL_INVALID'
  }
  return $authority
}

function Invoke-MT5BareMetalWorkerReadiness {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$ReceiptPath,
    [Parameter(Mandatory = $true)][string]$AdminUrl,
    [ValidateRange(5, 300)][int]$TimeoutSeconds = 90
  )
  $receipt = Read-MT5BareMetalWorkerReceipt -Path $ReceiptPath
  $adminBaseUrl = Get-MT5LoopbackAdminUrl -Url $AdminUrl
  $adminToken = [Environment]::GetEnvironmentVariable('EXECUTION_ADMIN_TOKEN')
  if ([string]::IsNullOrWhiteSpace($adminToken) -or
      $adminToken.Length -lt 32 -or
      $adminToken -match '[\x00-\x1f\x7f]') {
    throw 'MANAGED_MT5_ADMIN_TOKEN_INVALID'
  }
  $statusScript = Join-Path $PSScriptRoot 'Get-MT5BareMetalWorkerStatus.ps1'
  if (-not (Test-Path -LiteralPath $statusScript -PathType Leaf)) {
    throw 'MANAGED_MT5_TASK_STATUS_INVALID'
  }
  . $statusScript
  $getTaskStatus = {
    param($expected)
    try {
      return Get-MT5BareMetalWorkerStatusCore `
        -TaskName ([string]$expected.task_name) `
        -WorkerIdentity ([string]$expected.worker_identity) `
        -PowerShellPath ([string]$expected.powershell_path) `
        -LauncherPath ([string]$expected.launcher_path) `
        -AgentPath ([string]$expected.agent_path) `
        -AgentSha256 ([string]$expected.agent_sha256) `
        -ConfigPath ([string]$expected.config_path) `
        -ConfigSha256 ([string]$expected.config_sha256)
    } catch {
      $code = [string]$_.Exception.Message
      if ($code -cmatch '^[A-Z][A-Z0-9_]{2,95}$') { throw $code }
      throw 'MANAGED_MT5_TASK_STATUS_INVALID'
    }
  }
  $startTask = {
    param($name)
    try {
      Start-ScheduledTask -TaskName $name -ErrorAction Stop
    } catch {
      throw 'MANAGED_MT5_TASK_START_FAILED'
    }
  }
  $getWorkers = {
    try {
      $response = Invoke-RestMethod `
        -Uri "$adminBaseUrl/v1/admin/mt5-vm/workers" `
        -Method Get `
        -Headers @{ 'x-execution-admin-token' = $adminToken } `
        -TimeoutSec 5 `
        -ErrorAction Stop
      return @($response)
    } catch {
      return @()
    }
  }
  $maxAttempts = [int][Math]::Ceiling($TimeoutSeconds / 2.0)
  return Ensure-MT5BareMetalWorkerReadyCore `
    -Receipt $receipt `
    -GetTaskStatus $getTaskStatus `
    -StartTask $startTask `
    -GetWorkers $getWorkers `
    -GetNowMilliseconds { [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() } `
    -Wait { Start-Sleep -Seconds 2 } `
    -MaxAttempts $maxAttempts
}

if ($MyInvocation.InvocationName -ne '.') {
  try {
    Invoke-MT5BareMetalWorkerReadiness @PSBoundParameters | ConvertTo-Json -Depth 4 -Compress
  } catch {
    [Console]::Error.WriteLine([string]$_.Exception.Message)
    exit 1
  }
}
