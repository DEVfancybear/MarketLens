[CmdletBinding()]
param(
  [switch]$ContractTestsOnly,
  [switch]$KnownBadControl,
  [switch]$UnreadableInputControl,
  [switch]$OccupiedPortControl
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$uiHelper = Join-Path $repoRoot 'backend\bridge\mt5_vm\Mt5VmTerminalUi.ps1'
$probeDriver = Join-Path $PSScriptRoot 'Invoke-MT5WebRequestProbe.ps1'
$selectedTerminal = 'C:\Program Files\MetaTrader 5\terminal64.exe'
$selectedProfile = 'C:\Users\Duong\AppData\Roaming\MetaQuotes\Terminal\D0E8209F77C8CF37AD8BF550E51FF075'
$expectedPublisher = 'CN=MetaQuotes Ltd., O=MetaQuotes Ltd., S=Lemesos, C=CY'
$gatewayBinary = Join-Path $repoRoot 'backend\bin\execution-gateway.exe'
$expectedOrigin = 'http://127.0.0.1'
$listenAddress = '127.0.0.1'
$listenPort = 80
$connectAddress = '127.0.0.1'
$connectPort = 8790

function Assert-ProductionAllowlistTrue {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][bool]$Condition,
    [Parameter(Mandatory = $true)][string]$Code
  )
  if (-not $Condition) { throw $Code }
}

