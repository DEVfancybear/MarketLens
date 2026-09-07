[CmdletBinding()]
param(
  [string]$InstallInputPath,
  [string]$BackendEnvPath,
  [string]$RepoRoot,
  [string]$AgentPath,
  [string]$GatewayUrl = 'http://127.0.0.1:8791',
  [string]$CredentialApiUrl = 'http://127.0.0.1:8080',
  [switch]$Execute
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'mt5-baremetal/MT5ProvisioningState.ps1')
$script:AutoInstallUtf8 = New-Object Text.UTF8Encoding($false, $true)

function Assert-ProductionManagedWorkerAbsoluteFileBoundary {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [ValidateRange(1, 2147483648)][long]$MaximumBytes = 524288
  )
  if ([string]::IsNullOrWhiteSpace($Path) -or -not [IO.Path]::IsPathRooted($Path)) {
    throw 'MANAGED_MT5_WORKER_AUTOINSTALL_PATH_INVALID'
  }
  try {
    $full = [IO.Path]::GetFullPath($Path)
    $item = Get-Item -LiteralPath $full -Force -ErrorAction Stop
    if ($item -isnot [IO.FileInfo] -or $item.Length -lt 1 -or $item.Length -gt $MaximumBytes) {
      throw 'MANAGED_MT5_WORKER_AUTOINSTALL_PATH_INVALID'
    }
    $cursor = $item
    while ($null -ne $cursor) {
      if (($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw 'MANAGED_MT5_WORKER_AUTOINSTALL_PATH_INVALID'
      }
      $cursor = if ($cursor -is [IO.FileInfo]) { $cursor.Directory } else { $cursor.Parent }
    }
    return $full
  } catch {
    throw 'MANAGED_MT5_WORKER_AUTOINSTALL_PATH_INVALID'
  }
}

function Assert-ProductionManagedWorkerInputAclBoundary {
  param([Parameter(Mandatory = $true)][string]$Path)
  $acl = Get-Acl -LiteralPath $Path
  if (-not $acl.AreAccessRulesProtected) {
    throw 'MANAGED_MT5_WORKER_AUTOINSTALL_INPUT_ACL_INVALID'
  }
  $currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $allowed = @($currentSid, 'S-1-5-18', 'S-1-5-32-544')
  $rules = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
  if ($rules.Count -lt 1) { throw 'MANAGED_MT5_WORKER_AUTOINSTALL_INPUT_ACL_INVALID' }
  foreach ($rule in $rules) {
    if ($rule.IsInherited -or $rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or
        $allowed -notcontains $rule.IdentityReference.Value) {
      throw 'MANAGED_MT5_WORKER_AUTOINSTALL_INPUT_ACL_INVALID'
    }
  }
}

function Assert-ProductionManagedWorkerStrictJsonBoundary {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$PythonPath
  )
  $python = Assert-ProductionManagedWorkerAbsoluteFileBoundary -Path $PythonPath -MaximumBytes 268435456
  $code = "import json,sys; json.load(open(sys.argv[1], 'r', encoding='utf-8-sig'), object_pairs_hook=lambda pairs: (_ for _ in ()).throw(ValueError('duplicate')) if len(pairs) != len(dict(pairs)) else dict(pairs))"
  $previousErrorPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $output = @(& $python -c $code $Path 2>&1)
    $pythonExitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorPreference
  }
  if ($pythonExitCode -ne 0) {
    throw 'MANAGED_MT5_WORKER_AUTOINSTALL_INPUT_JSON_INVALID'
  }
}

function Assert-ProductionManagedWorkerObjectFieldsBoundary {
  param(
    [Parameter(Mandatory = $true)][object]$Value,
    [Parameter(Mandatory = $true)][string[]]$Allowed,
    [Parameter(Mandatory = $true)][string[]]$Required
  )
  if ($null -eq $Value -or $Value -is [Array] -or $Value -is [string]) {
    throw 'MANAGED_MT5_WORKER_AUTOINSTALL_INPUT_SCHEMA_INVALID'
  }
  $names = @($Value.PSObject.Properties.Name)
  if (@($names | Where-Object { $Allowed -cnotcontains $_ }).Count -ne 0 -or
      @($Required | Where-Object { $names -cnotcontains $_ }).Count -ne 0) {
    throw 'MANAGED_MT5_WORKER_AUTOINSTALL_INPUT_SCHEMA_INVALID'
  }
}

