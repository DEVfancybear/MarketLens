[CmdletBinding()]
param(
  [switch]$ReadinessTestsOnly,
  [switch]$FixtureExecution
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path -LiteralPath (Split-Path -Parent $PSScriptRoot)).Path
$helperPath = Join-Path $PSScriptRoot 'mt5-baremetal\Ensure-MT5BareMetalWorkerReady.ps1'
. $helperPath

$artifactRoot = Join-Path $repoRoot '.artifacts\production-managed-mt5-readiness'
$logRoot = Join-Path $artifactRoot 'logs'
$summaryPath = Join-Path $artifactRoot 'summary.json'
$sourceStatePath = Join-Path $artifactRoot 'source-state.json'
$goCoveragePath = Join-Path $artifactRoot 'go-cover.out'
$goDiffPath = Join-Path $artifactRoot 'go-changed.diff'
$goCoverageSummaryPath = Join-Path $artifactRoot 'go-changed-coverage.json'
$taskBaseRef = 'fa1b9135dad780b3d4dce7a5c5e5084d3df865af'
$utf8 = New-Object Text.UTF8Encoding($false)
$script:layerResults = [Collections.Generic.List[object]]::new()
$script:sequence = 0
$script:mutantsKilled = 0
$script:propertyCases = 0
$startedAt = [DateTime]::UtcNow

if (-not $ReadinessTestsOnly -and -not $FixtureExecution) {
  $expectedArtifactRoot = [IO.Path]::GetFullPath(
    (Join-Path $repoRoot '.artifacts\production-managed-mt5-readiness')
  )
  $resolvedArtifactRoot = [IO.Path]::GetFullPath($artifactRoot)
  $repoPrefix = [IO.Path]::GetFullPath($repoRoot).TrimEnd('\') + '\'
  if (-not $resolvedArtifactRoot.Equals($expectedArtifactRoot, [StringComparison]::OrdinalIgnoreCase) -or
      -not $resolvedArtifactRoot.StartsWith($repoPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing readiness report cleanup outside the exact task artifact root: $resolvedArtifactRoot"
  }
  if (Test-Path -LiteralPath $resolvedArtifactRoot) {
    $artifactItem = Get-Item -LiteralPath $resolvedArtifactRoot -Force
    if (($artifactItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw "Refusing readiness report cleanup through a reparse point: $resolvedArtifactRoot"
    }
    Remove-Item -LiteralPath $resolvedArtifactRoot -Recurse -Force
  }
  New-Item -ItemType Directory -Path $logRoot | Out-Null
}

$script:failures = @()
$script:passes = 0

function Assert-ReadinessTrue {
  param([Parameter(Mandatory = $true)][bool]$Condition, [Parameter(Mandatory = $true)][string]$Message)
  if (-not $Condition) { throw $Message }
}

function Assert-ReadinessEqual {
  param($Actual, $Expected, [Parameter(Mandatory = $true)][string]$Message)
  if ($Actual -cne $Expected) {
    throw "$Message (actual=$Actual expected=$Expected)"
  }
}

function Assert-CanonicalRunnerContract {
  param([Parameter(Mandatory = $true)][string]$Source)
  $gateway = $Source.IndexOf('Starting production Rust execution gateway', [StringComparison]::Ordinal)
  $worker = $Source.IndexOf('Ensure-MT5BareMetalWorkerReady.ps1', [StringComparison]::Ordinal)
  $api = $Source.IndexOf('Starting production Go API', [StringComparison]::Ordinal)
  $ready = $Source.IndexOf('Backend production is ready.', [StringComparison]::Ordinal)
  Assert-ReadinessTrue ($Source.Contains('EXECUTION_MT5_MANAGED_WORKER_RECEIPT_FILE')) `
    'runner receipt setting missing'
  Assert-ReadinessTrue `
    ($gateway -ge 0 -and $worker -gt $gateway -and $api -gt $worker -and $ready -gt $api) `
    'runner readiness ordering invalid'
  Assert-ReadinessTrue (-not $Source.Contains('Start-Process -FilePath $agentPath')) `
    'runner launches managed agent directly'
}

function Invoke-ReadinessTest {
  param([Parameter(Mandatory = $true)][string]$Name, [Parameter(Mandatory = $true)][scriptblock]$Body)
  try {
    & $Body
    $script:passes++
    Write-Host "PASS $Name"
  } catch {
    $detail = "$($_.Exception.Message) at $($_.ScriptStackTrace)"
    $script:failures += [pscustomobject]@{ name = $Name; error = $detail }
    Write-Host "FAIL $Name :: $detail"
  }
}

function New-ReadinessWorker {
  param(
    [string]$WorkerId = 'marketlens-baremetal-01',
    [string]$Status = 'healthy',
    [bool]$Drain = $false,
    [int]$Capacity = 2,
    [int]$ActiveLeases = 1,
    [long]$HeartbeatExpiresAtMs = 1800000045000
  )
  [pscustomobject]@{
    workerId = $WorkerId
    status = $Status
    drain = $Drain
    capacity = $Capacity
    activeLeases = $ActiveLeases
    heartbeatExpiresAtMs = $HeartbeatExpiresAtMs
  }
}

function New-ReadinessReceipt {
  param([string]$Root = 'C:\MarketLens\worker')
  [pscustomobject]@{
    schema_version = 1
    worker_id = 'marketlens-baremetal-01'
    task_name = 'MarketLens MT5 Worker'
    worker_identity = 'HOST\MarketLensWorker'
    slot_count = 2
    config_path = Join-Path $Root 'managed-worker.json'
    config_sha256 = ('a' * 64)
    launcher_path = Join-Path $Root 'Start-MT5BareMetalWorker.ps1'
    agent_path = Join-Path $Root 'mt5-vm-agent.exe'
    agent_sha256 = ('b' * 64)
    powershell_path = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
  }
}

function New-ReadinessTaskFixture {
  param(
    [Parameter(Mandatory = $true)][string]$ExpectedArguments,
    [string]$PowerShellPath = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe',
    [string]$WorkerIdentity = 'HOST\MarketLensWorker'
  )
  [pscustomobject]@{
    Actions = @([pscustomobject]@{
      Execute = $PowerShellPath
      Arguments = $ExpectedArguments
    })
    Triggers = @([pscustomobject]@{
      Enabled = $true
      UserId = $WorkerIdentity
      CimClass = [pscustomobject]@{ CimClassName = 'MSFT_TaskLogonTrigger' }
    })
    Principal = [pscustomobject]@{
      UserId = $WorkerIdentity
      LogonType = 'Interactive'
      RunLevel = 'Limited'
    }
    State = 'Running'
  }
}

if ($FixtureExecution) {
  $fixtureNow = 1800000000000
  $fixtureResult = Ensure-MT5BareMetalWorkerReadyCore `
    -Receipt (New-ReadinessReceipt) `
    -GetTaskStatus {
      param($receipt)
      [pscustomobject]@{
        status = 'HEALTHY'
        task_state = 'Running'
        worker_id = $receipt.worker_id
        slot_count = $receipt.slot_count
      }
    } `
    -StartTask { throw 'fixture must not restart a healthy task' } `
    -GetWorkers { ,(New-ReadinessWorker) } `
    -GetNowMilliseconds { $fixtureNow } `
    -Wait { throw 'fixture must not wait' } `
    -MaxAttempts 1
  $fixtureResult | ConvertTo-Json -Depth 4 -Compress
  exit 0
}

$now = 1800000000000

Invoke-ReadinessTest 'registry accepts exact healthy worker' {
  $assessment = Test-MT5ManagedWorkerRegistryReady `
    -Workers @((New-ReadinessWorker)) `
    -ExpectedWorkerId 'marketlens-baremetal-01' `
    -ExpectedSlotCount 2 `
    -NowUnixMilliseconds $now
  Assert-ReadinessTrue ([bool]$assessment.ready) 'healthy worker fixture was rejected'
  Assert-ReadinessEqual $assessment.code 'MANAGED_MT5_WORKER_READY' 'healthy code mismatch'
}

Invoke-ReadinessTest 'registry rejects every stale or unsuitable worker state' {
  $cases = @(
    [pscustomobject]@{ name='empty'; workers=@() },
    [pscustomobject]@{ name='wrong id'; workers=@((New-ReadinessWorker -WorkerId 'other')) },
    [pscustomobject]@{ name='wrong id case'; workers=@((New-ReadinessWorker -WorkerId 'MARKETLENS-BAREMETAL-01')) },
    [pscustomobject]@{ name='duplicate id'; workers=@((New-ReadinessWorker),(New-ReadinessWorker)) },
    [pscustomobject]@{ name='offline'; workers=@((New-ReadinessWorker -Status 'offline')) },
    [pscustomobject]@{ name='draining'; workers=@((New-ReadinessWorker -Status 'draining')) },
    [pscustomobject]@{ name='drain flag'; workers=@((New-ReadinessWorker -Drain $true)) },
    [pscustomobject]@{ name='expired'; workers=@((New-ReadinessWorker -HeartbeatExpiresAtMs $now)) },
    [pscustomobject]@{ name='zero capacity'; workers=@((New-ReadinessWorker -Capacity 0)) },
    [pscustomobject]@{ name='slot mismatch'; workers=@((New-ReadinessWorker -Capacity 1)) },
    [pscustomobject]@{ name='lease overflow'; workers=@((New-ReadinessWorker -ActiveLeases 3)) },
    [pscustomobject]@{ name='missing fields'; workers=@([pscustomobject]@{ workerId='marketlens-baremetal-01' }) }
  )
  foreach ($case in $cases) {
    $assessment = Test-MT5ManagedWorkerRegistryReady `
      -Workers @($case.workers) `
      -ExpectedWorkerId 'marketlens-baremetal-01' `
      -ExpectedSlotCount 2 `
      -NowUnixMilliseconds $now
    Assert-ReadinessTrue (-not [bool]$assessment.ready) "case passed unexpectedly: $($case.name)"
  }
}

Invoke-ReadinessTest 'registry property matrix accepts only the exact ready predicate' {
  $caseCount = 0
  foreach ($status in @('healthy', 'offline', 'draining')) {
    foreach ($drain in @($false, $true)) {
      foreach ($capacity in 0..5) {
        foreach ($activeLeases in -1..6) {
          foreach ($heartbeatExpiresAtMs in @($now, ($now + 1))) {
            $caseCount++
            $worker = [pscustomobject]@{
              workerId = 'marketlens-baremetal-01'
              status = $status
              drain = $drain
              capacity = $capacity
              activeLeases = $activeLeases
              heartbeatExpiresAtMs = $heartbeatExpiresAtMs
            }
            $assessment = Test-MT5ManagedWorkerRegistryReady `
              -Workers @($worker) `
              -ExpectedWorkerId 'marketlens-baremetal-01' `
              -ExpectedSlotCount 2 `
              -NowUnixMilliseconds $now
            $expected = $status -ceq 'healthy' -and
              -not $drain -and
              $capacity -eq 2 -and
              $activeLeases -ge 0 -and
              $activeLeases -le 2 -and
              $heartbeatExpiresAtMs -gt $now
            Assert-ReadinessEqual ([bool]$assessment.ready) ([bool]$expected) `
              "registry property mismatch status=$status drain=$drain capacity=$capacity leases=$activeLeases expiry=$heartbeatExpiresAtMs"
          }
        }
      }
    }
  }
  $script:propertyCases = $caseCount
  Assert-ReadinessEqual $caseCount 576 'registry property matrix case count changed'
}