function Assert-ProductionNoReparseComponent {
  [CmdletBinding()]
  param([Parameter(Mandatory = $true)][string]$Path)

  $cursor = Get-Item -LiteralPath ([IO.Path]::GetFullPath($Path)) -Force -ErrorAction Stop
  while ($null -ne $cursor) {
    if (($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw 'PROVISIONING_WEBREQUEST_REPARSE_PATH_REJECTED'
    }
    $cursor = if ($cursor -is [IO.FileInfo]) { $cursor.Directory } else { $cursor.Parent }
  }
}

function Assert-ProductionSelectedTerminalProfile {
  [CmdletBinding()]
  param()

  Assert-MT5VmTrustedTerminalBoundary -TerminalPath $selectedTerminal
  Assert-ProductionNoReparseComponent -Path $selectedTerminal
  $signature = Get-AuthenticodeSignature -LiteralPath $selectedTerminal
  if ($signature.Status -ne [Management.Automation.SignatureStatus]::Valid -or
      $null -eq $signature.SignerCertificate -or
      -not [string]::Equals(
        [string]$signature.SignerCertificate.Subject,
        $expectedPublisher,
        [StringComparison]::Ordinal
      )) {
    throw 'PROVISIONING_WEBREQUEST_TERMINAL_SIGNER_MISMATCH'
  }
  if (-not (Test-Path -LiteralPath $selectedProfile -PathType Container)) {
    throw 'PROVISIONING_WEBREQUEST_SELECTED_PROFILE_MISSING'
  }
  Assert-ProductionNoReparseComponent -Path $selectedProfile
  $profileOriginPath = Join-Path $selectedProfile 'origin.txt'
  if (-not (Test-Path -LiteralPath $profileOriginPath -PathType Leaf)) {
    throw 'PROVISIONING_WEBREQUEST_SELECTED_PROFILE_ORIGIN_MISSING'
  }
  Assert-ProductionNoReparseComponent -Path $profileOriginPath
  $profileOrigin = (Get-Content -LiteralPath $profileOriginPath -Raw).Trim().TrimEnd('\')
  $terminalRoot = (Split-Path -Parent $selectedTerminal).TrimEnd('\')
  if (-not [string]::Equals(
      $profileOrigin,
      $terminalRoot,
      [StringComparison]::OrdinalIgnoreCase
    )) {
    throw 'PROVISIONING_WEBREQUEST_SELECTED_PROFILE_ORIGIN_MISMATCH'
  }
}

function ConvertFrom-ProductionPortProxyOutput {
  [CmdletBinding()]
  param([Parameter(Mandatory = $true)][AllowEmptyString()][string]$OutputText)

  $entries = [Collections.Generic.List[object]]::new()
  foreach ($line in @($OutputText -split '\r?\n')) {
    $trimmed = $line.Trim()
    if ($trimmed.Length -eq 0 -or $trimmed -match '^-+$') { continue }
    $match = [regex]::Match(
      $trimmed,
      '^(\S+)\s+(\d+)\s+(\S+)\s+(\d+)$'
    )
    if (-not $match.Success) {
      if ($trimmed -match '\d{1,3}(?:\.\d{1,3}){3}') {
        throw 'PROVISIONING_WEBREQUEST_PORTPROXY_OUTPUT_INVALID'
      }
      continue
    }
    $listenIp = $null
    $connectIp = $null
    if (-not [Net.IPAddress]::TryParse($match.Groups[1].Value, [ref]$listenIp) -or
        -not [Net.IPAddress]::TryParse($match.Groups[3].Value, [ref]$connectIp) -or
        $listenIp.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork -or
        $connectIp.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) {
      throw 'PROVISIONING_WEBREQUEST_PORTPROXY_OUTPUT_INVALID'
    }
    $parsedListenPort = 0
    $parsedConnectPort = 0
    if (-not [int]::TryParse($match.Groups[2].Value, [ref]$parsedListenPort) -or
        -not [int]::TryParse($match.Groups[4].Value, [ref]$parsedConnectPort) -or
        $parsedListenPort -lt 1 -or $parsedListenPort -gt 65535 -or
        $parsedConnectPort -lt 1 -or $parsedConnectPort -gt 65535) {
      throw 'PROVISIONING_WEBREQUEST_PORTPROXY_OUTPUT_INVALID'
    }
    $entries.Add([pscustomobject][ordered]@{
        listen_address = $listenIp.ToString()
        listen_port = $parsedListenPort
        connect_address = $connectIp.ToString()
        connect_port = $parsedConnectPort
      })
  }
  return @($entries)
}

function Assert-ProductionLoopbackPortProxyState {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$Entries,
    [switch]$AllowEmpty
  )

  if ($Entries.Count -eq 0) {
    if ($AllowEmpty) { return 'EMPTY' }
    throw 'PROVISIONING_WEBREQUEST_PORTPROXY_STATE_INVALID'
  }
  if ($Entries.Count -ne 1) {
    throw 'PROVISIONING_WEBREQUEST_PORTPROXY_STATE_INVALID'
  }
  $entry = $Entries[0]
  if ([string]$entry.listen_address -cne $listenAddress -or
      [int]$entry.listen_port -ne $listenPort -or
      [string]$entry.connect_address -cne $connectAddress -or
      [int]$entry.connect_port -ne $connectPort) {
    throw 'PROVISIONING_WEBREQUEST_PORTPROXY_STATE_INVALID'
  }
  return 'EXACT'
}

function Assert-ProductionPort80ListenerState {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$Listeners,
    [Parameter(Mandatory = $true)][bool]$ExpectPresent
  )

  if (-not $ExpectPresent) {
    if ($Listeners.Count -ne 0) {
      throw 'PROVISIONING_WEBREQUEST_PORT80_OCCUPIED'
    }
    return $true
  }
  if ($Listeners.Count -ne 1 -or
      [string]$Listeners[0].local_address -cne $listenAddress -or
      [int]$Listeners[0].local_port -ne $listenPort -or
      [string]$Listeners[0].process_name -cne 'System') {
    throw 'PROVISIONING_WEBREQUEST_PORT80_LISTENER_INVALID'
  }
  return $true
}

function Test-ProductionPriorWebRequestState {
  [CmdletBinding()]
  param([Parameter(Mandatory = $true)][object]$State)
  return (
    [int]$State.Enabled -eq 0 -and
    @($State.Items).Count -eq 1 -and
    [string]::IsNullOrEmpty([string]@($State.Items)[0])
  )
}

function Invoke-ProductionPendingOnlyPreflight {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][int]$ProcessId,
    [Parameter(Mandatory = $true)][string]$ExpectedOrigin,
    [Parameter(Mandatory = $true)][scriptblock]$OpenAction,
    [Parameter(Mandatory = $true)][scriptblock]$ReadAction,
    [Parameter(Mandatory = $true)][scriptblock]$WriteAction,
    [Parameter(Mandatory = $true)][scriptblock]$CancelAction
  )

  $desired = [pscustomobject][ordered]@{
    Enabled = 1
    Items = @($ExpectedOrigin)
  }
  $active = [IntPtr]::Zero
  try {
    $active = [IntPtr](& $OpenAction $ProcessId)
    $prior = & $ReadAction $active
    if (Test-MT5VmDesiredWebRequestState -State $prior -ExpectedOrigin $ExpectedOrigin) {
      & $CancelAction $active
      $active = [IntPtr]::Zero
      return [pscustomobject][ordered]@{ status = 'EXISTING'; prior = $prior }
    }
    if (-not (Test-ProductionPriorWebRequestState -State $prior)) {
      throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_STATE_INVALID'
    }
    & $WriteAction $active $desired
    $pending = & $ReadAction $active
    if (-not (Test-MT5VmDesiredWebRequestState -State $pending -ExpectedOrigin $ExpectedOrigin)) {
      throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_PENDING_FAILED'
    }
    & $CancelAction $active
    $active = [IntPtr]::Zero

    $active = [IntPtr](& $OpenAction $ProcessId)
    $persisted = & $ReadAction $active
    & $CancelAction $active
    $active = [IntPtr]::Zero
    if (-not (Test-MT5VmWebRequestStateExact -Left $persisted -Right $prior)) {
      throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_PREFLIGHT_PERSISTED'
    }
    return [pscustomobject][ordered]@{ status = 'PENDING_ONLY'; prior = $prior }
  } catch {
    if ($active -ne [IntPtr]::Zero) {
      try { & $CancelAction $active } catch {}
    }
    throw
  }
}