function Get-ProductionManagedWorkerOptionalPropertyBoundary {
  param(
    [Parameter(Mandatory = $true)][object]$Value,
    [Parameter(Mandatory = $true)][string]$Name,
    $DefaultValue = $null
  )
  $property = $Value.PSObject.Properties[$Name]
  if ($null -eq $property -or $null -eq $property.Value) { return $DefaultValue }
  return $property.Value
}

function Read-ProductionManagedWorkerInstallInputBoundary {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$PythonPath,
    [scriptblock]$AclValidator
  )
  $full = Assert-ProductionManagedWorkerAbsoluteFileBoundary -Path $Path
  if ($null -eq $AclValidator) {
    Assert-ProductionManagedWorkerInputAclBoundary -Path $full
  } else {
    & $AclValidator $full
  }
  Assert-ProductionManagedWorkerStrictJsonBoundary -Path $full -PythonPath $PythonPath
  try {
    $parsed = [IO.File]::ReadAllText($full, $script:AutoInstallUtf8) | ConvertFrom-Json -ErrorAction Stop
  } catch {
    throw 'MANAGED_MT5_WORKER_AUTOINSTALL_INPUT_JSON_INVALID'
  }
  $allowed = @(
    'schema_version', 'worker_root', 'data_root', 'worker_identity', 'task_name', 'worker_id',
    'powershell_path', 'bootstrap_token_file', 'terminal_slots', 'minimum_ea_version',
    'agent_version', 'image_version', 'runtime_version', 'region', 'probe_symbol', 'sync_symbols',
    'history_lookback_ms', 'max_processes', 'process_memory_bytes', 'cpu_budget_percent',
    'minimum_free_disk_bytes', 'startup_timeout_ms'
  )
  $required = @(
    'schema_version', 'worker_root', 'data_root', 'worker_identity',
    'bootstrap_token_file', 'terminal_slots'
  )
  Assert-ProductionManagedWorkerObjectFieldsBoundary -Value $parsed -Allowed $allowed -Required $required
  if ([int]$parsed.schema_version -ne 1 -or @($parsed.terminal_slots).Count -lt 1 -or
      @($parsed.terminal_slots).Count -gt 4) {
    throw 'MANAGED_MT5_WORKER_AUTOINSTALL_INPUT_SCHEMA_INVALID'
  }
  $slotFields = @(
    'slot_id', 'terminal_path', 'terminal_state_root', 'terminal_sha256', 'servers_sha256',
    'terminal_license_sha256', 'ea_path', 'ea_sha256', 'ea_bootstrap_pipe', 'ea_profile',
    'ea_gateway_origin', 'ea_chart_template_path', 'ea_chart_template_sha256',
    'ea_webrequest_settings_source_path', 'ea_webrequest_settings_sha256',
    'ea_topology_attestation_source_path', 'ea_topology_attestation_sha256'
  )
  foreach ($slot in @($parsed.terminal_slots)) {
    Assert-ProductionManagedWorkerObjectFieldsBoundary `
      -Value $slot -Allowed $slotFields -Required $slotFields
  }
  foreach ($name in @('worker_root', 'data_root', 'worker_identity', 'bootstrap_token_file')) {
    $value = [string]$parsed.$name
    if ([string]::IsNullOrWhiteSpace($value) -or $value.IndexOfAny([char[]]"`r`n`0") -ge 0) {
      throw 'MANAGED_MT5_WORKER_AUTOINSTALL_INPUT_SCHEMA_INVALID'
    }
  }
  return $parsed
}

function Set-ProductionManagedWorkerReceiptEnvBoundary {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$BackendEnvPath,
    [Parameter(Mandatory = $true)][string]$ReceiptPath
  )
  $envPath = Assert-ProductionManagedWorkerAbsoluteFileBoundary -Path $BackendEnvPath -MaximumBytes 1048576
  if ([string]::IsNullOrWhiteSpace($ReceiptPath) -or -not [IO.Path]::IsPathRooted($ReceiptPath) -or
      $ReceiptPath.IndexOfAny([char[]]"`r`n`0#") -ge 0) {
    throw 'MANAGED_MT5_WORKER_AUTOINSTALL_RECEIPT_INVALID'
  }
  $normalizedReceipt = [IO.Path]::GetFullPath($ReceiptPath)
  Set-ProvisionDotEnv -Path $envPath -Assignments @{ EXECUTION_MT5_MANAGED_WORKER_RECEIPT_FILE = $normalizedReceipt }
  return $normalizedReceipt
}