Invoke-ReadinessTest 'healthy task is never restarted' {
  $script:startCalls = 0
  $result = Ensure-MT5BareMetalWorkerReadyCore `
    -Receipt (New-ReadinessReceipt) `
    -GetTaskStatus { param($receipt) [pscustomobject]@{ status='HEALTHY'; task_state='Running'; worker_id=$receipt.worker_id; slot_count=$receipt.slot_count } } `
    -StartTask { param($name) $script:startCalls++ } `
    -GetWorkers { ,(New-ReadinessWorker) } `
    -GetNowMilliseconds { $now } `
    -Wait { throw 'wait should not run' } `
    -MaxAttempts 2
  Assert-ReadinessTrue ([bool]$result.ready) 'healthy task did not return ready'
  Assert-ReadinessEqual $script:startCalls 0 'healthy task was restarted'
  Assert-ReadinessEqual $result.task_started $false 'healthy result reported a start'
}

Invoke-ReadinessTest 'stopped attested task starts exactly once and converges' {
  $script:startCalls = 0
  $script:statusCalls = 0
  $result = Ensure-MT5BareMetalWorkerReadyCore `
    -Receipt (New-ReadinessReceipt) `
    -GetTaskStatus {
      param($receipt)
      $script:statusCalls++
      if ($script:statusCalls -eq 1) { return [pscustomobject]@{ status='DEGRADED'; task_state='Ready'; worker_id=$receipt.worker_id; slot_count=$receipt.slot_count } }
      return [pscustomobject]@{ status='HEALTHY'; task_state='Running'; worker_id=$receipt.worker_id; slot_count=$receipt.slot_count }
    } `
    -StartTask { param($name) $script:startCalls++ } `
    -GetWorkers { ,(New-ReadinessWorker) } `
    -GetNowMilliseconds { $now } `
    -Wait { } `
    -MaxAttempts 3
  Assert-ReadinessTrue ([bool]$result.ready) 'stopped task did not converge'
  Assert-ReadinessEqual $script:startCalls 1 'stopped task start count mismatch'
  Assert-ReadinessEqual $result.task_started $true 'start was not reported'
}

Invoke-ReadinessTest 'running degraded task is not blindly restarted' {
  $script:startCalls = 0
  $message = ''
  try {
    $null = Ensure-MT5BareMetalWorkerReadyCore `
      -Receipt (New-ReadinessReceipt) `
      -GetTaskStatus { param($receipt) [pscustomobject]@{ status='DEGRADED'; task_state='Running'; worker_id=$receipt.worker_id; slot_count=$receipt.slot_count } } `
      -StartTask { param($name) $script:startCalls++ } `
      -GetWorkers { throw 'registry should not be queried' } `
      -GetNowMilliseconds { $now } `
      -Wait { } `
      -MaxAttempts 2
  } catch { $message = $_.Exception.Message }
  Assert-ReadinessEqual $script:startCalls 0 'running degraded task was restarted'
  Assert-ReadinessEqual $message 'MANAGED_MT5_WORKER_READY_TIMEOUT' 'degraded timeout mismatch'
}

Invoke-ReadinessTest 'task attestation must match the receipt worker and slot count' {
  foreach ($case in @(
    [pscustomobject]@{ worker_id = 'other-worker'; slot_count = 2 },
    [pscustomobject]@{ worker_id = 'marketlens-baremetal-01'; slot_count = 1 }
  )) {
    $message = ''
    try {
      $null = Ensure-MT5BareMetalWorkerReadyCore `
        -Receipt (New-ReadinessReceipt) `
        -GetTaskStatus {
          param($receipt)
          [pscustomobject]@{
            status = 'HEALTHY'
            task_state = 'Running'
            worker_id = $case.worker_id
            slot_count = $case.slot_count
          }
        } `
        -StartTask { throw 'mismatched attestation must not start' } `
        -GetWorkers { throw 'mismatched attestation must not query registry' } `
        -GetNowMilliseconds { $now } `
        -Wait { throw 'mismatched attestation must not wait' } `
        -MaxAttempts 1
    } catch { $message = $_.Exception.Message }
    Assert-ReadinessEqual $message 'MANAGED_MT5_TASK_STATUS_MISMATCH' `
      "mismatched attestation passed: worker=$($case.worker_id) slots=$($case.slot_count)"
  }
}

Invoke-ReadinessTest 'invalid task contract fails before start or registry' {
  $script:startCalls = 0
  $script:registryCalls = 0
  $message = ''
  try {
    $null = Ensure-MT5BareMetalWorkerReadyCore `
      -Receipt (New-ReadinessReceipt) `
      -GetTaskStatus { param($receipt) throw 'BAREMETAL_TASK_CONTRACT_INVALID' } `
      -StartTask { param($name) $script:startCalls++ } `
      -GetWorkers { $script:registryCalls++; @() } `
      -GetNowMilliseconds { $now } `
      -Wait { } `
      -MaxAttempts 2
  } catch { $message = $_.Exception.Message }
  Assert-ReadinessEqual $message 'BAREMETAL_TASK_CONTRACT_INVALID' 'contract failure was not preserved'
  Assert-ReadinessEqual $script:startCalls 0 'invalid task was started'
  Assert-ReadinessEqual $script:registryCalls 0 'registry was queried after invalid task'
}