function Invoke-ProductionAllowlistTransactionCore {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][scriptblock]$PreflightAction,
    [Parameter(Mandatory = $true)][scriptblock]$EnsureProxyAction,
    [Parameter(Mandatory = $true)][scriptblock]$ApplyAction,
    [Parameter(Mandatory = $true)][scriptblock]$ProbeAction,
    [Parameter(Mandatory = $true)][scriptblock]$RollbackUiAction,
    [Parameter(Mandatory = $true)][scriptblock]$RollbackProxyAction
  )

  $preflight = $null
  $proxy = $null
  $first = $null
  try {
    $preflight = & $PreflightAction
    $proxy = & $EnsureProxyAction
    $first = & $ApplyAction
    if ([string]$first.status -notin @('APPLIED', 'UNCHANGED')) {
      throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_APPLY_INVALID'
    }
    $second = & $ApplyAction
    if ([string]$second.status -cne 'UNCHANGED') {
      throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_IDEMPOTENCY_INVALID'
    }
    if ((& $ProbeAction) -ne $true) {
      throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_PROBE_FAILED'
    }
    return [pscustomobject][ordered]@{
      preflight_status = [string]$preflight.status
      proxy_created = [bool]$proxy.created
      status = [string]$first.status
      enabled = $true
      non_empty_count = 1
      probe_verified = $true
    }
  } catch {
    $originalFailure = [string]$_.Exception.Message
    try {
      if ($null -ne $first -and [string]$first.status -ceq 'APPLIED') {
        if ((& $RollbackUiAction $preflight.prior) -ne $true) {
          throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_ROLLBACK_FAILED'
        }
      }
      if ($null -ne $proxy -and [bool]$proxy.created) {
        if ((& $RollbackProxyAction) -ne $true) {
          throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_ROLLBACK_FAILED'
        }
      }
    } catch {
      throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_ROLLBACK_FAILED'
    }
    throw $originalFailure
  }
}

function Get-ProductionLoopbackPortProxyState {
  [CmdletBinding()]
  param()
  $savedPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $output = @(& netsh.exe interface portproxy show v4tov4 2>&1)
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $savedPreference
  }
  if ($exitCode -ne 0) {
    throw 'PROVISIONING_WEBREQUEST_PORTPROXY_QUERY_FAILED'
  }
  $entries = @(ConvertFrom-ProductionPortProxyOutput -OutputText ($output -join "`n"))
  $status = Assert-ProductionLoopbackPortProxyState -Entries $entries -AllowEmpty
  return [pscustomobject][ordered]@{ status = $status; entries = $entries }
}