function Get-ProductionManagedWorkerInstallArgumentsBoundary {
  param(
    [Parameter(Mandatory = $true)][object]$InputObject,
    [Parameter(Mandatory = $true)][string]$RepoRoot,
    [Parameter(Mandatory = $true)][string]$AgentPath,
    [Parameter(Mandatory = $true)][string]$GatewayUrl,
    [Parameter(Mandatory = $true)][string]$CredentialApiUrl
  )
  $backend = Join-Path $RepoRoot 'backend'
  $arguments = @{
    WorkerRoot = [string]$InputObject.worker_root
    DataRoot = [string]$InputObject.data_root
    WorkerIdentity = [string]$InputObject.worker_identity
    TaskName = [string](Get-ProductionManagedWorkerOptionalPropertyBoundary -Value $InputObject -Name 'task_name' -DefaultValue 'MarketLens MT5 Worker')
    WorkerId = [string](Get-ProductionManagedWorkerOptionalPropertyBoundary -Value $InputObject -Name 'worker_id' -DefaultValue 'marketlens-baremetal-01')
    AgentPath = (Assert-ProductionManagedWorkerAbsoluteFileBoundary -Path $AgentPath -MaximumBytes 1073741824)
    PythonPath = (Assert-ProductionManagedWorkerAbsoluteFileBoundary -Path (Join-Path $backend '.venv-mt5\Scripts\python.exe') -MaximumBytes 268435456)
    AdapterPath = (Assert-ProductionManagedWorkerAbsoluteFileBoundary -Path (Join-Path $backend 'bridge\mt5_vm\phase1_adapter.py'))
    AclHelperPath = (Assert-ProductionManagedWorkerAbsoluteFileBoundary -Path (Join-Path $backend 'bridge\mt5_vm\Set-MT5VmPhase1RuntimeAcl.ps1'))
    PowerShellPath = [string](Get-ProductionManagedWorkerOptionalPropertyBoundary `
      -Value $InputObject -Name 'powershell_path' `
      -DefaultValue (Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'))
    BootstrapTokenFile = [string]$InputObject.bootstrap_token_file
    EaReleaseManifestPath = (Assert-ProductionManagedWorkerAbsoluteFileBoundary -Path (Join-Path $RepoRoot 'frontend\public\downloads\MarketLensExecutionEA.release.json'))
    EaReleaseChecksumPath = (Assert-ProductionManagedWorkerAbsoluteFileBoundary -Path (Join-Path $RepoRoot 'frontend\public\downloads\MarketLensExecutionEA.sha256.txt'))
    GatewayUrl = $GatewayUrl
    CredentialApiUrl = $CredentialApiUrl
    TerminalSlots = @($InputObject.terminal_slots)
  }
  foreach ($name in @('AgentPath', 'PythonPath', 'AdapterPath')) {
    $arguments[$name.Replace('Path', 'Sha256')] = (Get-FileHash -LiteralPath $arguments[$name] -Algorithm SHA256).Hash
  }
  $optional = @{
    minimum_ea_version = 'MinimumEaVersion'; agent_version = 'AgentVersion'; image_version = 'ImageVersion'
    runtime_version = 'RuntimeVersion'; region = 'Region'; probe_symbol = 'ProbeSymbol'
    sync_symbols = 'SyncSymbols'; history_lookback_ms = 'HistoryLookbackMs'; max_processes = 'MaxProcesses'
    process_memory_bytes = 'ProcessMemoryBytes'; cpu_budget_percent = 'CpuBudgetPercent'
    minimum_free_disk_bytes = 'MinimumFreeDiskBytes'; startup_timeout_ms = 'StartupTimeoutMs'
  }
  foreach ($entry in $optional.GetEnumerator()) {
    $value = Get-ProductionManagedWorkerOptionalPropertyBoundary -Value $InputObject -Name $entry.Key
    if ($null -ne $value) { $arguments[$entry.Value] = $value }
  }
  return $arguments
}

function Assert-ProductionManagedWorkerReceiptBoundary {
  param(
    [Parameter(Mandatory = $true)][string]$ReceiptPath,
    [Parameter(Mandatory = $true)][object]$InputObject,
    [Parameter(Mandatory = $true)][string]$ExpectedAgentSha256
  )
  $expected = [IO.Path]::GetFullPath((Join-Path ([string]$InputObject.worker_root) 'managed-worker-installation.json'))
  $actual = Assert-ProductionManagedWorkerAbsoluteFileBoundary -Path $ReceiptPath -MaximumBytes 65536
  if (-not [string]::Equals($actual, $expected, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'MANAGED_MT5_WORKER_AUTOINSTALL_RECEIPT_INVALID'
  }
  . (Join-Path $PSScriptRoot 'mt5-baremetal\Ensure-MT5BareMetalWorkerReady.ps1')
  $receipt = Read-MT5BareMetalWorkerReceipt -Path $actual
  $taskName = [string](Get-ProductionManagedWorkerOptionalPropertyBoundary -Value $InputObject -Name 'task_name' -DefaultValue 'MarketLens MT5 Worker')
  $workerId = [string](Get-ProductionManagedWorkerOptionalPropertyBoundary -Value $InputObject -Name 'worker_id' -DefaultValue 'marketlens-baremetal-01')
  if ([string]$receipt.task_name -cne $taskName -or [string]$receipt.worker_id -cne $workerId -or
      -not [string]::Equals([string]$receipt.worker_identity, [string]$InputObject.worker_identity, [StringComparison]::OrdinalIgnoreCase) -or
      [int]$receipt.slot_count -ne @($InputObject.terminal_slots).Count -or
      -not [string]::Equals([string]$receipt.agent_sha256, $ExpectedAgentSha256, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'MANAGED_MT5_WORKER_AUTOINSTALL_RECEIPT_INVALID'
  }
  return $receipt
}

function Assert-ProductionManagedWorkerAdoptionBoundary {
  param([Parameter(Mandatory = $true)][object]$Receipt)
  . (Join-Path $PSScriptRoot 'mt5-baremetal\Get-MT5BareMetalWorkerStatus.ps1')
  $status = Get-MT5BareMetalWorkerStatusCore `
    -TaskName ([string]$Receipt.task_name) -WorkerIdentity ([string]$Receipt.worker_identity) `
    -PowerShellPath ([string]$Receipt.powershell_path) -LauncherPath ([string]$Receipt.launcher_path) `
    -AgentPath ([string]$Receipt.agent_path) -AgentSha256 ([string]$Receipt.agent_sha256) `
    -ConfigPath ([string]$Receipt.config_path) -ConfigSha256 ([string]$Receipt.config_sha256)
  if ([string]$status.worker_id -cne [string]$Receipt.worker_id -or
      [int]$status.slot_count -ne [int]$Receipt.slot_count) {
    throw 'MANAGED_MT5_WORKER_AUTOINSTALL_ADOPTION_INVALID'
  }
}

function Invoke-ProductionManagedWorkerAutoInstallCore {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][object]$InputObject,
    [Parameter(Mandatory = $true)][hashtable]$InstallerArguments,
    [Parameter(Mandatory = $true)][string]$BackendEnvPath,
    [Parameter(Mandatory = $true)][scriptblock]$InstallerInvoker,
    [Parameter(Mandatory = $true)][scriptblock]$ReceiptValidator,
    [Parameter(Mandatory = $true)][scriptblock]$AdoptionValidator,
    [Parameter(Mandatory = $true)][scriptblock]$ReceiptPersister,
    [switch]$Execute
  )
  $expectedReceipt = [IO.Path]::GetFullPath((Join-Path ([string]$InputObject.worker_root) 'managed-worker-installation.json'))
  if (Test-Path -LiteralPath $expectedReceipt -PathType Leaf) {
    $receipt = & $ReceiptValidator $expectedReceipt
    & $AdoptionValidator $receipt
    $persisted = & $ReceiptPersister $BackendEnvPath $expectedReceipt
    return [pscustomobject][ordered]@{ status = 'ADOPTED'; receipt_path = $persisted; installed = $false }
  }
  $dryRun = & $InstallerInvoker $InstallerArguments $false
  if ($null -eq $dryRun -or [string]$dryRun.status -cne 'DRY_RUN' -or -not [bool]$dryRun.dry_run) {
    throw 'MANAGED_MT5_WORKER_AUTOINSTALL_DRY_RUN_INVALID'
  }
  if (-not $Execute) {
    return [pscustomobject][ordered]@{ status = 'DRY_RUN'; receipt_path = $null; installed = $false }
  }
  $installed = & $InstallerInvoker $InstallerArguments $true
  if ($null -eq $installed -or [string]::IsNullOrWhiteSpace([string]$installed.receipt_path)) {
    throw 'MANAGED_MT5_WORKER_AUTOINSTALL_EXECUTION_INVALID'
  }
  $receipt = & $ReceiptValidator ([string]$installed.receipt_path)
  $persisted = & $ReceiptPersister $BackendEnvPath ([string]$installed.receipt_path)
  return [pscustomobject][ordered]@{ status = 'INSTALLED'; receipt_path = $persisted; installed = $true }
}

function Invoke-ProductionManagedWorkerAutoInstall {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$InstallInputPath,
    [Parameter(Mandatory = $true)][string]$BackendEnvPath,
    [Parameter(Mandatory = $true)][string]$RepoRoot,
    [Parameter(Mandatory = $true)][string]$AgentPath,
    [Parameter(Mandatory = $true)][string]$GatewayUrl,
    [Parameter(Mandatory = $true)][string]$CredentialApiUrl,
    [switch]$Execute
  )
  $repo = [IO.Path]::GetFullPath($RepoRoot)
  $pythonPath = Join-Path $repo 'backend\.venv-mt5\Scripts\python.exe'
  $inputObject = Read-ProductionManagedWorkerInstallInputBoundary `
    -Path $InstallInputPath -PythonPath $pythonPath
  $installerArguments = Get-ProductionManagedWorkerInstallArgumentsBoundary `
    -InputObject $inputObject -RepoRoot $repo -AgentPath $AgentPath `
    -GatewayUrl $GatewayUrl -CredentialApiUrl $CredentialApiUrl
  $agentHash = [string]$installerArguments.AgentSha256
  $installerPath = Join-Path $PSScriptRoot 'mt5-baremetal\Install-MT5BareMetalWorker.ps1'
  . $installerPath
  return Invoke-ProductionManagedWorkerAutoInstallCore `
    -InputObject $inputObject -InstallerArguments $installerArguments `
    -BackendEnvPath $BackendEnvPath -Execute:$Execute `
    -InstallerInvoker {
      param($arguments, $executeInstall)
      $call = @{} + $arguments
      if ($executeInstall) { $call.Execute = $true }
      $result = Install-MT5BareMetalWorkerCore @call
      return ($result | ConvertTo-Json -Depth 8 -Compress | ConvertFrom-Json)
    } `
    -ReceiptValidator {
      param($path)
      Assert-ProductionManagedWorkerReceiptBoundary `
        -ReceiptPath $path -InputObject $inputObject -ExpectedAgentSha256 $agentHash
    } `
    -AdoptionValidator { param($receipt) Assert-ProductionManagedWorkerAdoptionBoundary -Receipt $receipt } `
    -ReceiptPersister {
      param($path, $receipt)
      Set-ProductionManagedWorkerReceiptEnvBoundary -BackendEnvPath $path -ReceiptPath $receipt
    }
}

if ($MyInvocation.InvocationName -ne '.') {
  try {
    Invoke-ProductionManagedWorkerAutoInstall @PSBoundParameters | ConvertTo-Json -Depth 6 -Compress
  } catch {
    $code = [string]$_.Exception.Message
    if ($code -notmatch '^(?:MANAGED_MT5_WORKER_AUTOINSTALL_|BAREMETAL_)[A-Z0-9_]+$') {
      $code = 'MANAGED_MT5_WORKER_AUTOINSTALL_FAILED'
    }
    throw $code
  }
}