Invoke-ReadinessTest 'stale registry times out with bounded waits' {
  $script:waitCalls = 0
  $message = ''
  try {
    $null = Ensure-MT5BareMetalWorkerReadyCore `
      -Receipt (New-ReadinessReceipt) `
      -GetTaskStatus { param($receipt) [pscustomobject]@{ status='HEALTHY'; task_state='Running'; worker_id=$receipt.worker_id; slot_count=$receipt.slot_count } } `
      -StartTask { throw 'healthy task must not start' } `
      -GetWorkers { ,(New-ReadinessWorker -HeartbeatExpiresAtMs $now) } `
      -GetNowMilliseconds { $now } `
      -Wait { $script:waitCalls++ } `
      -MaxAttempts 3
  } catch { $message = $_.Exception.Message }
  Assert-ReadinessEqual $message 'MANAGED_MT5_WORKER_READY_TIMEOUT' 'stale timeout mismatch'
  Assert-ReadinessEqual $script:waitCalls 2 'timeout wait count was not bounded'
}

Invoke-ReadinessTest 'receipt reader validates an installer receipt' {
  $tempRoot = Join-Path ([IO.Path]::GetTempPath()) ('marketlens-receipt-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $tempRoot | Out-Null
  try {
    $receiptPath = Join-Path $tempRoot 'managed-worker-installation.json'
    [IO.File]::WriteAllText(
      $receiptPath,
      ((New-ReadinessReceipt -Root $tempRoot) | ConvertTo-Json -Compress),
      (New-Object Text.UTF8Encoding($false))
    )
    $receipt = Read-MT5BareMetalWorkerReceipt -Path $receiptPath
    Assert-ReadinessEqual $receipt.worker_id 'marketlens-baremetal-01' 'receipt worker mismatch'
    Assert-ReadinessEqual ([int]$receipt.slot_count) 2 'receipt slot mismatch'
  } finally {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force
  }
}

Invoke-ReadinessTest 'receipt reader rejects malformed and out-of-range fixtures' {
  $tempRoot = Join-Path ([IO.Path]::GetTempPath()) ('marketlens-invalid-receipt-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $tempRoot | Out-Null
  try {
    $cases = @(
      [pscustomobject]@{ name = 'malformed'; text = '{' },
      [pscustomobject]@{ name = 'missing'; text = '{"schema_version":1}' },
      [pscustomobject]@{ name = 'zero slots'; receipt = (New-ReadinessReceipt -Root $tempRoot); slots = 0 },
      [pscustomobject]@{ name = 'five slots'; receipt = (New-ReadinessReceipt -Root $tempRoot); slots = 5 }
    )
    foreach ($case in $cases) {
      $path = Join-Path $tempRoot ($case.name.Replace(' ', '-') + '.json')
      if ($null -ne $case.PSObject.Properties['receipt']) {
        $case.receipt.slot_count = $case.slots
        $text = $case.receipt | ConvertTo-Json -Depth 5 -Compress
      } else {
        $text = $case.text
      }
      [IO.File]::WriteAllText($path, $text, $utf8)
      $message = ''
      try { $null = Read-MT5BareMetalWorkerReceipt -Path $path } catch { $message = $_.Exception.Message }
      Assert-ReadinessEqual $message 'MANAGED_MT5_WORKER_RECEIPT_INVALID' `
        "invalid receipt passed: $($case.name)"
    }
    $relativeMessage = ''
    try { $null = Read-MT5BareMetalWorkerReceipt -Path 'relative-receipt.json' } catch {
      $relativeMessage = $_.Exception.Message
    }
    Assert-ReadinessEqual $relativeMessage 'MANAGED_MT5_WORKER_RECEIPT_INVALID' `
      'relative receipt path passed'
  } finally {
    if (Test-Path -LiteralPath $tempRoot) { Remove-Item -LiteralPath $tempRoot -Recurse -Force }
  }
}

Invoke-ReadinessTest 'receipt reader rejects missing and linked receipt paths' {
  $tempRoot = Join-Path ([IO.Path]::GetTempPath()) ('marketlens-linked-receipt-' + [guid]::NewGuid().ToString('N'))
  $targetRoot = Join-Path $tempRoot 'target'
  $linkedRoot = Join-Path $tempRoot 'linked'
  New-Item -ItemType Directory -Path $targetRoot | Out-Null
  try {
    $missingMessage = ''
    try {
      $null = Read-MT5BareMetalWorkerReceipt -Path (Join-Path $targetRoot 'missing.json')
    } catch { $missingMessage = $_.Exception.Message }
    Assert-ReadinessEqual $missingMessage 'MANAGED_MT5_WORKER_RECEIPT_INVALID' `
      'missing receipt path passed'

    $targetPath = Join-Path $targetRoot 'managed-worker-installation.json'
    [IO.File]::WriteAllText(
      $targetPath,
      ((New-ReadinessReceipt -Root $targetRoot) | ConvertTo-Json -Depth 5 -Compress),
      $utf8
    )
    $null = New-Item -ItemType Junction -Path $linkedRoot -Target $targetRoot
    $linkedMessage = ''
    try {
      $null = Read-MT5BareMetalWorkerReceipt -Path `
        (Join-Path $linkedRoot 'managed-worker-installation.json')
    } catch { $linkedMessage = $_.Exception.Message }
    Assert-ReadinessEqual $linkedMessage 'MANAGED_MT5_WORKER_RECEIPT_INVALID' `
      'receipt reached through a linked parent passed'
  } finally {
    if (Test-Path -LiteralPath $linkedRoot) {
      $linkItem = Get-Item -LiteralPath $linkedRoot -Force
      Assert-ReadinessTrue `
        (($linkItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) `
        'refusing to remove a non-link receipt fixture path'
      [IO.Directory]::Delete($linkedRoot, $false)
    }
    if (Test-Path -LiteralPath $tempRoot) { Remove-Item -LiteralPath $tempRoot -Recurse -Force }
  }
}