function Get-ProductionPort80Listeners {
  [CmdletBinding()]
  param()
  try {
    $connections = @(Get-NetTCPConnection -State Listen -LocalPort $listenPort -ErrorAction Stop)
  } catch [Microsoft.PowerShell.Cmdletization.Cim.CimJobException] {
    if ($_.Exception.Message -match 'No matching') { return @() }
    throw 'PROVISIONING_WEBREQUEST_PORT80_QUERY_FAILED'
  } catch {
    throw 'PROVISIONING_WEBREQUEST_PORT80_QUERY_FAILED'
  }
  $listeners = @()
  foreach ($connection in $connections) {
    $process = Get-Process -Id ([int]$connection.OwningProcess) -ErrorAction SilentlyContinue
    $listeners += [pscustomobject][ordered]@{
      local_address = [string]$connection.LocalAddress
      local_port = [int]$connection.LocalPort
      process_name = if ($null -eq $process) { '' } else { [string]$process.ProcessName }
    }
  }
  return @($listeners)
}

function Assert-ProductionIpHelperRunning {
  [CmdletBinding()]
  param()
  try {
    $service = Get-Service -Name 'iphlpsvc' -ErrorAction Stop
  } catch {
    throw 'PROVISIONING_WEBREQUEST_IPHELPER_INVALID'
  }
  if ($service.Status -ne [ServiceProcess.ServiceControllerStatus]::Running) {
    throw 'PROVISIONING_WEBREQUEST_IPHELPER_INVALID'
  }
}

function Invoke-ProductionNetshAddBoundary {
  [CmdletBinding()]
  param()
  & netsh.exe interface portproxy add v4tov4 `
    'listenaddress=127.0.0.1' 'listenport=80' `
    'connectaddress=127.0.0.1' 'connectport=8790' | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw 'PROVISIONING_WEBREQUEST_PORTPROXY_ADD_FAILED'
  }
}

function Invoke-ProductionNetshDeleteBoundary {
  [CmdletBinding()]
  param()
  & netsh.exe interface portproxy delete v4tov4 `
    'listenaddress=127.0.0.1' 'listenport=80' | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw 'PROVISIONING_WEBREQUEST_PORTPROXY_DELETE_FAILED'
  }
}

function Wait-ProductionPort80ListenerState {
  [CmdletBinding()]
  param([Parameter(Mandatory = $true)][bool]$ExpectPresent)
  for ($attempt = 0; $attempt -lt 50; $attempt++) {
    $listeners = @(Get-ProductionPort80Listeners)
    try {
      $null = Assert-ProductionPort80ListenerState `
        -Listeners $listeners -ExpectPresent $ExpectPresent
      return
    } catch {
      if ($attempt -eq 49) { throw }
    }
    Start-Sleep -Milliseconds 100
  }
}

function Ensure-ProductionLoopbackPortProxy {
  [CmdletBinding()]
  param()
  Assert-ProductionIpHelperRunning
  $initial = Get-ProductionLoopbackPortProxyState
  if ([string]$initial.status -ceq 'EXACT') {
    Wait-ProductionPort80ListenerState -ExpectPresent $true
    return [pscustomobject][ordered]@{ created = $false; status = 'EXISTING' }
  }
  $listeners = @(Get-ProductionPort80Listeners)
  $null = Assert-ProductionPort80ListenerState -Listeners $listeners -ExpectPresent $false
  Invoke-ProductionNetshAddBoundary
  try {
    $after = Get-ProductionLoopbackPortProxyState
    if ([string]$after.status -cne 'EXACT') {
      throw 'PROVISIONING_WEBREQUEST_PORTPROXY_STATE_INVALID'
    }
    Wait-ProductionPort80ListenerState -ExpectPresent $true
    return [pscustomobject][ordered]@{ created = $true; status = 'CREATED' }
  } catch {
    try {
      Invoke-ProductionNetshDeleteBoundary
      $restored = Get-ProductionLoopbackPortProxyState
      if ([string]$restored.status -cne 'EMPTY') {
        throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_ROLLBACK_FAILED'
      }
      Wait-ProductionPort80ListenerState -ExpectPresent $false
    } catch {
      throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_ROLLBACK_FAILED'
    }
    throw
  }
}

function Remove-ProductionOwnedLoopbackPortProxy {
  [CmdletBinding()]
  param()
  $before = Get-ProductionLoopbackPortProxyState
  if ([string]$before.status -cne 'EXACT') {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_ROLLBACK_FAILED'
  }
  try {
    Invoke-ProductionNetshDeleteBoundary
    $after = Get-ProductionLoopbackPortProxyState
    if ([string]$after.status -cne 'EMPTY') {
      throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_ROLLBACK_FAILED'
    }
    Wait-ProductionPort80ListenerState -ExpectPresent $false
  } catch {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_ROLLBACK_FAILED'
  }
  return $true
}