Invoke-ReadinessTest 'task status rejects missing artifacts and SHA mismatches before task access' {
  . (Join-Path $repoRoot 'tools\mt5-baremetal\Get-MT5BareMetalWorkerStatus.ps1')
  $tempRoot = Join-Path ([IO.Path]::GetTempPath()) ('marketlens-status-artifact-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $tempRoot | Out-Null
  try {
    $missingAgentPath = Join-Path $tempRoot 'missing-agent.exe'
    $message = ''
    try {
      $null = Get-MT5BareMetalWorkerStatusCore `
        -TaskName 'must-not-be-read' -WorkerIdentity 'HOST\MarketLensWorker' `
        -PowerShellPath (Join-Path $PSHOME 'powershell.exe') `
        -LauncherPath (Join-Path $tempRoot 'missing-launcher.ps1') `
        -AgentPath $missingAgentPath -AgentSha256 ('a' * 64) `
        -ConfigPath (Join-Path $tempRoot 'missing-config.json') -ConfigSha256 ('b' * 64)
    } catch { $message = $_.Exception.Message }
    Assert-ReadinessEqual $message 'BAREMETAL_STATUS_AGENT_INVALID' `
      'missing agent artifact did not fail at the artifact boundary'

    $agentPath = Join-Path $tempRoot 'mt5-vm-agent.exe'
    [IO.File]::WriteAllText($agentPath, 'agent-fixture', $utf8)
    $message = ''
    try {
      $null = Get-MT5BareMetalWorkerStatusCore `
        -TaskName 'must-not-be-read' -WorkerIdentity 'HOST\MarketLensWorker' `
        -PowerShellPath (Join-Path $PSHOME 'powershell.exe') `
        -LauncherPath (Join-Path $tempRoot 'missing-launcher.ps1') `
        -AgentPath $agentPath -AgentSha256 ('0' * 64) `
        -ConfigPath (Join-Path $tempRoot 'missing-config.json') -ConfigSha256 ('b' * 64)
    } catch { $message = $_.Exception.Message }
    Assert-ReadinessEqual $message 'BAREMETAL_STATUS_AGENT_INVALID' `
      'agent SHA mismatch did not fail at the artifact boundary'
  } finally {
    if (Test-Path -LiteralPath $tempRoot) { Remove-Item -LiteralPath $tempRoot -Recurse -Force }
  }
}

Invoke-ReadinessTest 'task contract rejects action principal and trigger drift' {
  . (Join-Path $repoRoot 'tools\mt5-baremetal\Get-MT5BareMetalWorkerStatus.ps1')
  $powerShellPath = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
  $workerIdentity = 'HOST\MarketLensWorker'
  $expectedArguments = Get-MT5BareMetalTaskArgumentsBoundary `
    -LauncherPath 'C:\MarketLens\worker\Start-MT5BareMetalWorker.ps1' `
    -AgentPath 'C:\MarketLens\worker\mt5-vm-agent.exe' `
    -ConfigPath 'C:\MarketLens\worker\managed-worker.json' `
    -ExpectedAgentSha256 ('a' * 64) -ExpectedConfigSha256 ('b' * 64)
  $valid = New-ReadinessTaskFixture `
    -ExpectedArguments $expectedArguments -PowerShellPath $powerShellPath `
    -WorkerIdentity $workerIdentity
  Assert-MT5BareMetalTaskContractBoundary -Task $valid `
    -WorkerIdentity $workerIdentity -PowerShellPath $powerShellPath `
    -ExpectedArguments $expectedArguments

  foreach ($kind in @(
    'action', 'arguments', 'identity', 'logon', 'run-level',
    'trigger-disabled', 'trigger-identity', 'trigger-kind'
  )) {
    $task = New-ReadinessTaskFixture `
      -ExpectedArguments $expectedArguments -PowerShellPath $powerShellPath `
      -WorkerIdentity $workerIdentity
    switch ($kind) {
      'action' { $task.Actions[0].Execute = 'C:\Windows\System32\cmd.exe' }
      'arguments' { $task.Actions[0].Arguments = '-NoProfile -File "wrong.ps1"' }
      'identity' { $task.Principal.UserId = 'HOST\OtherUser' }
      'logon' { $task.Principal.LogonType = 'Password' }
      'run-level' { $task.Principal.RunLevel = 'Highest' }
      'trigger-disabled' { $task.Triggers[0].Enabled = $false }
      'trigger-identity' { $task.Triggers[0].UserId = 'HOST\OtherUser' }
      'trigger-kind' { $task.Triggers[0].CimClass.CimClassName = 'MSFT_TaskBootTrigger' }
    }
    $message = ''
    try {
      Assert-MT5BareMetalTaskContractBoundary -Task $task `
        -WorkerIdentity $workerIdentity -PowerShellPath $powerShellPath `
        -ExpectedArguments $expectedArguments
    } catch { $message = $_.Exception.Message }
    Assert-ReadinessEqual $message 'BAREMETAL_TASK_CONTRACT_INVALID' `
      "task contract drift passed: $kind"
  }
}

Invoke-ReadinessTest 'task status rejects an artifact reached through a linked parent' {
  . (Join-Path $repoRoot 'tools\mt5-baremetal\Get-MT5BareMetalWorkerStatus.ps1')
  $tempRoot = Join-Path ([IO.Path]::GetTempPath()) ('marketlens-status-link-' + [guid]::NewGuid().ToString('N'))
  $targetRoot = Join-Path $tempRoot 'target'
  $linkedRoot = Join-Path $tempRoot 'linked'
  New-Item -ItemType Directory -Path $targetRoot | Out-Null
  try {
    $agentPath = Join-Path $targetRoot 'mt5-vm-agent.exe'
    $launcherPath = Join-Path $targetRoot 'Start-MT5BareMetalWorker.ps1'
    $configPath = Join-Path $targetRoot 'managed-worker.json'
    [IO.File]::WriteAllText($agentPath, 'agent-fixture', (New-Object Text.UTF8Encoding($false)))
    [IO.File]::WriteAllText($launcherPath, 'launcher-fixture', (New-Object Text.UTF8Encoding($false)))
    $agentHash = (Get-FileHash -LiteralPath $agentPath -Algorithm SHA256).Hash
    $configJson = [ordered]@{
      worker_substrate = 'bare_metal'
      process = [ordered]@{
        worker_id = 'marketlens-baremetal-01'
        terminal_slots = @([ordered]@{ slot_id = 'slot-01' })
        artifact_pins = [ordered]@{ agent_sha256 = $agentHash.ToLowerInvariant() }
      }
    } | ConvertTo-Json -Depth 6 -Compress
    [IO.File]::WriteAllText($configPath, $configJson, (New-Object Text.UTF8Encoding($false)))
    $configHash = (Get-FileHash -LiteralPath $configPath -Algorithm SHA256).Hash
    $null = New-Item -ItemType Junction -Path $linkedRoot -Target $targetRoot
    $message = ''
    try {
      $null = Get-MT5BareMetalWorkerStatusCore `
        -TaskName 'must-not-be-read' `
        -WorkerIdentity 'HOST\MarketLensWorker' `
        -PowerShellPath (Join-Path $PSHOME 'powershell.exe') `
        -LauncherPath $launcherPath `
        -AgentPath (Join-Path $linkedRoot 'mt5-vm-agent.exe') `
        -AgentSha256 $agentHash `
        -ConfigPath $configPath `
        -ConfigSha256 $configHash
    } catch { $message = $_.Exception.Message }
    Assert-ReadinessEqual $message 'BAREMETAL_STATUS_AGENT_INVALID' `
      'linked artifact parent was not rejected before task access'
  } finally {
    if (Test-Path -LiteralPath $linkedRoot) {
      $linkItem = Get-Item -LiteralPath $linkedRoot -Force
      Assert-ReadinessTrue `
        (($linkItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) `
        'refusing to remove a non-link fixture path'
      [IO.Directory]::Delete($linkedRoot, $false)
    }
    if (Test-Path -LiteralPath $tempRoot) { Remove-Item -LiteralPath $tempRoot -Recurse -Force }
  }
}

Invoke-ReadinessTest 'installer persists the protected receipt contract' {
  $source = Get-Content -LiteralPath (Join-Path $repoRoot 'tools\mt5-baremetal\Install-MT5BareMetalWorker.ps1') -Raw
  Assert-ReadinessTrue ($source.Contains('managed-worker-installation.json')) 'installer receipt filename missing'
  Assert-ReadinessTrue ($source.Contains('schema_version = 1')) 'installer receipt schema missing'
  Assert-ReadinessTrue ($source.Contains('receipt_path')) 'installer result omits receipt path'
}

Invoke-ReadinessTest 'canonical runner gates API and final banner on managed worker readiness' {
  $source = Get-Content -LiteralPath (Join-Path $repoRoot 'run-backend-production.ps1') -Raw
  Assert-CanonicalRunnerContract -Source $source
}

Invoke-ReadinessTest 'operator configuration and docs describe the managed readiness contract' {
  $environment = Get-Content -LiteralPath (Join-Path $repoRoot 'backend\.env.example') -Raw
  $runbook = Get-Content -LiteralPath (Join-Path $repoRoot 'docs\MT5_BAREMETAL_MANAGED_EA_RUNBOOK.md') -Raw
  $operations = Get-Content -LiteralPath (Join-Path $repoRoot 'docs\OPERATIONS.md') -Raw
  Assert-ReadinessTrue `
    ($environment -cmatch '(?m)^EXECUTION_MT5_MANAGED_WORKER_RECEIPT_FILE=$') `
    'backend environment example omits the receipt setting'
  foreach ($document in @($runbook, $operations)) {
    Assert-ReadinessTrue `
      ($document.Contains('EXECUTION_MT5_MANAGED_WORKER_RECEIPT_FILE')) `
      'operator documentation omits the receipt setting'
    Assert-ReadinessTrue `
      ($document -match '(?i)previously installed|installed worker') `
      'operator documentation does not preserve the explicit install boundary'
  }
  Assert-ReadinessTrue `
    ($runbook -match '(?i)starts the attested Scheduled Task|start the attested Scheduled Task') `
    'runbook does not document the bounded stopped-worker start behavior'
  Assert-ReadinessTrue `
    ($operations -match '(?i)validates.*receipt') `
    'operations guide does not document receipt validation'
}

if ($script:failures.Count -gt 0) {
  Write-Host "READINESS_TESTS_FAILED=$($script:failures.Count) PASSED=$script:passes"
  exit 1
}

Write-Host "PRODUCTION_MANAGED_MT5_READINESS_TESTS_OK=$script:passes"

if ($ReadinessTestsOnly) {
  exit 0
}

function ConvertTo-ReadinessNativeArgument {
  param([AllowEmptyString()][string]$Argument)
  if ($Argument.Length -eq 0) { return '""' }
  if ($Argument -notmatch '[\s"]') { return $Argument }
  $builder = New-Object Text.StringBuilder
  $null = $builder.Append('"')
  $backslashes = 0
  foreach ($character in $Argument.ToCharArray()) {
    if ($character -eq '\') {
      $backslashes++
      continue
    }
    if ($character -eq '"') {
      $null = $builder.Append(('\' * (($backslashes * 2) + 1)))
      $null = $builder.Append('"')
    } else {
      if ($backslashes -gt 0) { $null = $builder.Append(('\' * $backslashes)) }
      $null = $builder.Append($character)
    }
    $backslashes = 0
  }
  if ($backslashes -gt 0) { $null = $builder.Append(('\' * ($backslashes * 2))) }
  $null = $builder.Append('"')
  return $builder.ToString()
}

function Invoke-ReadinessCapturedProcess {
  param(
    [Parameter(Mandatory = $true)][string]$File,
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]]$Arguments,
    [Parameter(Mandatory = $true)][string]$WorkingDirectory,
    [ValidateRange(1, 3600)][int]$TimeoutSeconds = 600
  )
  $command = Get-Command $File -ErrorAction Stop
  $startInfo = New-Object Diagnostics.ProcessStartInfo
  $startInfo.FileName = $command.Source
  $startInfo.WorkingDirectory = (Resolve-Path -LiteralPath $WorkingDirectory).Path
  $startInfo.Arguments = (($Arguments | ForEach-Object {
    ConvertTo-ReadinessNativeArgument -Argument ([string]$_)
  }) -join ' ')
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $startInfo.EnvironmentVariables['NO_COLOR'] = '1'
  $startInfo.EnvironmentVariables['CARGO_TERM_COLOR'] = 'never'
  $process = New-Object Diagnostics.Process
  $process.StartInfo = $startInfo
  try {
    if (-not $process.Start()) { throw "$File did not start" }
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
      try { $process.Kill() } catch { }
      throw "$File exceeded the $TimeoutSeconds second timeout"
    }
    $process.WaitForExit()
    $stdout = $stdoutTask.Result
    $stderr = $stderrTask.Result
    $output = (($stdout.TrimEnd(), $stderr.TrimEnd()) | Where-Object { $_ -ne '' }) -join "`n"
    return [pscustomobject]@{
      exit_code = [int]$process.ExitCode
      stdout = $stdout
      stderr = $stderr
      output = $output
      command = (($File, $Arguments) -join ' ')
    }
  } finally {
    $process.Dispose()
  }
}

function Get-ReadinessRelativePath {
  param([Parameter(Mandatory = $true)][string]$Path)
  $root = [IO.Path]::GetFullPath($repoRoot).TrimEnd('\')
  $resolved = [IO.Path]::GetFullPath($Path)
  $prefix = $root + '\'
  if (-not $resolved.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Path is outside the repository: $resolved"
  }
  return $resolved.Substring($prefix.Length).Replace('\', '/')
}

function Get-ReadinessLogPath {
  param([Parameter(Mandatory = $true)][string]$Name)
  $script:sequence++
  $safe = $Name -replace '[^A-Za-z0-9_.-]', '_'
  return Join-Path $logRoot ('{0:D2}-{1}.log' -f $script:sequence, $safe)
}

function Add-ReadinessLayerResult {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][ValidateSet('PASS', 'FAIL')][string]$Status,
    [Parameter(Mandatory = $true)][int]$ExitCode,
    [Parameter(Mandatory = $true)][double]$DurationSeconds,
    [Parameter(Mandatory = $true)][string]$Command,
    [AllowNull()][string]$LogPath,
    [AllowNull()][string]$Note
  )
  $script:layerResults.Add([pscustomobject][ordered]@{
    name = $Name
    status = $Status
    exit_code = $ExitCode
    duration_seconds = [Math]::Round($DurationSeconds, 3)
    command = $Command
    log = if ([string]::IsNullOrWhiteSpace($LogPath)) { $null } else {
      Get-ReadinessRelativePath -Path $LogPath
    }
    note = $Note
  })
  Write-Host "LAYER=$Name STATUS=$Status EXIT=$ExitCode"
}

function Invoke-ReadinessNativeLayer {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$File,
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]]$Arguments,
    [Parameter(Mandatory = $true)][string]$WorkingDirectory,
    [ValidateRange(1, 3600)][int]$TimeoutSeconds = 600,
    [AllowEmptyString()][string]$RequiredPattern = '',
    [AllowEmptyString()][string]$RejectedPattern = ''
  )
  $watch = [Diagnostics.Stopwatch]::StartNew()
  $logPath = Get-ReadinessLogPath -Name $Name
  $captured = $null
  $failure = $null
  try {
    $captured = Invoke-ReadinessCapturedProcess `
      -File $File -Arguments $Arguments -WorkingDirectory $WorkingDirectory `
      -TimeoutSeconds $TimeoutSeconds
    if ($captured.exit_code -ne 0) {
      $failure = "command exited $($captured.exit_code)"
    } elseif ($RequiredPattern -and $captured.output -notmatch $RequiredPattern) {
      $failure = "required success marker was absent: $RequiredPattern"
    } elseif ($RejectedPattern -and $captured.output -match $RejectedPattern) {
      $failure = "rejected output was observed: $RejectedPattern"
    }
  } catch {
    $failure = $_.Exception.Message
  } finally {
    $watch.Stop()
  }
  $output = @(
    "layer=$Name"
    "failure=$failure"
    if ($null -ne $captured) { $captured.output }
  ) -join "`n"
  [IO.File]::WriteAllText($logPath, $output, $utf8)
  $exitCode = if ($null -eq $captured) { -1 } else { [int]$captured.exit_code }
  $commandText = if ($null -eq $captured) { (($File, $Arguments) -join ' ') } else { $captured.command }
  Add-ReadinessLayerResult -Name $Name `
    -Status $(if ($null -eq $failure) { 'PASS' } else { 'FAIL' }) `
    -ExitCode $exitCode -DurationSeconds $watch.Elapsed.TotalSeconds `
    -Command $commandText -LogPath $logPath -Note $failure
}

function Invoke-ReadinessExpectedFailureLayer {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$File,
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]]$Arguments,
    [Parameter(Mandatory = $true)][string]$WorkingDirectory,
    [ValidateRange(1, 3600)][int]$TimeoutSeconds = 600
  )
  $watch = [Diagnostics.Stopwatch]::StartNew()
  $logPath = Get-ReadinessLogPath -Name $Name
  $captured = $null
  $failure = $null
  try {
    $captured = Invoke-ReadinessCapturedProcess `
      -File $File -Arguments $Arguments -WorkingDirectory $WorkingDirectory `
      -TimeoutSeconds $TimeoutSeconds
    if ($captured.exit_code -eq 0) { $failure = 'negative control unexpectedly succeeded' }
  } catch {
    $failure = $_.Exception.Message
  } finally {
    $watch.Stop()
  }
  $logLines = @("layer=$Name", "failure=$failure")
  if ($null -ne $captured) { $logLines += $captured.output }
  [IO.File]::WriteAllText($logPath, ($logLines -join "`n"), $utf8)
  $exitCode = if ($null -eq $captured) { -1 } else { [int]$captured.exit_code }
  Add-ReadinessLayerResult -Name $Name `
    -Status $(if ($null -eq $failure) { 'PASS' } else { 'FAIL' }) `
    -ExitCode $exitCode -DurationSeconds $watch.Elapsed.TotalSeconds `
    -Command (($File, $Arguments) -join ' ') -LogPath $logPath -Note $failure
}

function Invoke-ReadinessInProcessLayer {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][scriptblock]$Body,
    [Parameter(Mandatory = $true)][string]$Command
  )
  $watch = [Diagnostics.Stopwatch]::StartNew()
  $logPath = Get-ReadinessLogPath -Name $Name
  $failure = $null
  $output = ''
  try {
    $output = (& $Body | Out-String).TrimEnd()
  } catch {
    $failure = "$($_.Exception.Message) at $($_.ScriptStackTrace)"
  } finally {
    $watch.Stop()
  }
  [IO.File]::WriteAllText(
    $logPath,
    (@("layer=$Name", "failure=$failure", $output) -join "`n"),
    $utf8
  )
  Add-ReadinessLayerResult -Name $Name `
    -Status $(if ($null -eq $failure) { 'PASS' } else { 'FAIL' }) `
    -ExitCode $(if ($null -eq $failure) { 0 } else { 1 }) `
    -DurationSeconds $watch.Elapsed.TotalSeconds -Command $Command `
    -LogPath $logPath -Note $failure
}

function Invoke-ReadinessGit {
  param([Parameter(Mandatory = $true)][string[]]$Arguments)
  $captured = Invoke-ReadinessCapturedProcess `
    -File 'git.exe' -Arguments (@('-c', 'core.safecrlf=false', '-c', 'core.quotepath=false') + $Arguments) `
    -WorkingDirectory $repoRoot -TimeoutSeconds 180
  if ($captured.exit_code -ne 0) { throw "git command failed: $($captured.stderr.Trim())" }
  return $captured.stdout
}

function Get-ReadinessTaskPaths {
  return @(
    'run-backend-production.ps1',
    'backend/.env.example',
    'backend/internal/execution/handler.go',
    'backend/internal/execution/managed_mt5_startup_test.go',
    'tools/mt5-baremetal/Install-MT5BareMetalWorker.ps1',
    'tools/mt5-baremetal/Get-MT5BareMetalWorkerStatus.ps1',
    'tools/mt5-baremetal/Ensure-MT5BareMetalWorkerReady.ps1',
    'tools/verify-production-managed-mt5-readiness.ps1',
    'frontend/src/components/trade/TradeWorkspace.tsx',
    'frontend/src/components/mobile/MobileTradeScreen.tsx',
    'frontend/src/i18n/localization.ts',
    'frontend/tests/trade/managedMt5DialogContract.test.ts',
    'docs/MT5_BAREMETAL_MANAGED_EA_RUNBOOK.md',
    'docs/OPERATIONS.md',
    'docs/agent-evidence/production-managed-mt5-readiness/SPEC.md',
    'docs/agent-evidence/production-managed-mt5-readiness/EVIDENCE.md'
  )
}

function Test-ReadinessTaskPath {
  param([Parameter(Mandatory = $true)][string]$Path)
  $normalized = $Path.Replace('\', '/')
  return $normalized -in @(Get-ReadinessTaskPaths) -or
    $normalized.StartsWith(
      'docs/agent-evidence/production-managed-mt5-readiness/',
      [StringComparison]::OrdinalIgnoreCase
    )
}

function Get-UnrelatedDirtySnapshot {
  $statusText = Invoke-ReadinessGit -Arguments @('status', '--porcelain=v1', '--untracked-files=all')
  $records = @()
  foreach ($line in @($statusText -split "`r?`n" | Where-Object { $_ -ne '' })) {
    if ($line.Length -lt 4) { throw "malformed git status line" }
    $status = $line.Substring(0, 2)
    $path = $line.Substring(3)
    if ($path.Contains(' -> ')) { throw "rename status is unsupported by the preservation gate" }
    if ($path.StartsWith('"')) { throw "quoted git path is unsupported by the preservation gate" }
    $path = $path.Replace('\', '/')
    if (Test-ReadinessTaskPath -Path $path) { continue }
    $absolute = Join-Path $repoRoot $path
    $hash = $null
    $bytes = $null
    if (Test-Path -LiteralPath $absolute -PathType Leaf) {
      $item = Get-Item -LiteralPath $absolute -Force
      if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "unrelated dirty path is a reparse point: $path"
      }
      $hash = (Get-FileHash -LiteralPath $absolute -Algorithm SHA256).Hash.ToLowerInvariant()
      $bytes = [long]$item.Length
    }
    $records += [pscustomobject][ordered]@{
      status = $status
      path = $path
      bytes = $bytes
      sha256 = $hash
    }
  }
  return @($records | Sort-Object path)
}

function Get-TaskAddedText {
  $paths = @(Get-ReadinessTaskPaths)
  $builder = New-Object Text.StringBuilder
  $tracked = @((Invoke-ReadinessGit -Arguments (@('ls-files', '--') + $paths)) -split "`r?`n" |
    Where-Object { $_ -ne '' })
  if ($tracked.Count -gt 0) {
    $diff = Invoke-ReadinessGit -Arguments `
      (@('diff', '--no-ext-diff', '--unified=0', $taskBaseRef, '--') + $tracked)
    foreach ($line in $diff -split "`r?`n") {
      if ($line.StartsWith('+') -and -not $line.StartsWith('+++')) {
        $null = $builder.AppendLine($line.Substring(1))
      }
    }
  }
  $untracked = @((Invoke-ReadinessGit -Arguments `
    (@('ls-files', '--others', '--exclude-standard', '--') + $paths)) -split "`r?`n" |
    Where-Object { $_ -ne '' })
  foreach ($relative in $untracked) {
    $absolute = Join-Path $repoRoot $relative
    if (-not (Test-Path -LiteralPath $absolute -PathType Leaf)) {
      throw "untracked task source disappeared: $relative"
    }
    $null = $builder.AppendLine([IO.File]::ReadAllText($absolute, $utf8))
  }
  return $builder.ToString()
}

function Get-ReadinessTaskSourceState {
  $records = @()
  $canonical = @()
  foreach ($relative in @(Get-ReadinessTaskPaths | Sort-Object -Unique)) {
    $absolute = Join-Path $repoRoot $relative
    if (-not (Test-Path -LiteralPath $absolute -PathType Leaf)) { continue }
    $item = Get-Item -LiteralPath $absolute -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw "task source is a reparse point: $relative"
    }
    $hash = (Get-FileHash -LiteralPath $absolute -Algorithm SHA256).Hash.ToLowerInvariant()
    $records += [pscustomobject][ordered]@{
      path = $relative
      bytes = [long]$item.Length
      sha256 = $hash
    }
    $canonical += "$hash  $relative"
  }
  if ($records.Count -lt 15) { throw "task source state is incomplete: $($records.Count) paths" }
  $hasher = [Security.Cryptography.SHA256]::Create()
  try {
    $treeHash = ([BitConverter]::ToString(
      $hasher.ComputeHash($utf8.GetBytes(($canonical -join "`n") + "`n"))
    )).Replace('-', '').ToLowerInvariant()
  } finally {
    $hasher.Dispose()
  }
  $state = [pscustomobject][ordered]@{
    schema_version = 1
    head = (Invoke-ReadinessGit -Arguments @('rev-parse', 'HEAD')).Trim()
    task_base_ref = $taskBaseRef
    generated_at_utc = [DateTime]::UtcNow.ToString('o')
    task_tree_sha256 = $treeHash
    file_count = $records.Count
    files = $records
  }
  [IO.File]::WriteAllText($sourceStatePath, ($state | ConvertTo-Json -Depth 6), $utf8)
  return $state
}

function Assert-ReadinessMutationDefinition {
  param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Old
  )
  $count = 0
  $offset = 0
  while ($true) {
    $index = $Source.IndexOf($Old, $offset, [StringComparison]::Ordinal)
    if ($index -lt 0) { break }
    $count++
    $offset = $index + $Old.Length
  }
  if ($count -ne 1) { throw "MUTANT_MATCH_COUNT_INVALID:$count" }
}

function Invoke-ReadinessMutant {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$RelativePath,
    [Parameter(Mandatory = $true)][string]$Old,
    [Parameter(Mandatory = $true)][string]$New,
    [Parameter(Mandatory = $true)][string]$TestFile,
    [Parameter(Mandatory = $true)][string[]]$TestArguments,
    [Parameter(Mandatory = $true)][string]$TestWorkingDirectory,
    [Parameter(Mandatory = $true)][string]$ExpectedFailurePattern
  )
  $path = Join-Path $repoRoot $RelativePath
  $originalBytes = [IO.File]::ReadAllBytes($path)
  $originalHash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
  $source = (New-Object Text.UTF8Encoding($false, $true)).GetString($originalBytes)
  Assert-ReadinessMutationDefinition -Source $source -Old $Old
  $mutated = $source.Replace($Old, $New)
  try {
    [IO.File]::WriteAllBytes($path, $utf8.GetBytes($mutated))
    $mutatedHash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
    if ($mutatedHash -ceq $originalHash) { throw "mutant did not change source: $Name" }
    $captured = Invoke-ReadinessCapturedProcess `
      -File $TestFile -Arguments $TestArguments -WorkingDirectory $TestWorkingDirectory `
      -TimeoutSeconds 300
    if ($captured.exit_code -eq 0) { throw "mutant survived: $Name" }
    if ($captured.output -notmatch $ExpectedFailurePattern) {
      throw "mutant failed outside its checker: $Name"
    }
    $script:mutantsKilled++
    "MUTANT_KILLED=$Name"
  } finally {
    [IO.File]::WriteAllBytes($path, $originalBytes)
    $restoredHash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
    if ($restoredHash -cne $originalHash) { throw "mutant restore failed: $Name" }
  }
}

function Assert-NoProductionReadyBanner {
  param([AllowEmptyString()][string]$Output)
  if ($Output.Contains('Backend production is ready.')) {
    throw 'FORBIDDEN_READY_OUTPUT'
  }
}

$script:unrelatedBefore = @(Get-UnrelatedDirtySnapshot)
Add-ReadinessLayerResult -Name 'readiness-tests' -Status 'PASS' -ExitCode 0 `
  -DurationSeconds 0 -Command '.\tools\verify-production-managed-mt5-readiness.ps1 -ReadinessTestsOnly' `
  -LogPath $null -Note "$script:passes tests; $script:propertyCases property cases"

Invoke-ReadinessInProcessLayer -Name 'powershell-parser' -Command 'PowerShell 5.1 Parser.ParseFile over touched scripts' -Body {
  $paths = @(
    'run-backend-production.ps1',
    'tools/mt5-baremetal/Install-MT5BareMetalWorker.ps1',
    'tools/mt5-baremetal/Get-MT5BareMetalWorkerStatus.ps1',
    'tools/mt5-baremetal/Ensure-MT5BareMetalWorkerReady.ps1',
    'tools/verify-production-managed-mt5-readiness.ps1'
  )
  foreach ($relative in $paths) {
    $tokens = $null
    $errors = $null
    $null = [Management.Automation.Language.Parser]::ParseFile(
      (Join-Path $repoRoot $relative), [ref]$tokens, [ref]$errors
    )
    if ($errors.Count -gt 0) {
      throw "PowerShell parser rejected $relative`: $(($errors.Message) -join '; ')"
    }
  }
  "PARSED_FILES=$($paths.Count)"
}

Invoke-ReadinessInProcessLayer -Name 'checker-negative-controls' -Command 'known-bad parser, runner, mutant, and ready-output controls' -Body {
  $invalidScript = Join-Path $artifactRoot 'known-bad-parser.ps1'
  [IO.File]::WriteAllText($invalidScript, 'if (', $utf8)
  $tokens = $null
  $errors = $null
  $null = [Management.Automation.Language.Parser]::ParseFile(
    $invalidScript, [ref]$tokens, [ref]$errors
  )
  if ($errors.Count -eq 0) { throw 'parser negative control unexpectedly passed' }

  $runner = [IO.File]::ReadAllText((Join-Path $repoRoot 'run-backend-production.ps1'), $utf8)
  $badRunner = $runner.Replace('Ensure-MT5BareMetalWorkerReady.ps1', 'Removed-Worker-Gate.ps1')
  $runnerRejected = $false
  try { Assert-CanonicalRunnerContract -Source $badRunner } catch { $runnerRejected = $true }
  if (-not $runnerRejected) { throw 'runner negative control unexpectedly passed' }

  $skippedRejected = $false
  try { Assert-ReadinessMutationDefinition -Source 'source' -Old 'missing-mutant-target' } catch {
    if ($_.Exception.Message -notmatch '^MUTANT_MATCH_COUNT_INVALID:0$') { throw }
    $skippedRejected = $true
  }
  if (-not $skippedRejected) { throw 'skipped mutant negative control unexpectedly passed' }

  $readyRejected = $false
  try { Assert-NoProductionReadyBanner -Output 'Backend production is ready.' } catch {
    if ($_.Exception.Message -cne 'FORBIDDEN_READY_OUTPUT') { throw }
    $readyRejected = $true
  }
  if (-not $readyRejected) { throw 'ready-output negative control unexpectedly passed' }
  Assert-NoProductionReadyBanner -Output 'MANAGED_MT5_WORKER_READY_TIMEOUT'
  'NEGATIVE_CONTROLS=4/4'
}

$windowsPowerShell = Join-Path $PSHOME 'powershell.exe'
Invoke-ReadinessNativeLayer -Name 'portable-fixture-execution' `
  -File $windowsPowerShell `
  -Arguments @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $PSCommandPath, '-FixtureExecution') `
  -WorkingDirectory $repoRoot -TimeoutSeconds 60 `
  -RequiredPattern '"ready":true.*"task_started":false'

Invoke-ReadinessInProcessLayer -Name 'mutation' -Command 'nine execution-proven scripted mutants' -Body {
  $readinessArguments = @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $PSCommandPath, '-ReadinessTestsOnly'
  )
  Invoke-ReadinessMutant -Name 'heartbeat-expiry-boundary' `
    -RelativePath 'tools/mt5-baremetal/Ensure-MT5BareMetalWorkerReady.ps1' `
    -Old 'if ($heartbeatExpiresAtMs -le $NowUnixMilliseconds) {' `
    -New 'if ($heartbeatExpiresAtMs -lt $NowUnixMilliseconds) {' `
    -TestFile $windowsPowerShell -TestArguments $readinessArguments `
    -TestWorkingDirectory $repoRoot -ExpectedFailurePattern 'READINESS_TESTS_FAILED='
  Invoke-ReadinessMutant -Name 'worker-id-case-fold' `
    -RelativePath 'tools/mt5-baremetal/Ensure-MT5BareMetalWorkerReady.ps1' `
    -Old '[string]$_.workerId -ceq $ExpectedWorkerId' `
    -New '[string]$_.workerId -eq $ExpectedWorkerId' `
    -TestFile $windowsPowerShell -TestArguments $readinessArguments `
    -TestWorkingDirectory $repoRoot -ExpectedFailurePattern 'READINESS_TESTS_FAILED='
  Invoke-ReadinessMutant -Name 'receipt-link-accepted' `
    -RelativePath 'tools/mt5-baremetal/Ensure-MT5BareMetalWorkerReady.ps1' `
    -Old 'if (($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {' `
    -New 'if ($false) {' `
    -TestFile $windowsPowerShell -TestArguments $readinessArguments `
    -TestWorkingDirectory $repoRoot -ExpectedFailurePattern 'READINESS_TESTS_FAILED='
  Invoke-ReadinessMutant -Name 'artifact-hash-skipped' `
    -RelativePath 'tools/mt5-baremetal/Get-MT5BareMetalWorkerStatus.ps1' `
    -Old 'if ($null -ne $entry.hash) {' `
    -New 'if ($false) {' `
    -TestFile $windowsPowerShell -TestArguments $readinessArguments `
    -TestWorkingDirectory $repoRoot -ExpectedFailurePattern 'READINESS_TESTS_FAILED='
  Invoke-ReadinessMutant -Name 'noninteractive-task-accepted' `
    -RelativePath 'tools/mt5-baremetal/Get-MT5BareMetalWorkerStatus.ps1' `
    -Old "[string]`$Task.Principal.LogonType -cne 'Interactive' -or" `
    -New '`$false -or' `
    -TestFile $windowsPowerShell -TestArguments $readinessArguments `
    -TestWorkingDirectory $repoRoot -ExpectedFailurePattern 'READINESS_TESTS_FAILED='
  Invoke-ReadinessMutant -Name 'drain-accepted' `
    -RelativePath 'tools/mt5-baremetal/Ensure-MT5BareMetalWorkerReady.ps1' `
    -Old "if ([string]`$worker.status -cne 'healthy' -or [bool]`$worker.drain) {" `
    -New "if ([string]`$worker.status -cne 'healthy' -or `$false) {" `
    -TestFile $windowsPowerShell -TestArguments $readinessArguments `
    -TestWorkingDirectory $repoRoot -ExpectedFailurePattern 'READINESS_TESTS_FAILED='
  Invoke-ReadinessMutant -Name 'blind-task-restart' `
    -RelativePath 'tools/mt5-baremetal/Ensure-MT5BareMetalWorkerReady.ps1' `
    -Old "if (`$status -cne 'HEALTHY' -and `$taskState -cne 'Running' -and -not `$started) {" `
    -New 'if (-not $started) {' `
    -TestFile $windowsPowerShell -TestArguments $readinessArguments `
    -TestWorkingDirectory $repoRoot -ExpectedFailurePattern 'READINESS_TESTS_FAILED='
  Invoke-ReadinessMutant -Name 'direct-agent-launch' `
    -RelativePath 'run-backend-production.ps1' `
    -Old 'Write-Host "Starting production Go API..." -ForegroundColor Cyan' `
    -New "Start-Process -FilePath `$agentPath`r`nWrite-Host `"Starting production Go API...`" -ForegroundColor Cyan" `
    -TestFile $windowsPowerShell -TestArguments $readinessArguments `
    -TestWorkingDirectory $repoRoot -ExpectedFailurePattern 'READINESS_TESTS_FAILED='
  Invoke-ReadinessMutant -Name 'production-store-fail-open' `
    -RelativePath 'backend/internal/execution/handler.go' `
    -Old 'required := capability.mt5ConnectorIsEnabled() || managedMT5RequiredInProduction()' `
    -New 'required := capability.mt5ConnectorIsEnabled()' `
    -TestFile 'go.exe' `
    -TestArguments @('test', '-count=1', './internal/execution', '-run', 'TestProductionManagedMT5') `
    -TestWorkingDirectory (Join-Path $repoRoot 'backend') -ExpectedFailurePattern 'FAIL'
  if ($script:mutantsKilled -ne 9) { throw "mutation score mismatch: $script:mutantsKilled/9" }
  'MUTATION_SCORE=9/9'
}

$frontendRoot = Join-Path $repoRoot 'frontend'
Invoke-ReadinessNativeLayer -Name 'frontend-trade-tests' -File 'cmd.exe' `
  -Arguments @('/d', '/s', '/c', 'npm run test:trade') `
  -WorkingDirectory $frontendRoot -TimeoutSeconds 1200
Invoke-ReadinessNativeLayer -Name 'frontend-typecheck' -File 'cmd.exe' `
  -Arguments @('/d', '/s', '/c', 'npm run typecheck') `
  -WorkingDirectory $frontendRoot -TimeoutSeconds 900
Invoke-ReadinessNativeLayer -Name 'frontend-lint' -File 'cmd.exe' `
  -Arguments @('/d', '/s', '/c', 'npm run lint') `
  -WorkingDirectory $frontendRoot -TimeoutSeconds 900
Invoke-ReadinessNativeLayer -Name 'frontend-build' -File 'cmd.exe' `
  -Arguments @('/d', '/s', '/c', 'npm run build') `
  -WorkingDirectory $frontendRoot -TimeoutSeconds 1800

$backendRoot = Join-Path $repoRoot 'backend'
Invoke-ReadinessNativeLayer -Name 'go-tests-shuffled' -File 'go.exe' `
  -Arguments @('test', '-count=1', '-shuffle=on', './...') `
  -WorkingDirectory $backendRoot -TimeoutSeconds 1800
Invoke-ReadinessNativeLayer -Name 'go-vet' -File 'go.exe' `
  -Arguments @('vet', './...') -WorkingDirectory $backendRoot -TimeoutSeconds 1800