function Assert-ProductionForwardedGatewayHealth {
  [CmdletBinding()]
  param()
  if (-not (Test-Path -LiteralPath $gatewayBinary -PathType Leaf)) {
    throw 'PROVISIONING_GATEWAY_BINARY_MISSING'
  }
  $direct = @(
    Get-NetTCPConnection -State Listen -LocalPort $connectPort -ErrorAction Stop |
      Where-Object { [string]$_.LocalAddress -ceq $connectAddress }
  )
  if ($direct.Count -ne 1) {
    throw 'PROVISIONING_GATEWAY_LISTENER_MISMATCH'
  }
  $owner = Get-Process -Id ([int]$direct[0].OwningProcess) -ErrorAction Stop
  if (-not [string]::Equals(
      [IO.Path]::GetFullPath([string]$owner.Path),
      [IO.Path]::GetFullPath($gatewayBinary),
      [StringComparison]::OrdinalIgnoreCase
    )) {
    throw 'PROVISIONING_GATEWAY_LISTENER_MISMATCH'
  }
  try {
    $response = Invoke-RestMethod -Uri 'http://127.0.0.1/health' -TimeoutSec 5
  } catch {
    throw 'PROVISIONING_WEBREQUEST_PORTPROXY_HEALTH_FAILED'
  }
  if ($response.ok -isnot [bool] -or -not [bool]$response.ok -or
      [string]$response.service -cne 'execution-gateway' -or
      [int]$response.protocolVersion -ne 1) {
    throw 'PROVISIONING_WEBREQUEST_PORTPROXY_HEALTH_FAILED'
  }
  return $true
}