Invoke-ReadinessNativeLayer -Name 'go-coverage' -File 'go.exe' `
  -Arguments @(
    'test', '-count=1', '-covermode=atomic', "-coverprofile=$goCoveragePath", './internal/execution'
  ) -WorkingDirectory $backendRoot -TimeoutSeconds 900

Invoke-ReadinessInProcessLayer -Name 'go-changed-diff' -Command 'git diff --unified=0 task base -- handler.go' -Body {
  $diff = Invoke-ReadinessGit -Arguments @(
    'diff', '--no-ext-diff', '--unified=0', $taskBaseRef, '--',
    'backend/internal/execution/handler.go'
  )
  if ($diff -notmatch '(?m)^@@ ') { throw 'Go changed-line diff contains no hunks' }
  [IO.File]::WriteAllText($goDiffPath, $diff, $utf8)
  'GO_CHANGED_DIFF=backend/internal/execution/handler.go'
}
Invoke-ReadinessNativeLayer -Name 'go-changed-coverage-gate' -File 'python.exe' `
  -Arguments @(
    (Join-Path $repoRoot 'tools/mt5-baremetal/changed_line_coverage.py'),
    '--format', 'go', '--coverage', $goCoveragePath, '--diff', $goDiffPath,
    '--repo-root', $repoRoot, '--source-root', $backendRoot,
    '--label', 'production-managed-mt5-readiness-go',
    '--json-output', $goCoverageSummaryPath
  ) -WorkingDirectory $repoRoot -TimeoutSeconds 120