function Invoke-ProductionAllowlistProbe {
  [CmdletBinding()]
  param()
  $savedPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $output = @(
      & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass `
        -File $probeDriver 2>&1
    )
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $savedPreference
  }
  if ($exitCode -ne 0 -or
      @($output | Where-Object {
          [string]$_ -match '^PRODUCTION_WEBREQUEST_PROBE=PASS proof=.+$'
        }).Count -ne 1) {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_PROBE_FAILED'
  }
  return $true
}

function Assert-ContractFailure {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][scriptblock]$Action,
    [Parameter(Mandatory = $true)][string]$ExpectedCode
  )
  try {
    & $Action
  } catch {
    if ([string]$_.Exception.Message -ceq $ExpectedCode) { return }
    throw
  }
  throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_CONTRACT_FAILED_OPEN'
}

function Invoke-ProductionAllowlistContractTests {
  [CmdletBinding()]
  param()

  $empty = @(ConvertFrom-ProductionPortProxyOutput -OutputText '')
  Assert-ProductionAllowlistTrue (
    (Assert-ProductionLoopbackPortProxyState -Entries $empty -AllowEmpty) -ceq 'EMPTY'
  ) 'PROVISIONING_WEBREQUEST_ALLOWLIST_CONTRACT_FAILED'
  $exactText = @'
Listen on ipv4:             Connect to ipv4:

Address         Port        Address         Port
--------------- ----------  --------------- ----------
127.0.0.1       80          127.0.0.1       8790
'@
  $exact = @(ConvertFrom-ProductionPortProxyOutput -OutputText $exactText)
  Assert-ProductionAllowlistTrue (
    (Assert-ProductionLoopbackPortProxyState -Entries $exact) -ceq 'EXACT'
  ) 'PROVISIONING_WEBREQUEST_ALLOWLIST_CONTRACT_FAILED'
  foreach ($invalidText in @(
      '0.0.0.0 80 127.0.0.1 8790',
      '127.0.0.1 80 127.0.0.1 8791',
      "127.0.0.1 80 127.0.0.1 8790`n127.0.0.1 80 127.0.0.1 8790"
    )) {
    Assert-ContractFailure -ExpectedCode 'PROVISIONING_WEBREQUEST_PORTPROXY_STATE_INVALID' -Action {
      $entries = @(ConvertFrom-ProductionPortProxyOutput -OutputText $invalidText)
      Assert-ProductionLoopbackPortProxyState -Entries $entries
    }
  }
  Assert-ContractFailure -ExpectedCode 'PROVISIONING_WEBREQUEST_PORTPROXY_OUTPUT_INVALID' -Action {
    ConvertFrom-ProductionPortProxyOutput -OutputText '::1 80 127.0.0.1 8790'
  }
  $null = Assert-ProductionPort80ListenerState -Listeners @() -ExpectPresent $false
  $null = Assert-ProductionPort80ListenerState -Listeners @(
    [pscustomobject]@{
      local_address = '127.0.0.1'
      local_port = 80
      process_name = 'System'
    }
  ) -ExpectPresent $true
  Write-Output 'PRODUCTION_WEBREQUEST_ALLOWLIST_PORTPROXY_CONTRACTS=PASS'

  $script:contractPersisted = [pscustomobject][ordered]@{ Enabled = 0; Items = @('') }
  $script:contractPending = $null
  $script:contractEvents = [Collections.Generic.List[string]]::new()
  $preflight = Invoke-ProductionPendingOnlyPreflight -ProcessId 701 -ExpectedOrigin $expectedOrigin -OpenAction {
    param($processId)
    $script:contractEvents.Add('open')
    return [IntPtr]101
  } -ReadAction {
    param($handle)
    $script:contractEvents.Add('read')
    if ($null -ne $script:contractPending) { return $script:contractPending }
    return $script:contractPersisted
  } -WriteAction {
    param($handle, $state)
    $script:contractEvents.Add('write')
    $script:contractPending = $state
  } -CancelAction {
    param($handle)
    $script:contractEvents.Add('cancel')
    $script:contractPending = $null
  }
  Assert-ProductionAllowlistTrue (
    [string]$preflight.status -ceq 'PENDING_ONLY' -and
    ($script:contractEvents -join ',') -ceq
      'open,read,write,read,cancel,open,read,cancel' -and
    (Test-ProductionPriorWebRequestState -State $script:contractPersisted)
  ) 'PROVISIONING_WEBREQUEST_ALLOWLIST_CONTRACT_FAILED'
  Write-Output 'PRODUCTION_WEBREQUEST_ALLOWLIST_PREFLIGHT_CONTRACTS=PASS'

  $script:contractEvents = [Collections.Generic.List[string]]::new()
  $script:applyCount = 0
  $success = Invoke-ProductionAllowlistTransactionCore -PreflightAction {
    $script:contractEvents.Add('preflight')
    return [pscustomobject]@{
      status = 'PENDING_ONLY'
      prior = [pscustomobject]@{ Enabled = 0; Items = @('') }
    }
  } -EnsureProxyAction {
    $script:contractEvents.Add('proxy')
    return [pscustomobject]@{ created = $true }
  } -ApplyAction {
    $script:applyCount += 1
    $script:contractEvents.Add('apply')
    return [pscustomobject]@{
      status = if ($script:applyCount -eq 1) { 'APPLIED' } else { 'UNCHANGED' }
    }
  } -ProbeAction {
    $script:contractEvents.Add('probe')
    return $true
  } -RollbackUiAction {
    $script:contractEvents.Add('rollback-ui')
    return $true
  } -RollbackProxyAction {
    $script:contractEvents.Add('rollback-proxy')
    return $true
  }
  Assert-ProductionAllowlistTrue (
    [string]$success.status -ceq 'APPLIED' -and
    ($script:contractEvents -join ',') -ceq
      'preflight,proxy,apply,apply,probe'
  ) 'PROVISIONING_WEBREQUEST_ALLOWLIST_CONTRACT_FAILED'

  $script:contractEvents = [Collections.Generic.List[string]]::new()
  $script:applyCount = 0
  Assert-ContractFailure -ExpectedCode 'PROVISIONING_WEBREQUEST_ALLOWLIST_PROBE_FAILED' -Action {
    Invoke-ProductionAllowlistTransactionCore -PreflightAction {
      $script:contractEvents.Add('preflight')
      return [pscustomobject]@{
        status = 'PENDING_ONLY'
        prior = [pscustomobject]@{ Enabled = 0; Items = @('') }
      }
    } -EnsureProxyAction {
      $script:contractEvents.Add('proxy')
      return [pscustomobject]@{ created = $true }
    } -ApplyAction {
      $script:applyCount += 1
      $script:contractEvents.Add('apply')
      return [pscustomobject]@{
        status = if ($script:applyCount -eq 1) { 'APPLIED' } else { 'UNCHANGED' }
      }
    } -ProbeAction {
      $script:contractEvents.Add('probe')
      throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_PROBE_FAILED'
    } -RollbackUiAction {
      param($prior)
      $script:contractEvents.Add('rollback-ui')
      return (Test-ProductionPriorWebRequestState -State $prior)
    } -RollbackProxyAction {
      $script:contractEvents.Add('rollback-proxy')
      return $true
    }
  }
  Assert-ProductionAllowlistTrue (
    ($script:contractEvents -join ',') -ceq
      'preflight,proxy,apply,apply,probe,rollback-ui,rollback-proxy'
  ) 'PROVISIONING_WEBREQUEST_ALLOWLIST_CONTRACT_FAILED'

  $script:contractEvents = [Collections.Generic.List[string]]::new()
  $script:applyCount = 0
  Assert-ContractFailure -ExpectedCode 'PROVISIONING_WEBREQUEST_ALLOWLIST_PROBE_FAILED' -Action {
    Invoke-ProductionAllowlistTransactionCore -PreflightAction {
      $script:contractEvents.Add('preflight')
      return [pscustomobject]@{
        status = 'PENDING_ONLY'
        prior = [pscustomobject]@{ Enabled = 0; Items = @('') }
      }
    } -EnsureProxyAction {
      $script:contractEvents.Add('proxy-existing')
      return [pscustomobject]@{ created = $false }
    } -ApplyAction {
      $script:applyCount += 1
      $script:contractEvents.Add('apply')
      return [pscustomobject]@{
        status = if ($script:applyCount -eq 1) { 'APPLIED' } else { 'UNCHANGED' }
      }
    } -ProbeAction {
      $script:contractEvents.Add('probe')
      throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_PROBE_FAILED'
    } -RollbackUiAction {
      param($prior)
      $script:contractEvents.Add('rollback-ui')
      return (Test-ProductionPriorWebRequestState -State $prior)
    } -RollbackProxyAction {
      $script:contractEvents.Add('rollback-proxy')
      return $true
    }
  }
  Assert-ProductionAllowlistTrue (
    ($script:contractEvents -join ',') -ceq
      'preflight,proxy-existing,apply,apply,probe,rollback-ui'
  ) 'PROVISIONING_WEBREQUEST_ALLOWLIST_CONTRACT_FAILED'

  $script:contractEvents = [Collections.Generic.List[string]]::new()
  Assert-ContractFailure -ExpectedCode 'PROVISIONING_WEBREQUEST_ALLOWLIST_PENDING_FAILED' -Action {
    Invoke-ProductionAllowlistTransactionCore -PreflightAction {
      $script:contractEvents.Add('preflight')
      throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_PENDING_FAILED'
    } -EnsureProxyAction {
      $script:contractEvents.Add('proxy')
      return [pscustomobject]@{ created = $true }
    } -ApplyAction {
      $script:contractEvents.Add('apply')
    } -ProbeAction {
      $script:contractEvents.Add('probe')
    } -RollbackUiAction {
      $script:contractEvents.Add('rollback-ui')
    } -RollbackProxyAction {
      $script:contractEvents.Add('rollback-proxy')
    }
  }
  Assert-ProductionAllowlistTrue (
    ($script:contractEvents -join ',') -ceq 'preflight'
  ) 'PROVISIONING_WEBREQUEST_ALLOWLIST_CONTRACT_FAILED'

  $script:applyCount = 0
  Assert-ContractFailure -ExpectedCode 'PROVISIONING_WEBREQUEST_ALLOWLIST_ROLLBACK_FAILED' -Action {
    Invoke-ProductionAllowlistTransactionCore -PreflightAction {
      return [pscustomobject]@{
        status = 'PENDING_ONLY'
        prior = [pscustomobject]@{ Enabled = 0; Items = @('') }
      }
    } -EnsureProxyAction {
      return [pscustomobject]@{ created = $true }
    } -ApplyAction {
      $script:applyCount += 1
      return [pscustomobject]@{
        status = if ($script:applyCount -eq 1) { 'APPLIED' } else { 'UNCHANGED' }
      }
    } -ProbeAction {
      throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_PROBE_FAILED'
    } -RollbackUiAction {
      return $false
    } -RollbackProxyAction {
      return $true
    }
  }
  Write-Output 'PRODUCTION_WEBREQUEST_ALLOWLIST_ROLLBACK_CONTRACTS=PASS'
  Write-Output 'PRODUCTION_WEBREQUEST_ALLOWLIST_CONTRACTS=PASS'
}

if (-not (Test-Path -LiteralPath $uiHelper -PathType Leaf)) {
  throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_HELPER_MISSING'
}
. $uiHelper

if ($ContractTestsOnly) {
  if ($KnownBadControl) {
    $bad = @(ConvertFrom-ProductionPortProxyOutput -OutputText '0.0.0.0 80 127.0.0.1 8790')
    Assert-ProductionLoopbackPortProxyState -Entries $bad
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_KNOWN_BAD_FAILED_OPEN'
  }
  if ($UnreadableInputControl) {
    ConvertFrom-ProductionPortProxyOutput -OutputText '127.0.0.1 eighty 127.0.0.1 8790'
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_UNREADABLE_CONTROL_FAILED_OPEN'
  }
  if ($OccupiedPortControl) {
    Assert-ProductionPort80ListenerState -Listeners @(
      [pscustomobject]@{
        local_address = '127.0.0.1'
        local_port = 80
        process_name = 'Unexpected'
      }
    ) -ExpectPresent $false
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_OCCUPIED_CONTROL_FAILED_OPEN'
  }
  Invoke-ProductionAllowlistContractTests
  exit 0
}

$target = $null
try {
  Assert-ProductionSelectedTerminalProfile
  $target = Resolve-MT5VmTerminalProcess -TerminalPath $selectedTerminal
  $processId = [int]$target.ProcessId
  $preflightAction = {
    Invoke-ProductionPendingOnlyPreflight -ProcessId $processId `
      -ExpectedOrigin $expectedOrigin -OpenAction {
        param($id)
        return Open-MT5VmOptionsDialogBoundary -ProcessId $id
      } -ReadAction {
        param($handle)
        return Read-MT5VmWebRequestStateBoundary -OptionsHandle $handle
      } -WriteAction {
        param($handle, $state)
        Write-MT5VmWebRequestStateBoundary -OptionsHandle $handle -State $state
      } -CancelAction {
        param($handle)
        Cancel-MT5VmOptionsDialogBoundary -OptionsHandle $handle
      }
  }
  $ensureProxyAction = {
    $proxy = Ensure-ProductionLoopbackPortProxy
    $null = Assert-ProductionForwardedGatewayHealth
    return $proxy
  }
  $applyAction = {
    return Set-MT5VmTerminalWebRequestAllowlist `
      -ProcessId $processId -Origin $expectedOrigin
  }
  $probeAction = {
    return [bool](Invoke-ProductionAllowlistProbe)
  }
  $rollbackUiAction = {
    param($prior)
    $rollbackTarget = $null
    try {
      $rollbackTarget = Resolve-MT5VmTerminalProcess -TerminalPath $selectedTerminal
      Restore-MT5VmTerminalWebRequestState `
        -ProcessId ([int]$rollbackTarget.ProcessId) -State $prior
      return $true
    } finally {
      if ($null -ne $rollbackTarget -and [bool]$rollbackTarget.WasStarted) {
        Close-MT5VmOwnedTerminalBoundary -ProcessId ([int]$rollbackTarget.ProcessId)
      }
    }
  }
  $rollbackProxyAction = {
    return [bool](Remove-ProductionOwnedLoopbackPortProxy)
  }
  $result = Invoke-ProductionAllowlistTransactionCore `
    -PreflightAction $preflightAction `
    -EnsureProxyAction $ensureProxyAction `
    -ApplyAction $applyAction `
    -ProbeAction $probeAction `
    -RollbackUiAction $rollbackUiAction `
    -RollbackProxyAction $rollbackProxyAction
  Write-Output (
    'PRODUCTION_WEBREQUEST_ALLOWLIST=PASS preflight={0} proxy_created={1} status={2} enabled={3} non_empty_count={4} probe_verified={5}' -f
      [string]$result.preflight_status,
      [bool]$result.proxy_created,
      [string]$result.status,
      [bool]$result.enabled,
      [int]$result.non_empty_count,
      [bool]$result.probe_verified
  )
} finally {
  if ($null -ne $target -and [bool]$target.WasStarted) {
    Close-MT5VmOwnedTerminalBoundary -ProcessId ([int]$target.ProcessId)
  }
}