Invoke-ReadinessInProcessLayer -Name 'coverage-negative-fixture' -Command 'write known uncovered Go diff/profile' -Body {
  $negativeDiff = Join-Path $artifactRoot 'known-uncovered.diff'
  $negativeCoverage = Join-Path $artifactRoot 'known-uncovered.out'
  [IO.File]::WriteAllText($negativeDiff, @'
diff --git a/backend/internal/negative.go b/backend/internal/negative.go
--- a/backend/internal/negative.go
+++ b/backend/internal/negative.go
@@ -0,0 +1 @@
+knownBad()
'@, $utf8)
  [IO.File]::WriteAllText($negativeCoverage, @'
mode: atomic
github.com/marketlens/backend/internal/negative.go:1.1,2.1 1 0
'@, $utf8)
  'KNOWN_UNCOVERED_FIXTURE=created'
}
Invoke-ReadinessExpectedFailureLayer -Name 'go-coverage-negative-control' -File 'python.exe' `
  -Arguments @(
    (Join-Path $repoRoot 'tools/mt5-baremetal/changed_line_coverage.py'),
    '--format', 'go',
    '--coverage', (Join-Path $artifactRoot 'known-uncovered.out'),
    '--diff', (Join-Path $artifactRoot 'known-uncovered.diff'),
    '--repo-root', $repoRoot, '--source-root', $backendRoot,
    '--label', 'known-uncovered',
    '--json-output', (Join-Path $artifactRoot 'known-uncovered.json')
  ) -WorkingDirectory $repoRoot -TimeoutSeconds 120

$rustRoot = Join-Path $backendRoot 'execution'
Invoke-ReadinessNativeLayer -Name 'rust-worker-registry-tests' -File 'cargo.exe' `
  -Arguments @('test', '--locked', '-p', 'execution-gateway', 'mt5_vm_control') `
  -WorkingDirectory $rustRoot -TimeoutSeconds 1800
Invoke-ReadinessNativeLayer -Name 'rust-worker-agent-tests' -File 'cargo.exe' `
  -Arguments @('test', '--locked', '-p', 'mt5-vm-agent', '--lib', '--', '--test-threads=1') `
  -WorkingDirectory $rustRoot -TimeoutSeconds 1800

Invoke-ReadinessNativeLayer -Name 'diff-whitespace' -File 'git.exe' `
  -Arguments (@('-c', 'core.safecrlf=false', 'diff', '--check', $taskBaseRef, '--') +
    @(Get-ReadinessTaskPaths)) -WorkingDirectory $repoRoot -TimeoutSeconds 120

Invoke-ReadinessInProcessLayer -Name 'dependency-capability-secret-audit' `
  -Command 'task diff dependency, capability, and high-confidence secret audit' -Body {
  $manifestChanges = @((Invoke-ReadinessGit -Arguments @(
    'diff', '--name-only', $taskBaseRef, '--',
    'backend/go.mod', 'backend/go.sum', 'backend/execution/Cargo.toml',
    'backend/execution/Cargo.lock', 'frontend/package.json', 'frontend/package-lock.json'
  )) -split "`r?`n" | Where-Object { $_ -ne '' })
  if ($manifestChanges.Count -ne 0) {
    throw "unexpected dependency manifest delta: $($manifestChanges -join ', ')"
  }

  $addedText = Get-TaskAddedText
  $secretControls = @(
    '(?i)-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',
    '(?i)\b(?:aws_secret_access_key|client_secret)\s*[:=]\s*[^<\s][^\s]{7,}',
    '(?i)\b[a-z][a-z0-9+.-]*://[^/\s:@]+:[^@\s/]+@'
  )
  $knownCredential = 'https://' + 'known-user' + ':' + 'known-secret' + '@private.invalid'
  if ($knownCredential -notmatch $secretControls[2]) {
    throw 'secret scanner negative control unexpectedly passed'
  }
  foreach ($pattern in $secretControls) {
    if ($addedText -match $pattern) { throw 'high-confidence secret pattern found in task additions' }
  }

  $runnerAdded = Invoke-ReadinessGit -Arguments @(
    'diff', '--unified=0', $taskBaseRef, '--', 'run-backend-production.ps1'
  )
  if ($runnerAdded -match '(?im)^\+.*(?:mt5-vm-agent\.exe|terminal64\.exe|Invoke-WebRequest|Start-BitsTransfer|SendKeys|Set-Clipboard)') {
    throw 'unapproved runner capability found in task additions'
  }
  $helperSource = [IO.File]::ReadAllText($helperPath, $utf8)
  if ($helperSource -match '(?i)Start-Process|terminal64\.exe|Invoke-WebRequest|Start-BitsTransfer') {
    throw 'readiness helper gained an unapproved process or network capability'
  }
  if ($helperSource -notmatch "Start-ScheduledTask -TaskName") {
    throw 'readiness helper no longer uses the exact Scheduled Task boundary'
  }
  'DEPENDENCIES=none CAPABILITY=attested-task-and-loopback-admin-only SECRET_SCAN=clean'
}

Invoke-ReadinessInProcessLayer -Name 'source-state' -Command 'hash task-owned source paths' -Body {
  $script:sourceState = Get-ReadinessTaskSourceState
  "TASK_TREE_SHA256=$($script:sourceState.task_tree_sha256) FILES=$($script:sourceState.file_count)"
}

Invoke-ReadinessInProcessLayer -Name 'unrelated-dirty-preservation' `
  -Command 'compare status and SHA-256 for every non-task dirty path' -Body {
  $script:unrelatedAfter = @(Get-UnrelatedDirtySnapshot)
  $beforeJson = $script:unrelatedBefore | ConvertTo-Json -Depth 5 -Compress
  $afterJson = $script:unrelatedAfter | ConvertTo-Json -Depth 5 -Compress
  if ($beforeJson -cne $afterJson) { throw 'unrelated dirty worktree changed during the gauntlet' }
  "UNRELATED_DIRTY_PATHS_PRESERVED=$($script:unrelatedBefore.Count)"
}

$failedLayers = @($script:layerResults | Where-Object { $_.status -eq 'FAIL' })
$summary = [pscustomobject][ordered]@{
  gate = 'production-managed-mt5-readiness'
  spec = 'production-managed-mt5-readiness v1'
  tier = 3
  status = if ($failedLayers.Count -eq 0) { 'PASS_WITH_DECLARED_UNVERIFIED' } else { 'FAIL' }
  head = (Invoke-ReadinessGit -Arguments @('rev-parse', 'HEAD')).Trim()
  task_base_ref = $taskBaseRef
  task_tree_sha256 = if ($null -eq $script:sourceState) { $null } else { $script:sourceState.task_tree_sha256 }
  started_at_utc = $startedAt.ToString('o')
  completed_at_utc = [DateTime]::UtcNow.ToString('o')
  readiness_tests = $script:passes
  property_cases = $script:propertyCases
  mutants_killed = $script:mutantsKilled
  mutants_total = 9
  failed_layers = @($failedLayers | ForEach-Object { $_.name })
  declared_unverified = @(
    'real production Scheduled Task, worker heartbeat, and terminal execution',
    'broker Demo account onboarding and R15-9',
    'independent verification',
    'browser screenshot and interaction automation',
    'Go race detector; no new concurrent Go path and the normal suite is shuffled'
  )
  unrelated_dirty_before = $script:unrelatedBefore
  unrelated_dirty_after = $script:unrelatedAfter
  results = $script:layerResults
}
[IO.File]::WriteAllText($summaryPath, ($summary | ConvertTo-Json -Depth 8), $utf8)

Write-Host "PRODUCTION_MANAGED_MT5_READINESS_STATUS=$($summary.status)"
Write-Host "FAILED_LAYERS=$($failedLayers.Count)"
Write-Host "READINESS_TESTS=$script:passes PROPERTY_CASES=$script:propertyCases MUTANTS=$script:mutantsKilled/9"
Write-Host "SUMMARY=$summaryPath"
if ($failedLayers.Count -gt 0) { exit 1 }
