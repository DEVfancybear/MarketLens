[CmdletBinding()]
param(
  [switch]$ContractTestsOnly,
  [switch]$CodeTestsOnly,
  [switch]$ConfigureNativeAllowlist,
  [switch]$KnownBadControl,
  [switch]$AllowlistMutationTestsOnly,
  [switch]$ProbeMutationTestsOnly,
  [switch]$MouseMutationTestsOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$backendRoot = Join-Path $repoRoot 'backend'
$frontendRoot = Join-Path $repoRoot 'frontend'
$executionRoot = Join-Path $backendRoot 'execution'
$reportRoot = Join-Path $repoRoot ('.artifacts\production-worker-host-provision\v40\host-' + [guid]::NewGuid().ToString('N'))
$reportPath = Join-Path $reportRoot 'gauntlet-report.json'
$probeDriver = Join-Path $repoRoot 'tools\mt5-baremetal\Invoke-MT5WebRequestProbe.ps1'
$allowlistDriver = Join-Path $repoRoot 'tools\mt5-baremetal\Set-MT5WebRequestAllowlist.ps1'
$uiHelper = Join-Path $repoRoot 'backend\bridge\mt5_vm\Mt5VmTerminalUi.ps1'
$backendEnvPath = Join-Path $backendRoot '.env'
$installInputPath = 'C:\ProgramData\MarketLens\managed-worker-install-input.json'
$bootstrapTokenPath = 'C:\ProgramData\MarketLens\secrets\worker-bootstrap.token'
$workerRoot = 'C:\MarketLens\worker'
$workerDataRoot = 'C:\MarketLens\runtime'
$selectedIdentity = 'DESKTOP-MDC339G\Duong'
$selectedTerminal = 'C:\Program Files\MetaTrader 5\terminal64.exe'
$selectedStateRoot = 'C:\Users\Duong\AppData\Roaming\MetaQuotes\Terminal\D0E8209F77C8CF37AD8BF550E51FF075'
$slotInputRoot = 'C:\ProgramData\MarketLens\slot-inputs\slot-01'
$expectedOrigin = 'http://127.0.0.1'
$taskName = 'MarketLens MT5 Worker'
$workerId = 'marketlens-baremetal-01'
$baselineCommit = '299eef3e5897c1bc723c1afeb05dff0feac1aafb'
$script:layerResults = [Collections.Generic.List[object]]::new()

$expectedLayers = @(
  'tool-contracts',
  'go-quality',
  'go-migration-gate-coverage',
  'python-managed-suites',
  'rust-quality',
  'frontend-quality',
  'backend-docs',
  'managed-worker-contracts',
  'postgresql-preflight',
  'live-webrequest-and-host-inputs',
  'source-diff-secret-audit',
  'canonical-production-runner',
  'production-postconditions'
)

function Assert-Gate {
  param(
    [Parameter(Mandatory = $true)][bool]$Condition,
    [Parameter(Mandatory = $true)][string]$Code
  )
  if (-not $Condition) { throw $Code }
}

function Write-GauntletReport {
  param([Parameter(Mandatory = $true)][string]$Status)
  if ($Status -ceq 'PASS') {
    Assert-Gate ($script:layerResults.Count -eq $expectedLayers.Count) 'PROVISIONING_LAYER_MANIFEST_INCOMPLETE'
    for ($i = 0; $i -lt $expectedLayers.Count; $i++) {
      Assert-Gate ($script:layerResults[$i].name -ceq $expectedLayers[$i] -and
        $script:layerResults[$i].status -ceq 'PASS') 'PROVISIONING_LAYER_MANIFEST_ORDER_INVALID'
    }
  }
  $null = [IO.Directory]::CreateDirectory($reportRoot)
  $payload = [ordered]@{
    schema_version = 1
    gate = 'production-worker-host-provision'
    status = $Status
    expected_layers = $expectedLayers
    observed_layers = @($script:layerResults)
    completed_at_utc = [DateTime]::UtcNow.ToString('o')
    source_commit = [string](@(& git -C $repoRoot rev-parse HEAD) -join '')
    attempt_path = $reportPath
  }
  [IO.File]::WriteAllText(
    $reportPath,
    ($payload | ConvertTo-Json -Depth 8 -Compress),
    (New-Object Text.UTF8Encoding($false))
  )
}

function Invoke-GauntletLayer {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][scriptblock]$Action
  )
  Assert-Gate ($expectedLayers -ccontains $Name) 'PROVISIONING_UNEXPECTED_LAYER'
  Assert-Gate (@($script:layerResults | Where-Object { $_.name -ceq $Name }).Count -eq 0) `
    'PROVISIONING_DUPLICATE_LAYER'
  Write-Host "`n[$Name]" -ForegroundColor Cyan
  try {
    & $Action
    $script:layerResults.Add([pscustomobject][ordered]@{ name = $Name; status = 'PASS' })
  } catch {
    $code = [string]$_.Exception.Message
    if ($code -notmatch '^[A-Z][A-Z0-9_.:-]+$') { $code = 'PROVISIONING_LAYER_FAILED' }
    $script:layerResults.Add([pscustomobject][ordered]@{ name = $Name; status = 'FAIL'; code = $code })
    Write-GauntletReport -Status 'FAIL'
    throw $code
  }
}

function Assert-NativeSuccess {
  param([Parameter(Mandatory = $true)][string]$Code)
  Assert-Gate ($LASTEXITCODE -eq 0) $Code
}

function Assert-PowerShellKnownBad {
  param(
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [Parameter(Mandatory = $true)][string]$ExpectedCode,
    [Parameter(Mandatory = $true)][string]$FailedOpenCode,
    [Parameter(Mandatory = $true)][string]$WrongReasonCode
  )
  $savedErrorActionPreference = $ErrorActionPreference
  $exitCode = 0
  try {
    $ErrorActionPreference = 'Continue'
    $output = @(& powershell.exe @Arguments 2>&1)
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $savedErrorActionPreference
  }
  Assert-Gate ($exitCode -ne 0) $FailedOpenCode
  Assert-Gate (($output -join "`n").Contains($ExpectedCode)) $WrongReasonCode
}

function Invoke-InDirectory {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][scriptblock]$Action
  )
  Push-Location $Path
  try { & $Action } finally { Pop-Location }
}

function Assert-PowerShellParses {
  param([Parameter(Mandatory = $true)][string]$Path)
  $tokens = $null
  $errors = $null
  $null = [Management.Automation.Language.Parser]::ParseFile($Path, [ref]$tokens, [ref]$errors)
  Assert-Gate ($errors.Count -eq 0) 'PROVISIONING_POWERSHELL_PARSE_FAILED'
}

function Assert-SelectedTerminalBoundary {
  param([Parameter(Mandatory = $true)][string]$Path)
  $full = [IO.Path]::GetFullPath($Path)
  Assert-Gate (
    [string]::Equals($full, $selectedTerminal, [StringComparison]::OrdinalIgnoreCase)
  ) 'PROVISIONING_SELECTED_TERMINAL_INVALID'
}

function Invoke-ContractTests {
  Assert-Gate ($expectedLayers.Count -eq 13) 'PROVISIONING_LAYER_MANIFEST_INVALID'
  Assert-SelectedTerminalBoundary -Path $selectedTerminal
  Assert-PowerShellParses -Path $PSCommandPath
  Assert-PowerShellParses -Path $probeDriver
  Assert-PowerShellParses -Path $allowlistDriver
  if ($KnownBadControl) {
    Assert-SelectedTerminalBoundary -Path 'C:\Program Files\FTMO Global Markets MT5 Terminal\terminal64.exe'
    throw 'PROVISIONING_KNOWN_BAD_CONTROL_FAILED_OPEN'
  }
  Write-Output 'PRODUCTION_WORKER_HOST_PROVISION_CONTRACTS=PASS'
}

function Invoke-AllowlistMutationTests {
  $originalBytes = [IO.File]::ReadAllBytes($allowlistDriver)
  $originalHash = (Get-FileHash -LiteralPath $allowlistDriver -Algorithm SHA256).Hash
  $originalText = ([Text.Encoding]::UTF8.GetString($originalBytes)).Replace("`r`n", "`n")
  $mutants = @(
    [pscustomobject]@{
      name = 'accept-duplicate-key'
      search = @'
if ($webMatches.Count -ne 1 -or $urlMatches.Count -ne 1 -or
      $allWebMatches.Count -ne 1 -or $allUrlMatches.Count -ne 1) {
'@
      replace = @'
if ($webMatches.Count -lt 1 -or $urlMatches.Count -lt 1 -or
      $allWebMatches.Count -lt 1 -or $allUrlMatches.Count -lt 1) {
'@
      expected = 'PROVISIONING_WEBREQUEST_ALLOWLIST_CONTRACT_FAILED_OPEN'
    },
    [pscustomobject]@{
      name = 'change-unrelated-bytes'
      search = '$desiredText = Set-ProductionCommonIniValueSpans -Model $model -WebValue ''1'' -UrlValue $ExpectedOrigin'
      replace = '$desiredText = (Set-ProductionCommonIniValueSpans -Model $model -WebValue ''1'' -UrlValue $ExpectedOrigin).Replace(''Untouched=tail'', ''Untouched=mutant'')'
      expected = 'PROVISIONING_WEBREQUEST_ALLOWLIST_UNRELATED_BYTES_CHANGED'
    },
    [pscustomobject]@{
      name = 'accept-idempotency-hash-change'
      search = 'DesiredHash = $sameHash'
      replace = 'DesiredHash = ''PROVISIONING_IDEMPOTENCY_MUTANT'''
      expected = 'PROVISIONING_WEBREQUEST_ALLOWLIST_IDEMPOTENCY_INVALID'
    },
    [pscustomobject]@{
      name = 'report-original-after-rollback-failure'
      search = 'if ($rollbackResult -ne $true) {'
      replace = 'if ($false) {'
      expected = 'PROVISIONING_WEBREQUEST_ALLOWLIST_PROBE_FAILED'
    },
    [pscustomobject]@{
      name = 'permit-wildcard-listen-address'
      search = '[string]$entry.listen_address -cne $listenAddress -or'
      replace = '$false -or'
      expected = 'PROVISIONING_WEBREQUEST_ALLOWLIST_CONTRACT_FAILED_OPEN'
    },
    [pscustomobject]@{
      name = 'accept-wrong-connect-port'
      search = '[int]$entry.connect_port -ne $connectPort) {'
      replace = '$false) {'
      expected = 'PROVISIONING_WEBREQUEST_ALLOWLIST_CONTRACT_FAILED_OPEN'
    },
    [pscustomobject]@{
      name = 'create-proxy-before-persisted-preflight'
      search = @'
$preflight = & $PreflightAction
    $proxy = & $EnsureProxyAction
'@
      replace = @'
$proxy = & $EnsureProxyAction
    $preflight = & $PreflightAction
'@
      expected = 'PROVISIONING_WEBREQUEST_ALLOWLIST_CONTRACT_FAILED'
    },
    [pscustomobject]@{
      name = 'delete-preexisting-mapping-during-rollback'
      search = 'if ($null -ne $proxy -and [bool]$proxy.created) {'
      replace = 'if ($null -ne $proxy) {'
      expected = 'PROVISIONING_WEBREQUEST_ALLOWLIST_CONTRACT_FAILED'
    },
    [pscustomobject]@{
      name = 'skip-successful-trace-rollback'
      search = @'
  if ((& $RollbackUiAction $preflight.prior) -ne $true) {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_ROLLBACK_FAILED'
  }
  return [pscustomobject][ordered]@{
'@
      replace = @'
  $null = $preflight.prior
  return [pscustomobject][ordered]@{
'@
      expected = 'PROVISIONING_WEBREQUEST_ALLOWLIST_CONTRACT_FAILED'
    }
  )
  $killed = 0
  try {
    foreach ($mutant in $mutants) {
      foreach ($field in @('search', 'replace', 'search2', 'replace2')) {
        if ($null -ne $mutant.PSObject.Properties[$field]) {
          $mutant.$field = ([string]$mutant.$field).Replace("`r`n", "`n")
        }
      }
      Write-Output ('PRODUCTION_WEBREQUEST_ALLOWLIST_MUTANT_START=' + [string]$mutant.name)
      $matchCount = [regex]::Matches(
        $originalText,
        [regex]::Escape([string]$mutant.search)
      ).Count
      Assert-Gate ($matchCount -eq 1) 'PROVISIONING_ALLOWLIST_MUTANT_SOURCE_UNEXPECTED'
      $mutantText = $originalText.Replace(
        [string]$mutant.search,
        [string]$mutant.replace
      )
      [IO.File]::WriteAllText(
        $allowlistDriver,
        $mutantText,
        (New-Object Text.UTF8Encoding($false))
      )
      $mutantHash = (Get-FileHash -LiteralPath $allowlistDriver -Algorithm SHA256).Hash
      Assert-Gate ($mutantHash -cne $originalHash) 'PROVISIONING_ALLOWLIST_MUTANT_NOT_APPLIED'
      $savedErrorActionPreference = $ErrorActionPreference
      try {
        $ErrorActionPreference = 'Continue'
        $mutantOutput = @(& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $allowlistDriver -ContractTestsOnly 2>&1)
        $mutantExitCode = $LASTEXITCODE
      } finally {
        $ErrorActionPreference = $savedErrorActionPreference
      }
      Assert-Gate ($mutantExitCode -ne 0) 'PROVISIONING_ALLOWLIST_MUTANT_SURVIVED'
      Assert-Gate (
        ($mutantOutput -join "`n").Contains([string]$mutant.expected)
      ) 'PROVISIONING_ALLOWLIST_MUTANT_WRONG_REASON'
      $killed += 1
      [IO.File]::WriteAllBytes($allowlistDriver, $originalBytes)
      Assert-Gate (
        (Get-FileHash -LiteralPath $allowlistDriver -Algorithm SHA256).Hash -ceq
          $originalHash
      ) 'PROVISIONING_ALLOWLIST_MUTANT_RESTORE_FAILED'
    }
  } finally {
    [IO.File]::WriteAllBytes($allowlistDriver, $originalBytes)
  }
  Assert-Gate ($killed -eq $mutants.Count) 'PROVISIONING_ALLOWLIST_MUTATION_SCORE_INVALID'
  Assert-Gate (
    (Get-FileHash -LiteralPath $allowlistDriver -Algorithm SHA256).Hash -ceq
      $originalHash
  ) 'PROVISIONING_ALLOWLIST_MUTANT_RESTORE_FAILED'
  & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $allowlistDriver -ContractTestsOnly
  Assert-NativeSuccess 'PROVISIONING_ALLOWLIST_MUTATION_RESTORED_TEST_FAILED'
  Assert-Gate ($mutants.Count -eq 9) 'PROVISIONING_ALLOWLIST_MUTATION_MANIFEST_INVALID'
  Write-Output 'PRODUCTION_WEBREQUEST_ALLOWLIST_MUTATION=9/9'
}

function Invoke-ProbeMutationTests {
  $originalBytes = [IO.File]::ReadAllBytes($probeDriver)
  $originalHash = (Get-FileHash -LiteralPath $probeDriver -Algorithm SHA256).Hash
  $originalText = ([Text.Encoding]::UTF8.GetString($originalBytes)).Replace("`r`n", "`n")
  $mutants = @(
    [pscustomobject]@{
      name = 'omit-full-desired-profile-prefix'
      search = '$desiredBytes = New-ProbeUtf16LeBomBytes -Text ($text + $startupText)'
      replace = '$desiredBytes = New-ProbeUtf16LeBomBytes -Text $startupText'
      expected = 'PROVISIONING_PROBE_STARTUP_TRANSFORM_INVALID'
    },
    [pscustomobject]@{
      name = 'launch-probe-without-exact-custom-config'
      search = '$probeConfigArgument = ''/config:'' + $probeConfigPath'
      replace = '$probeConfigArgument = $probeConfigPath'
      expected = 'PROVISIONING_PROBE_CUSTOM_CONFIG_LAUNCH_INVALID'
    },
    [pscustomobject]@{
      name = 'skip-owned-custom-config-cleanup'
      search = @'
    & $QuiesceAction
    Remove-ProbeOwnedCustomConfig -Snapshot $snapshot
    return $result
'@
      replace = @'
    & $QuiesceAction
    return $result
'@
      expected = 'PROVISIONING_PROBE_DEFAULT_CONFIG_CONTRACT_FAILED'
    }
  )
  $killed = 0
  try {
    foreach ($mutant in $mutants) {
      foreach ($field in @('search', 'replace', 'search2', 'replace2')) {
        if ($null -ne $mutant.PSObject.Properties[$field]) {
          $mutant.$field = ([string]$mutant.$field).Replace("`r`n", "`n")
        }
      }
      Write-Output ('PRODUCTION_WEBREQUEST_PROBE_MUTANT_START=' + [string]$mutant.name)
      $matchCount = [regex]::Matches(
        $originalText,
        [regex]::Escape([string]$mutant.search)
      ).Count
      Assert-Gate ($matchCount -eq 1) 'PROVISIONING_PROBE_MUTANT_SOURCE_UNEXPECTED'
      $mutantText = $originalText.Replace(
        [string]$mutant.search,
        [string]$mutant.replace
      )
      [IO.File]::WriteAllText(
        $probeDriver,
        $mutantText,
        (New-Object Text.UTF8Encoding($false))
      )
      $mutantHash = (Get-FileHash -LiteralPath $probeDriver -Algorithm SHA256).Hash
      Assert-Gate ($mutantHash -cne $originalHash) 'PROVISIONING_PROBE_MUTANT_NOT_APPLIED'
      $savedErrorActionPreference = $ErrorActionPreference
      try {
        $ErrorActionPreference = 'Continue'
        $mutantOutput = @(& powershell.exe -NoProfile -NonInteractive `
          -ExecutionPolicy Bypass -File $probeDriver -ContractTestsOnly 2>&1)
        $mutantExitCode = $LASTEXITCODE
      } finally {
        $ErrorActionPreference = $savedErrorActionPreference
      }
      Assert-Gate ($mutantExitCode -ne 0) 'PROVISIONING_PROBE_MUTANT_SURVIVED'
      Assert-Gate (
        ($mutantOutput -join "`n").Contains([string]$mutant.expected)
      ) 'PROVISIONING_PROBE_MUTANT_WRONG_REASON'
      $killed += 1
      [IO.File]::WriteAllBytes($probeDriver, $originalBytes)
      Assert-Gate (
        (Get-FileHash -LiteralPath $probeDriver -Algorithm SHA256).Hash -ceq
          $originalHash
      ) 'PROVISIONING_PROBE_MUTANT_RESTORE_FAILED'
    }
  } finally {
    [IO.File]::WriteAllBytes($probeDriver, $originalBytes)
  }
  Assert-Gate ($killed -eq $mutants.Count) 'PROVISIONING_PROBE_MUTATION_SCORE_INVALID'
  Assert-Gate (
    (Get-FileHash -LiteralPath $probeDriver -Algorithm SHA256).Hash -ceq $originalHash
  ) 'PROVISIONING_PROBE_MUTANT_RESTORE_FAILED'
  & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass `
    -File $probeDriver -ContractTestsOnly
  Assert-NativeSuccess 'PROVISIONING_PROBE_MUTATION_RESTORED_TEST_FAILED'
  Assert-Gate ($mutants.Count -eq 3) 'PROVISIONING_PROBE_MUTATION_MANIFEST_INVALID'
  Write-Output 'PRODUCTION_WEBREQUEST_PROBE_MUTATION=3/3'
}

function Invoke-MouseMutationTests {
  $originalBytes = [IO.File]::ReadAllBytes($uiHelper)
  $originalHash = (Get-FileHash -LiteralPath $uiHelper -Algorithm SHA256).Hash
  $originalText = ([Text.Encoding]::UTF8.GetString($originalBytes)).Replace("`r`n", "`n")
  $mutants = @(
    [pscustomobject]@{
      name = 'drop-post-move-hit-guard'
      search = @'
if ((Invoke-MT5VmNativeMouseInputBoundary -Plan $move) -ne $move.Count) {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_MOUSE_INVALID'
  }
  if (-not (Test-MT5VmPhysicalMouseActivationGuardBoundary `
'@
      replace = @'
if ((Invoke-MT5VmNativeMouseInputBoundary -Plan $move) -ne $move.Count) {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_MOUSE_INVALID'
  }
  if ($false -and -not (Test-MT5VmPhysicalMouseActivationGuardBoundary `
'@
      test = 'backend.bridge.mt5_vm.test_terminal_python_api_bootstrap.TerminalPythonApiBootstrapTests.test_webrequest_physical_mouse_activation_rechecks_guard_and_counts'
    },
    [pscustomobject]@{
      name = 'permit-partial-double-click-count'
      search = 'if ((Invoke-MT5VmNativeMouseInputBoundary -Plan $firstClick) -ne 2) {'
      replace = 'if ((Invoke-MT5VmNativeMouseInputBoundary -Plan $firstClick) -gt 2) {'
      test = 'backend.bridge.mt5_vm.test_terminal_python_api_bootstrap.TerminalPythonApiBootstrapTests.test_webrequest_physical_mouse_activation_rechecks_guard_and_counts'
    },
    [pscustomobject]@{
      name = 'combine-click-batches'
      search = @'
$firstClick = @($clicks[0], $clicks[1])
  if ((Invoke-MT5VmNativeMouseInputBoundary -Plan $firstClick) -ne 2) {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_MOUSE_INVALID'
  }
  Start-Sleep -Milliseconds 150
  if (-not (Test-MT5VmPhysicalMouseActivationGuardBoundary `
      -OptionsHandle $OptionsHandle -ListHandle $ListHandle `
      -CheckboxHandle $CheckboxHandle -ProcessId $ProcessId `
      -ScreenX ([int]$point.x) -ScreenY ([int]$point.y)
    )) {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_MOUSE_INVALID'
  }
  $secondClick = @($clicks[2], $clicks[3])
  if ((Invoke-MT5VmNativeMouseInputBoundary -Plan $secondClick) -ne 2) {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_MOUSE_INVALID'
  }
'@
      replace = @'
if ((Invoke-MT5VmNativeMouseInputBoundary -Plan $clicks) -ne 4) {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_MOUSE_INVALID'
  }
'@
      test = 'backend.bridge.mt5_vm.test_terminal_python_api_bootstrap.TerminalPythonApiBootstrapTests.test_webrequest_physical_mouse_activation_rechecks_guard_and_counts'
    },
    [pscustomobject]@{
      name = 'remove-paced-click-delay'
      search = 'Start-Sleep -Milliseconds 150'
      replace = '$null = $true'
      test = 'backend.bridge.mt5_vm.test_terminal_python_api_bootstrap.TerminalPythonApiBootstrapTests.test_webrequest_physical_mouse_activation_rechecks_guard_and_counts'
    },
    [pscustomobject]@{
      name = 'drop-mid-click-guard'
      search = @'
Start-Sleep -Milliseconds 150
  if (-not (Test-MT5VmPhysicalMouseActivationGuardBoundary `
'@
      replace = @'
Start-Sleep -Milliseconds 150
  if ($false -and -not (Test-MT5VmPhysicalMouseActivationGuardBoundary `
'@
      test = 'backend.bridge.mt5_vm.test_terminal_python_api_bootstrap.TerminalPythonApiBootstrapTests.test_webrequest_physical_mouse_activation_rechecks_guard_and_counts'
    },
    [pscustomobject]@{
      name = 'accept-wrong-editor-pid'
      search = '$ExpectedProcessId -lt 1 -or $ObservedProcessId -ne $ExpectedProcessId) {'
      replace = '$ExpectedProcessId -lt 1 -or $false) {'
      test = 'backend.bridge.mt5_vm.test_terminal_python_api_bootstrap.TerminalPythonApiBootstrapTests.test_webrequest_add_editor_identity_is_exact_and_fail_closed'
    },
    [pscustomobject]@{
      name = 'skip-cursor-restoration'
      search = @'
    $result = & $ContinuationAction
  } catch {
    $originalFailure = $_.Exception
  }
  try {
    if ((& $RestoreCursorAction $cursor) -ne $true) {
      throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_CURSOR_RESTORE_FAILED'
    }
'@
      replace = @'
    $result = & $ContinuationAction
  } catch {
    $originalFailure = $_.Exception
  }
  try {
    if ($false) {
      throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_CURSOR_RESTORE_FAILED'
    }
'@
      test = 'backend.bridge.mt5_vm.test_terminal_python_api_bootstrap.TerminalPythonApiBootstrapTests.test_webrequest_physical_mouse_transaction_always_restores_cursor'
    },
    [pscustomobject]@{
      name = 'omit-editor-return-commit'
      search = @'
  $returnPlan = @(New-MT5VmReturnKeyInputPlan)
  $insertedReturn = Invoke-MT5VmNativeKeyboardInputBoundary -Plan $returnPlan
  if ([int]$insertedReturn -ne $returnPlan.Count) {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_EDITOR_INVALID'
  }
'@
      replace = @'
'@
      test = 'backend.bridge.mt5_vm.test_terminal_python_api_bootstrap.TerminalPythonApiBootstrapTests.test_webrequest_virtual_key_stage_commits_once_after_readback'
    },
    [pscustomobject]@{
      name = 'permit-partial-editor-return-count'
      search = 'if ([int]$insertedReturn -ne $returnPlan.Count) {'
      replace = 'if ([int]$insertedReturn -gt $returnPlan.Count) {'
      test = 'backend.bridge.mt5_vm.test_terminal_python_api_bootstrap.TerminalPythonApiBootstrapTests.test_webrequest_virtual_key_stage_fails_before_later_stages'
    },
    [pscustomobject]@{
      name = 'send-editor-return-after-physical-ok'
      search = @'
  $returnPlan = @(New-MT5VmReturnKeyInputPlan)
  $insertedReturn = Invoke-MT5VmNativeKeyboardInputBoundary -Plan $returnPlan
  if ([int]$insertedReturn -ne $returnPlan.Count) {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_EDITOR_INVALID'
  }
'@
      replace = @'
'@
      search2 = @'
    Confirm-MT5VmOptionsDialogWithActiveEditorBoundary `
      -OptionsHandle $activeDialog `
      -EditorHandle $activeEditor `
      -ProcessId $ProcessId
    $activeDialog = [IntPtr]::Zero
'@
      replace2 = @'
    Confirm-MT5VmOptionsDialogWithActiveEditorBoundary `
      -OptionsHandle $activeDialog `
      -EditorHandle $activeEditor `
      -ProcessId $ProcessId
    $returnPlan = @(New-MT5VmReturnKeyInputPlan)
    $insertedReturn = Invoke-MT5VmNativeKeyboardInputBoundary -Plan $returnPlan
    if ([int]$insertedReturn -ne $returnPlan.Count) {
      throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_EDITOR_INVALID'
    }
    $activeDialog = [IntPtr]::Zero
'@
      test = 'backend.bridge.mt5_vm.test_terminal_python_api_bootstrap.TerminalPythonApiBootstrapTests.test_webrequest_virtual_key_stage_commits_once_after_readback'
    },
    [pscustomobject]@{
      name = 'accept-live-committed-editor'
      search = 'if ($EditorIsWindow -or $EditorVisible -or -not $NativeIdentityValid) {'
      replace = 'if ($false -or $false -or -not $NativeIdentityValid) {'
      test = 'backend.bridge.mt5_vm.test_terminal_python_api_bootstrap.TerminalPythonApiBootstrapTests.test_webrequest_committed_row_guard_accepts_only_retired_editor_exact_state_and_identity'
    },
    [pscustomobject]@{
      name = 'accept-visible-committed-editor'
      search = 'if ($EditorIsWindow -or $EditorVisible -or -not $NativeIdentityValid) {'
      replace = 'if ($EditorIsWindow -or $false -or -not $NativeIdentityValid) {'
      test = 'backend.bridge.mt5_vm.test_terminal_python_api_bootstrap.TerminalPythonApiBootstrapTests.test_webrequest_committed_row_guard_accepts_only_retired_editor_exact_state_and_identity'
    },
    [pscustomobject]@{
      name = 'accept-wrong-committed-control-identity'
      search = 'if ($EditorIsWindow -or $EditorVisible -or -not $NativeIdentityValid) {'
      replace = 'if ($EditorIsWindow -or $EditorVisible -or $false) {'
      test = 'backend.bridge.mt5_vm.test_terminal_python_api_bootstrap.TerminalPythonApiBootstrapTests.test_webrequest_committed_row_guard_accepts_only_retired_editor_exact_state_and_identity'
    },
    [pscustomobject]@{
      name = 'accept-editor-readback-as-persisted-proof'
      search = @'
    $persisted = Read-MT5VmWebRequestStateBoundary -OptionsHandle $activeDialog
    Cancel-MT5VmOptionsDialogBoundary -OptionsHandle $activeDialog
    $activeDialog = [IntPtr]::Zero
    if ($DeferPermissionProof -and $persisted.Enabled -eq 1 -and
'@
      replace = @'
    $persisted = $desired
    Cancel-MT5VmOptionsDialogBoundary -OptionsHandle $activeDialog
    $activeDialog = [IntPtr]::Zero
    if ($DeferPermissionProof -and $persisted.Enabled -eq 1 -and
'@
      test = 'backend.bridge.mt5_vm.test_terminal_python_api_bootstrap.TerminalPythonApiBootstrapTests.test_webrequest_allowlist_mismatch_restores_snapshot_before_rethrow'
    },
    [pscustomobject]@{
      name = 'accept-wrong-options-ok-pid'
      search = @'
$ButtonProcessId -ne $ExpectedProcessId -or
      $EditorProcessId -ne $ExpectedProcessId) {
'@
      replace = @'
$false -or
      $EditorProcessId -ne $ExpectedProcessId) {
'@
      test = 'backend.bridge.mt5_vm.test_terminal_python_api_bootstrap.TerminalPythonApiBootstrapTests.test_webrequest_physical_ok_identity_point_and_click_plan_are_exact'
    },
    [pscustomobject]@{
      name = 'accept-wrong-options-ok-point'
      search = '$ObservedPointHandle -ne $ExpectedButtonHandle) {'
      replace = '$false) {'
      test = 'backend.bridge.mt5_vm.test_terminal_python_api_bootstrap.TerminalPythonApiBootstrapTests.test_webrequest_physical_ok_identity_point_and_click_plan_are_exact'
    },
    [pscustomobject]@{
      name = 'permit-partial-options-ok-click'
      search = 'if ([int](& $ClickAction $plan) -ne 2 -or (& $WaitAction) -ne $true) {'
      replace = 'if ([int](& $ClickAction $plan) -gt 2 -or (& $WaitAction) -ne $true) {'
      test = 'backend.bridge.mt5_vm.test_terminal_python_api_bootstrap.TerminalPythonApiBootstrapTests.test_webrequest_physical_ok_confirm_fails_closed_and_restores_cursor'
    },
    [pscustomobject]@{
      name = 'skip-options-ok-cursor-restoration'
      search = @'
  try {
    if ((& $RestoreCursorAction $cursor) -ne $true) {
      throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_CURSOR_RESTORE_FAILED'
    }
  } catch {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_CURSOR_RESTORE_FAILED'
  }
  if ($null -ne $originalFailure) { throw $originalFailure }
'@
      replace = @'
  try {
    if ($false) {
      throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_CURSOR_RESTORE_FAILED'
    }
  } catch {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_CURSOR_RESTORE_FAILED'
  }
  if ($null -ne $originalFailure) { throw $originalFailure }
'@
      test = 'backend.bridge.mt5_vm.test_terminal_python_api_bootstrap.TerminalPythonApiBootstrapTests.test_webrequest_physical_ok_confirm_fails_closed_and_restores_cursor'
    }
  )
  $killed = 0
  try {
    foreach ($mutant in $mutants) {
      foreach ($field in @('search', 'replace', 'search2', 'replace2')) {
        if ($null -ne $mutant.PSObject.Properties[$field]) {
          $mutant.$field = ([string]$mutant.$field).Replace("`r`n", "`n")
        }
      }
      Write-Output ('PRODUCTION_WEBREQUEST_MOUSE_MUTANT_START=' + [string]$mutant.name)
      $matchCount = [regex]::Matches(
        $originalText,
        [regex]::Escape([string]$mutant.search)
      ).Count
      Assert-Gate ($matchCount -eq 1) 'PROVISIONING_MOUSE_MUTANT_SOURCE_UNEXPECTED'
      $mutantText = $originalText.Replace(
        [string]$mutant.search,
        [string]$mutant.replace
      )
      if ($null -ne $mutant.PSObject.Properties['search2']) {
        $secondMatchCount = [regex]::Matches(
          $mutantText,
          [regex]::Escape([string]$mutant.search2)
        ).Count
        Assert-Gate ($secondMatchCount -eq 1) 'PROVISIONING_MOUSE_MUTANT_SOURCE_UNEXPECTED'
        $mutantText = $mutantText.Replace(
          [string]$mutant.search2,
          [string]$mutant.replace2
        )
      }
      [IO.File]::WriteAllText(
        $uiHelper,
        $mutantText,
        (New-Object Text.UTF8Encoding($false))
      )
      Assert-Gate (
        (Get-FileHash -LiteralPath $uiHelper -Algorithm SHA256).Hash -cne $originalHash
      ) 'PROVISIONING_MOUSE_MUTANT_NOT_APPLIED'
      $savedErrorActionPreference = $ErrorActionPreference
      try {
        $ErrorActionPreference = 'Continue'
        $mutantOutput = @(& python.exe -m unittest -v ([string]$mutant.test) 2>&1)
        $mutantExitCode = $LASTEXITCODE
      } finally {
        $ErrorActionPreference = $savedErrorActionPreference
      }
      Assert-Gate ($mutantExitCode -ne 0) 'PROVISIONING_MOUSE_MUTANT_SURVIVED'
      $expectedTestName = ([string]$mutant.test).Split('.')[-1]
      Assert-Gate (
        ($mutantOutput -join "`n").Contains($expectedTestName)
      ) 'PROVISIONING_MOUSE_MUTANT_WRONG_TEST'
      $killed += 1
      [IO.File]::WriteAllBytes($uiHelper, $originalBytes)
      Assert-Gate (
        (Get-FileHash -LiteralPath $uiHelper -Algorithm SHA256).Hash -ceq $originalHash
      ) 'PROVISIONING_MOUSE_MUTANT_RESTORE_FAILED'
    }
  } finally {
    [IO.File]::WriteAllBytes($uiHelper, $originalBytes)
  }
  Assert-Gate ($killed -eq $mutants.Count) 'PROVISIONING_MOUSE_MUTATION_SCORE_INVALID'
  Assert-Gate (
    (Get-FileHash -LiteralPath $uiHelper -Algorithm SHA256).Hash -ceq $originalHash
  ) 'PROVISIONING_MOUSE_MUTANT_RESTORE_FAILED'
  & python.exe -m unittest -v `
    backend.bridge.mt5_vm.test_terminal_python_api_bootstrap.TerminalPythonApiBootstrapTests.test_webrequest_physical_mouse_activation_rechecks_guard_and_counts `
    backend.bridge.mt5_vm.test_terminal_python_api_bootstrap.TerminalPythonApiBootstrapTests.test_webrequest_add_editor_identity_is_exact_and_fail_closed `
    backend.bridge.mt5_vm.test_terminal_python_api_bootstrap.TerminalPythonApiBootstrapTests.test_webrequest_physical_mouse_transaction_always_restores_cursor `
    backend.bridge.mt5_vm.test_terminal_python_api_bootstrap.TerminalPythonApiBootstrapTests.test_webrequest_virtual_key_stage_commits_once_after_readback `
    backend.bridge.mt5_vm.test_terminal_python_api_bootstrap.TerminalPythonApiBootstrapTests.test_webrequest_allowlist_mismatch_restores_snapshot_before_rethrow `
    backend.bridge.mt5_vm.test_terminal_python_api_bootstrap.TerminalPythonApiBootstrapTests.test_webrequest_physical_ok_identity_point_and_click_plan_are_exact `
    backend.bridge.mt5_vm.test_terminal_python_api_bootstrap.TerminalPythonApiBootstrapTests.test_webrequest_physical_ok_confirm_fails_closed_and_restores_cursor `
    backend.bridge.mt5_vm.test_terminal_python_api_bootstrap.TerminalPythonApiBootstrapTests.test_webrequest_committed_row_guard_accepts_only_retired_editor_exact_state_and_identity
  Assert-NativeSuccess 'PROVISIONING_MOUSE_MUTATION_RESTORED_TEST_FAILED'
  Assert-Gate ($mutants.Count -eq 18) 'PROVISIONING_MOUSE_MUTATION_MANIFEST_INVALID'
  Write-Output 'PRODUCTION_WEBREQUEST_MOUSE_MUTATION=18/18'
}

if ($AllowlistMutationTestsOnly) {
  Invoke-AllowlistMutationTests
  exit 0
}

if ($ProbeMutationTestsOnly) {
  Invoke-ProbeMutationTests
  exit 0
}

if ($MouseMutationTestsOnly) {
  Invoke-MouseMutationTests
  exit 0
}

function Invoke-ProvisionCodeGauntlet {
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$python = Join-Path $repo 'backend\.venv-mt5\Scripts\python.exe'
$runRoot = Join-Path $repo ('.artifacts\production-worker-host-provision\v40\code-' + [guid]::NewGuid().ToString('N'))
$null = [IO.Directory]::CreateDirectory($runRoot)
$results = [Collections.Generic.List[object]]::new()
$probe = Join-Path $repo 'tools\mt5-baremetal\Invoke-MT5WebRequestProbe.ps1'
$allowlist = Join-Path $repo 'tools\mt5-baremetal\Set-MT5WebRequestAllowlist.ps1'
$verifier = Join-Path $repo 'tools\verify-production-worker-host-provision.ps1'
$uiHelper = Join-Path $repo 'backend\bridge\mt5_vm\Mt5VmTerminalUi.ps1'
$repairTests = 'backend.bridge.mt5_vm.test_production_webrequest_probe'

function Assert-Repair([bool]$Condition, [string]$Code) {
  if (-not $Condition) { throw $Code }
}

function Assert-RepairSecretsAbsent([string]$SourceText, [string[]]$Secrets) {
  foreach ($secret in $Secrets) {
    if ($SourceText.Contains($secret)) { throw 'REPAIR_SECRET_DETECTED' }
  }
}

function Invoke-RepairCommand {
  param([string]$Name, [string]$Executable, [string[]]$CommandArguments,
    [int]$ExpectedExit = 0, [string]$RequiredText = '')
  Write-Host "[$Name]" -ForegroundColor Cyan
  $out = Join-Path $runRoot ($Name + '.stdout.log')
  $err = Join-Path $runRoot ($Name + '.stderr.log')
  # Process arguments contain only controlled paths, switches, and test names.
  $quoted = @($CommandArguments | ForEach-Object {
    Assert-Repair (-not $_.Contains('"')) 'REPAIR_ARGUMENT_QUOTE_UNSUPPORTED'
    '"' + $_ + '"'
  })
  $process = Start-Process -FilePath $Executable -ArgumentList $quoted `
    -WorkingDirectory $repo -WindowStyle Hidden -PassThru -Wait `
    -RedirectStandardOutput $out -RedirectStandardError $err
  $output = [IO.File]::ReadAllText($out) + [IO.File]::ReadAllText($err)
  $pass = $process.ExitCode -eq $ExpectedExit -and
    ([string]::IsNullOrEmpty($RequiredText) -or $output.Contains($RequiredText))
  $results.Add([pscustomobject]@{
    name = $Name; pass = $pass; exit_code = $process.ExitCode
    expected_exit = $ExpectedExit; stdout = $out; stderr = $err
  })
  if (-not $pass) { throw "REPAIR_LAYER_FAILED:$Name" }
  return $output
}

function Invoke-RepairMutant {
  param([string]$Name, [string]$Path, [string]$Search, [string]$Replacement, [string]$Test)
  $bytes = [IO.File]::ReadAllBytes($Path)
  $hash = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
  $source = [Text.Encoding]::UTF8.GetString($bytes).Replace("`r`n", "`n")
  Assert-Repair ([regex]::Matches($source, [regex]::Escape($Search)).Count -eq 1) 'REPAIR_MUTANT_SOURCE_UNEXPECTED'
  try {
    $mutant = $source.Replace($Search, $Replacement)
    [IO.File]::WriteAllText($Path, $mutant, (New-Object Text.UTF8Encoding($false)))
    $mutantHash = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
    Assert-Repair ($mutantHash -cne $hash) 'REPAIR_MUTANT_NOT_APPLIED'
    $testName = if ($Test.StartsWith('backend.')) { $Test } else { $repairTests + '.' + $Test }
    $output = Invoke-RepairCommand -Name ('mutant-' + $Name) -Executable $python `
      -CommandArguments @('-m', 'unittest', $testName, '-v') `
      -ExpectedExit 1 -RequiredText 'FAILED (failures='
    Assert-Repair ($output.Contains(($Test -split '\.')[-1])) 'REPAIR_MUTANT_TEST_NOT_EXECUTED'
    $results.Add([pscustomobject]@{ name = 'mutant-proof-' + $Name; pass = $true; mutated_sha256 = $mutantHash })
  } finally {
    [IO.File]::WriteAllBytes($Path, $bytes)
    Assert-Repair ((Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash -ceq $hash) 'REPAIR_MUTANT_RESTORE_FAILED'
  }
}

$codeFiles = @(
  'tools/mt5-baremetal/Invoke-MT5WebRequestProbe.ps1',
  'tools/mt5-baremetal/MarketLensWebRequestProbe.mq5',
  'tools/mt5-baremetal/Set-MT5WebRequestAllowlist.ps1',
  'tools/verify-production-worker-host-provision.ps1',
  'tools/verify-mt5-production-repair.ps1',
  'tools/mt5-baremetal/MT5ProvisioningState.ps1',
  'tools/Install-ProductionManagedWorker.ps1',
  'backend/bridge/mt5_vm/test_production_host_provision.py',
  'backend/bridge/mt5_vm/test_production_webrequest_probe.py',
  'backend/bridge/mt5_vm/test_terminal_python_api_bootstrap.py',
  'backend/bridge/mt5_vm/Mt5VmTerminalUi.ps1'
)
$sourceHashes = @{}
foreach ($relative in $codeFiles) {
  $path = Join-Path $repo $relative
  $sourceHashes[$relative] = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
  if ($relative.EndsWith('.ps1')) {
    $errors = $null
    $null = [Management.Automation.Language.Parser]::ParseFile($path, [ref]$null, [ref]$errors)
    Assert-Repair ($errors.Count -eq 0) 'REPAIR_PARSE_FAILED'
  }
}
$gitHead = @(& git -C $repo rev-parse HEAD)
Assert-Repair ($LASTEXITCODE -eq 0 -and $gitHead.Count -eq 1) 'REPAIR_GIT_HEAD_FAILED'
$savedUtf8 = [Environment]::GetEnvironmentVariable('PYTHONUTF8', 'Process')
$status = 'FAIL'
try {
  [Environment]::SetEnvironmentVariable('PYTHONUTF8', '1', 'Process')
  if ($KnownBadControl) {
    Assert-RepairSecretsAbsent -SourceText 'repair-control-secret-0123456789' -Secrets @('repair-control-secret-0123456789')
    return
  }
  $null = Invoke-RepairCommand -Name 'python-version' -Executable $python -CommandArguments @('--version') -RequiredText 'Python '
  $compileSource = Join-Path $runRoot 'MarketLensWebRequestProbe.mq5'
  $compileLog = Join-Path $runRoot 'probe-compile.log'
  Copy-Item -LiteralPath (Join-Path $repo 'tools/mt5-baremetal/MarketLensWebRequestProbe.mq5') -Destination $compileSource
  $compiler = Start-Process -FilePath 'C:\Program Files\MetaTrader 5\metaeditor64.exe' `
    -ArgumentList @('/compile:"' + $compileSource + '"', '/log:"' + $compileLog + '"') `
    -WindowStyle Hidden -Wait -PassThru
  $probeAst = [Management.Automation.Language.Parser]::ParseFile($probe, [ref]$null, [ref]$null)
  foreach ($node in $probeAst.FindAll({ param($n)
      $n -is [Management.Automation.Language.FunctionDefinitionAst] -and
      $n.Name -in @('Assert-ProbeTrue', 'Assert-ProbeCompileResult')
    }, $false)) { . ([scriptblock]::Create($node.Extent.Text)) }
  Assert-ProbeCompileResult -ExitCode $compiler.ExitCode `
    -BinaryExists (Test-Path -LiteralPath ([IO.Path]::ChangeExtension($compileSource, '.ex5'))) `
    -CompileText ([IO.File]::ReadAllText($compileLog))
  $results.Add([pscustomobject]@{ name = 'mql-compile'; pass = $true; exit_code = $compiler.ExitCode; log = $compileLog })
  $null = Invoke-RepairCommand -Name 'focused-regressions' -Executable $python -CommandArguments @(
    '-m', 'unittest', '-v', 'backend.bridge.mt5_vm.test_terminal_python_api_bootstrap',
    $repairTests, 'backend.bridge.mt5_vm.test_baremetal_worker_install', 'backend.bridge.mt5_vm.test_production_host_provision'
  ) -RequiredText 'OK'
  foreach ($item in @(
      [pscustomobject]@{ name = 'allowlist-contracts'; path = $allowlist; marker = 'PRODUCTION_WEBREQUEST_ALLOWLIST_CONTRACTS=PASS' },
      [pscustomobject]@{ name = 'probe-contracts'; path = $probe; marker = 'PRODUCTION_WEBREQUEST_PROBE_CONTRACTS=PASS' },
      [pscustomobject]@{ name = 'verifier-contracts'; path = $verifier; marker = 'PRODUCTION_WORKER_HOST_PROVISION_CONTRACTS=PASS' }
    )) {
    $null = Invoke-RepairCommand -Name $item.name -Executable 'powershell.exe' -CommandArguments @(
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $item.path, '-ContractTestsOnly'
    ) -RequiredText $item.marker
  }
  $null = Invoke-RepairCommand -Name 'probe-known-bad' -Executable 'powershell.exe' -CommandArguments @(
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $probe, '-ContractTestsOnly', '-KnownBadControl'
  ) -ExpectedExit 1 -RequiredText 'PROVISIONING_PROBE_RECEIPT_INVALID'
  $null = Invoke-RepairCommand -Name 'entrypoint-known-bad' -Executable 'powershell.exe' -CommandArguments @(
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $PSCommandPath, '-CodeTestsOnly', '-KnownBadControl'
  ) -ExpectedExit 1 -RequiredText 'REPAIR_SECRET_DETECTED'
  foreach ($mode in @('Allowlist', 'Probe', 'Mouse')) {
    $null = Invoke-RepairCommand -Name ('existing-' + $mode + '-mutations') -Executable 'powershell.exe' -CommandArguments @(
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $verifier, ('-' + $mode + 'MutationTestsOnly')
    ) -RequiredText 'MUTATION='
  }
  Invoke-RepairMutant -Name 'crlf' -Path $probe `
    -Search '$driverText = (Get-Content -LiteralPath $PSCommandPath -Raw).Replace("`r`n", "`n")' `
    -Replacement '$driverText = Get-Content -LiteralPath $PSCommandPath -Raw' `
    -Test 'ProductionWebRequestProbeTests.test_probe_contract_accepts_lf_and_crlf'
  Invoke-RepairMutant -Name 'skip-live-probe' -Path $allowlist `
    -Search '$verified = ((& $ProbeAction) -eq $true)' -Replacement '$verified = $true' `
    -Test 'ProductionRepairContractsTests.test_allowlist_preserves_opaque_profile_values'
  Invoke-RepairMutant -Name 'overwrite-native-value' -Path $allowlist `
    -Search '-ExpectedOrigin ''http://127.0.0.1'' -PreserveNativeValue' `
    -Replacement '-ExpectedOrigin ''http://127.0.0.1''' `
    -Test 'ProductionRepairContractsTests.test_allowlist_preserves_opaque_profile_values'
  Invoke-RepairMutant -Name 'rollback-acl' -Path $allowlist `
    -Search 'if ($PreserveNativeAcl) {' -Replacement 'if ($false) {' `
    -Test 'ProductionRepairContractsTests.test_probe_and_settings_failure_restore_owned_state'
  Invoke-RepairMutant -Name 'accept-unrelated-source' -Path $verifier `
    -Search 'Assert-Gate ($allowed -ccontains $path.Replace(''\'', ''/'')) ''PROVISIONING_UNAPPROVED_TRACKED_PATH''' `
    -Replacement '$null = $path' `
    -Test 'ProductionRepairContractsTests.test_source_guard_rejects_unrelated_change'
  Invoke-RepairMutant -Name 'stale-permission-receipt' -Path $probe `
    -Search 'Assert-ProbeTrue ([string]$Receipt.nonce -ceq $ExpectedNonce) ''PROVISIONING_PROBE_RECEIPT_INVALID''' `
    -Replacement '$null = $ExpectedNonce' `
    -Test 'ProductionRepairContractsTests.test_permission_failure_requires_fresh_receipt_identity'
  Invoke-RepairMutant -Name 'accept-malformed-native-switch' -Path $allowlist `
    -Search '$webGroup.Value -cnotin @(''0'', ''1'')' -Replacement '$false' `
    -Test 'ProductionRepairContractsTests.test_native_allowlist_rejects_hostile_inputs_before_actions'
  Invoke-RepairMutant -Name 'accept-opaque-rows-without-probe-contract' -Path $uiHelper `
    -Search 'if ($DeferPermissionProof -and $persisted.Enabled -eq 1 -and' `
    -Replacement 'if ($persisted.Enabled -eq 1 -and' `
    -Test 'backend.bridge.mt5_vm.test_terminal_python_api_bootstrap.TerminalPythonApiBootstrapTests.test_opaque_reopened_rows_require_explicit_probe_opt_in'
  Invoke-RepairMutant -Name 'local-clock-receipt' -Path (Join-Path $repo 'tools/mt5-baremetal/MarketLensWebRequestProbe.mq5') `
    -Search 'long observed_at_unix=(long)TimeGMT();' `
    -Replacement 'long observed_at_unix=(long)TimeLocal();' `
    -Test 'ProductionRepairContractsTests.test_receipt_clock_is_utc_and_rejects_local_timezone_offsets'

  $stateHelper = Join-Path $repo 'tools/mt5-baremetal/MT5ProvisioningState.ps1'
  $v40Tests = 'backend.bridge.mt5_vm.test_production_host_provision'
  $v40Mutants = @(
    @{Name='v40-ui-default';Path=$allowlist;
      Search='if (-not $ConfigureNativeAllowlist) { throw ''PROVISIONING_WEBREQUEST_ALLOWLIST_REQUIRED'' }';
      Replacement='$null = 0'; Test='test_default_allowlist_never_calls_ui'},
    @{Name='v40-offline-probe';Path=$allowlist;
      Search='return [pscustomobject]@{ status = ''OFFLINE'';';
      Replacement='& $ProbeAction; return [pscustomobject]@{ status = ''OFFLINE'';'; Test='test_commit_rollback_trace_is_offline'},
    @{Name='v40-stale-provenance';Path=$stateHelper;
      Search='$value.source_commit -cne $SourceCommit';Replacement='$false';
      Test='test_configuration_provenance_rejects_unknown_or_stale_state'},
    @{Name='v40-dotenv-bom';Path=$stateHelper;
      Search='if ($bom) { $payload = [byte[]](239,187,191) + $payload }';Replacement='$null = $bom';
      Test='test_dotenv_update_preserves_bytes_and_acl'},
    @{Name='v40-conflict-overwrite';Path=$stateHelper;
      Search='if ($exists -and -not $ReplaceExisting) {';Replacement='if ($false) {';
      Test='test_bundle_round_trip_and_partial_failure_rollback'},
    @{Name='v40-stale-pass';Path=$verifier;
      Search='if ($Status -ceq ''PASS'') {';Replacement='if ($false) {';
      Test='test_attempt_report_cannot_reuse_old_pass'},
    @{Name='v40-journal-ownership';Path=$stateHelper;
      Search='if (-not $record.owned) { continue }';Replacement='$null = $record';
      Test='test_journal_restores_owned_bytes_acl_and_preserves_unknown_files'},
    @{Name='v40-receipt-persistence';Path=(Join-Path $repo 'tools/Install-ProductionManagedWorker.ps1');
      Search='Set-ProvisionDotEnv -Path $envPath -Assignments @{ EXECUTION_MT5_MANAGED_WORKER_RECEIPT_FILE = $normalizedReceipt }';
      Replacement='$null = $normalizedReceipt';Test='test_receipt_persistence_preserves_bom_crlf_and_literals'},
    @{Name='v40-installer-schema';Path=$verifier;
      Search=('$inputObject = [ordered]@{' + "`n" + '    schema_version = 1');
      Replacement=('$inputObject = [ordered]@{' + "`n" + '    schema_version = 2');
      Test='test_actual_prepared_input_is_single_slot_and_strictly_parsed'},
    @{Name='v40-gateway-owner';Path=$verifier;
      Search='Assert-Gate ([IO.Path]::GetFullPath($owner.Path) -ieq [IO.Path]::GetFullPath($binary)) ''PROVISIONING_GATEWAY_LISTENER_MISMATCH''';
      Replacement='$null = $owner';Test='test_selected_host_gateway_preflight_rejects_foreign_listener'},
    @{Name='v40-proxy-ownership';Path=$verifier;
      Search=('$script:hostProxy' + 'Created = $true');Replacement='$script:hostProxyCreated = $false';
      Test='test_successful_probes_record_owned_proxy_for_later_rollback'}
  )
  foreach ($mutant in $v40Mutants) {
    Invoke-RepairMutant -Name $mutant.Name -Path $mutant.Path -Search $mutant.Search `
      -Replacement $mutant.Replacement -Test ($v40Tests + '.ProductionHostProvisionTests.' + $mutant.Test)
    # Run the invariant module separately while the same fault is applied.
    Invoke-RepairMutant -Name ($mutant.Name + '-invariants') -Path $mutant.Path -Search $mutant.Search `
      -Replacement $mutant.Replacement -Test $v40Tests
  }
  $reverseRunner = Join-Path $runRoot 'reverse-tests.py'
  [IO.File]::WriteAllText($reverseRunner, @'
import sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path.cwd()))
def flatten(suite):
    for item in suite:
        if isinstance(item, unittest.TestSuite):
            yield from flatten(item)
        else:
            yield item
suite = unittest.defaultTestLoader.loadTestsFromNames([
    'backend.bridge.mt5_vm.test_production_webrequest_probe',
    'backend.bridge.mt5_vm.test_production_host_provision',
    'backend.bridge.mt5_vm.test_terminal_python_api_bootstrap.TerminalPythonApiBootstrapTests.test_opaque_reopened_url_rows_remain_pending_until_external_probe',
    'backend.bridge.mt5_vm.test_terminal_python_api_bootstrap.TerminalPythonApiBootstrapTests.test_opaque_reopened_rows_require_explicit_probe_opt_in',
    'backend.bridge.mt5_vm.test_terminal_python_api_bootstrap.TerminalPythonApiBootstrapTests.test_deferred_probe_does_not_accept_readable_wrong_url',
])
tests = list(flatten(suite))
if not tests:
    raise RuntimeError('EMPTY_REPAIR_SUITE')
result = unittest.TextTestRunner(verbosity=2).run(unittest.TestSuite(reversed(tests)))
sys.exit(0 if result.wasSuccessful() else 1)
'@, (New-Object Text.UTF8Encoding($false)))
  $null = Invoke-RepairCommand -Name 'reverse-order-restored-regressions' -Executable $python -CommandArguments @($reverseRunner) -RequiredText 'OK'
  $null = Invoke-RepairCommand -Name 'diff-check' -Executable 'git.exe' -CommandArguments @('-C', $repo, 'diff', '--check')
  $null = Invoke-RepairCommand -Name 'backend-docs' -Executable 'powershell.exe' -CommandArguments @(
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $repo 'tools\verify-backend-docs.ps1'), '-DocsOnly'
  )
  $secretDiff = @(& git -C $repo diff --unified=0 -- @codeFiles)
  Assert-Repair ($LASTEXITCODE -eq 0) 'REPAIR_SECRET_DIFF_FAILED'
  Assert-RepairSecretsAbsent -SourceText ($secretDiff -join "`n") -Secrets @(('repair-control-' + 'secret-0123456789-should-not-ship'))
  $results.Add([pscustomobject]@{ name = 'synthetic-secret-control-and-diff'; pass = $true; limitation = 'no real credentials read; not a comprehensive secret detector' })
  $dependencyPaths = @('backend/go.mod', 'backend/go.sum', 'backend/execution/Cargo.toml',
    'backend/execution/Cargo.lock', 'frontend/package.json', 'frontend/package-lock.json')
  $dependencyChanges = @(& git -C $repo diff --name-only '7bcfeb891c6b76048c471af8c8dd0738177b2b56' -- @dependencyPaths)
  Assert-Repair ($LASTEXITCODE -eq 0 -and $dependencyChanges.Count -eq 0) 'REPAIR_DEPENDENCY_DELTA'
  $results.Add([pscustomobject]@{ name = 'dependency-delta'; pass = $true; changed_manifests = 0 })
  foreach ($relative in $codeFiles) {
    Assert-Repair ((Get-FileHash -LiteralPath (Join-Path $repo $relative) -Algorithm SHA256).Hash -ceq $sourceHashes[$relative]) 'REPAIR_FINAL_SOURCE_DRIFT'
  }
  $status = 'PASS'
} finally {
  [Environment]::SetEnvironmentVariable('PYTHONUTF8', $savedUtf8, 'Process')
  $report = [ordered]@{
    status = $status; head = $gitHead[0]; source_sha256 = $sourceHashes
    powershell_version = $PSVersionTable.PSVersion.ToString()
    finished_at_utc = [DateTime]::UtcNow.ToString('o'); layers = @($results)
    production = 'DEFERRED_TO_USER_ON_DESKTOP-MDC339G'
    coverage = 'behavior and branch mapping; no numeric PowerShell line coverage'
  }
  [IO.File]::WriteAllText((Join-Path $runRoot 'report.json'), ($report | ConvertTo-Json -Depth 6), (New-Object Text.UTF8Encoding($false)))
  Write-Host "REPAIR_REPORT=$runRoot\report.json"
}
Write-Host 'PRODUCTION_WORKER_HOST_PROVISION_CODE=PASS' -ForegroundColor Green

}

if ($CodeTestsOnly) {
  if ($ConfigureNativeAllowlist) { throw 'PROVISIONING_MODE_CONFLICT' }
  Invoke-ProvisionCodeGauntlet
  exit 0
}

if ($ContractTestsOnly) {
  Invoke-ContractTests
  exit 0
}

. (Join-Path $PSScriptRoot 'mt5-baremetal/MT5ProvisioningState.ps1')

function Protect-ExactFileAcl {
  param([string]$Path)
  Assert-ProvisionAcl $Path
}

function Write-Utf8NoBomAtomic {
  param([string]$Path, [string]$Contents, [switch]$PreserveAcl)
  Set-ProvisionFileBytes -Path $Path -Bytes ([Text.Encoding]::UTF8.GetBytes($Contents)) -ReplaceExisting:$PreserveAcl
}

function Read-DotEnv {
  param([Parameter(Mandatory = $true)][string]$Path)
  Assert-Gate (Test-Path -LiteralPath $Path -PathType Leaf) 'PROVISIONING_BACKEND_ENV_MISSING'
  $text = [IO.File]::ReadAllText($Path, (New-Object Text.UTF8Encoding($false, $true)))
  $values = @{}
  foreach ($line in ($text -split "`r?`n")) {
    if ($line -match '^\s*(?:#|$)') { continue }
    if ($line -notmatch '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') { continue }
    $key = $matches[1]
    Assert-Gate (-not $values.ContainsKey($key)) 'PROVISIONING_BACKEND_ENV_DUPLICATE'
    $values[$key] = $matches[2].Trim()
  }
  [pscustomobject]@{ text = $text; values = $values }
}

function Set-DotEnvValues {
  param([string]$Path, [hashtable]$Assignments)
  Set-ProvisionDotEnv -Path $Path -Assignments $Assignments
}

function New-RandomSecret {
  $bytes = New-Object byte[] 48
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  [Convert]::ToBase64String($bytes)
}

function Test-FixedTimeEqual {
  param([string]$Left, [string]$Right)
  $leftBytes = [Text.Encoding]::UTF8.GetBytes($Left)
  $rightBytes = [Text.Encoding]::UTF8.GetBytes($Right)
  if ($leftBytes.Length -ne $rightBytes.Length) { return $false }
  $difference = 0
  for ($index = 0; $index -lt $leftBytes.Length; $index++) {
    $difference = $difference -bor ($leftBytes[$index] -bxor $rightBytes[$index])
  }
  return $difference -eq 0
}

function Prepare-BootstrapSecret {
  $parsed = Read-DotEnv -Path $backendEnvPath
  $adminToken = [string]$parsed.values['EXECUTION_ADMIN_TOKEN']
  Assert-Gate ($adminToken.Length -ge 32) 'PROVISIONING_ADMIN_TOKEN_INVALID'
  $configured = [string]$parsed.values['EXECUTION_MT5_VM_BOOTSTRAP_TOKEN']
  $fileSecret = if (Test-Path -LiteralPath $bootstrapTokenPath -PathType Leaf) {
    [IO.File]::ReadAllText($bootstrapTokenPath).Trim()
  } else { '' }
  $secret = if (-not [string]::IsNullOrWhiteSpace($configured)) {
    $configured
  } elseif (-not [string]::IsNullOrWhiteSpace($fileSecret)) {
    $fileSecret
  } else {
    New-RandomSecret
  }
  Assert-Gate ($secret.Length -ge 32 -and -not (Test-FixedTimeEqual $secret $adminToken)) `
    'PROVISIONING_BOOTSTRAP_TOKEN_INVALID'
  if (-not [string]::IsNullOrWhiteSpace($fileSecret)) {
    Assert-Gate (Test-FixedTimeEqual $secret $fileSecret) 'PROVISIONING_BOOTSTRAP_TOKEN_MISMATCH'
  } else {
    Write-Utf8NoBomAtomic -Path $bootstrapTokenPath -Contents $secret
  }
  Protect-ExactFileAcl -Path $bootstrapTokenPath
  Set-DotEnvValues -Path $backendEnvPath -Assignments @{
    EXECUTION_MT5_VM_BOOTSTRAP_TOKEN = $secret
    EXECUTION_MT5_MANAGED_WORKER_INSTALL_INPUT_FILE = $installInputPath
  }
  $verified = Read-DotEnv -Path $backendEnvPath
  Assert-Gate (Test-FixedTimeEqual ([string]$verified.values['EXECUTION_MT5_VM_BOOTSTRAP_TOKEN']) $secret) `
    'PROVISIONING_BOOTSTRAP_TOKEN_MISMATCH'
  return $secret
}

function Prepare-ManagedWorkerInstallInput {
  $chartPath = Join-Path $slotInputRoot 'chart01.chr'
  $settingsPath = Join-Path $slotInputRoot 'experts.ini'
  $attestationPath = Join-Path $slotInputRoot 'webrequest-attestation.json'
  foreach ($path in @($chartPath, $settingsPath, $attestationPath)) {
    Assert-Gate (Test-Path -LiteralPath $path -PathType Leaf) 'PROVISIONING_WEBREQUEST_EVIDENCE_MISSING'
  }
  $terminalLicense = Join-Path (Split-Path -Parent $selectedTerminal) 'Config\terminal.lic'
  $servers = Join-Path $selectedStateRoot 'Config\servers.dat'
  $releaseBinary = Join-Path $repoRoot 'frontend\public\downloads\MarketLensExecutionEA.ex5'
  foreach ($path in @($selectedTerminal, $terminalLicense, $servers, $releaseBinary)) {
    Assert-Gate (Test-Path -LiteralPath $path -PathType Leaf) 'PROVISIONING_REQUIRED_ARTIFACT_MISSING'
  }
  $slot = [ordered]@{
    slot_id = 'slot-01'
    terminal_path = $selectedTerminal
    terminal_state_root = $selectedStateRoot
    terminal_sha256 = (Get-FileHash -LiteralPath $selectedTerminal -Algorithm SHA256).Hash.ToLowerInvariant()
    servers_sha256 = (Get-FileHash -LiteralPath $servers -Algorithm SHA256).Hash.ToLowerInvariant()
    terminal_license_sha256 = (Get-FileHash -LiteralPath $terminalLicense -Algorithm SHA256).Hash.ToLowerInvariant()
    ea_path = (Join-Path $selectedStateRoot 'MQL5\Experts\MarketLensExecutionEA.ex5')
    ea_sha256 = (Get-FileHash -LiteralPath $releaseBinary -Algorithm SHA256).Hash.ToLowerInvariant()
    ea_bootstrap_pipe = 'marketlens-slot-01'
    ea_profile = 'MarketLens-slot-01'
    ea_gateway_origin = $expectedOrigin
    ea_chart_template_path = $chartPath
    ea_chart_template_sha256 = (Get-FileHash -LiteralPath $chartPath -Algorithm SHA256).Hash.ToLowerInvariant()
    ea_webrequest_settings_source_path = $settingsPath
    ea_webrequest_settings_sha256 = (Get-FileHash -LiteralPath $settingsPath -Algorithm SHA256).Hash.ToLowerInvariant()
    ea_topology_attestation_source_path = $attestationPath
    ea_topology_attestation_sha256 = (Get-FileHash -LiteralPath $attestationPath -Algorithm SHA256).Hash.ToLowerInvariant()
  }
  $inputObject = [ordered]@{
    schema_version = 1
    worker_root = $workerRoot
    data_root = $workerDataRoot
    worker_identity = $selectedIdentity
    task_name = $taskName
    worker_id = $workerId
    bootstrap_token_file = $bootstrapTokenPath
    terminal_slots = @($slot)
    probe_symbol = 'EURUSD'
    sync_symbols = @('EURUSD')
  }
  Write-Utf8NoBomAtomic -Path $installInputPath `
    -Contents ($inputObject | ConvertTo-Json -Depth 8 -Compress)
  Protect-ExactFileAcl -Path $installInputPath
  return $inputObject
}

function Get-DatabaseEnvironment {
  $parsed = Read-DotEnv -Path $backendEnvPath
  $raw = [string]$parsed.values['DATABASE_URL']
  try { $uri = [Uri]$raw } catch { throw 'PROVISIONING_DATABASE_URL_INVALID' }
  Assert-Gate ($uri.Scheme -in @('postgres', 'postgresql')) 'PROVISIONING_DATABASE_URL_INVALID'
  $credentials = $uri.UserInfo.Split(':', 2)
  Assert-Gate ($credentials.Count -eq 2) 'PROVISIONING_DATABASE_URL_INVALID'
  @{
    PGHOST = $uri.Host
    PGPORT = [string]$uri.Port
    PGDATABASE = $uri.AbsolutePath.TrimStart('/')
    PGUSER = [Uri]::UnescapeDataString($credentials[0])
    PGPASSWORD = [Uri]::UnescapeDataString($credentials[1])
  }
}

function Assert-PostgreSqlProductionState {
  $service = Get-Service -Name 'postgresql-x64-16' -ErrorAction Stop
  Assert-Gate ($service.Status -eq [ServiceProcess.ServiceControllerStatus]::Running) `
    'PROVISIONING_POSTGRESQL16_NOT_RUNNING'
  $psql = Get-Command psql.exe -ErrorAction SilentlyContinue
  if (-not $psql) { $psql = Get-Command psql -ErrorAction SilentlyContinue }
  $psqlPath = if ($psql) { [string]$psql.Source } else {
    'C:\Program Files\PostgreSQL\16\bin\psql.exe'
  }
  Assert-Gate (Test-Path -LiteralPath $psqlPath -PathType Leaf) 'PROVISIONING_PSQL_MISSING'
  $databaseEnvironment = Get-DatabaseEnvironment
  $saved = @{}
  foreach ($entry in $databaseEnvironment.GetEnumerator()) {
    $saved[$entry.Key] = [Environment]::GetEnvironmentVariable($entry.Key, 'Process')
    [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, 'Process')
  }
  try {
    $version = @(& $psqlPath -X -q -t -A -c 'SHOW server_version_num;') -join ''
    Assert-NativeSuccess 'PROVISIONING_POSTGRESQL_QUERY_FAILED'
    $migration = @(& $psqlPath -X -q -t -A -c 'SELECT version::text || '':'' || dirty::text FROM schema_migrations;') -join ''
    Assert-NativeSuccess 'PROVISIONING_POSTGRESQL_QUERY_FAILED'
  } finally {
    foreach ($entry in $saved.GetEnumerator()) {
      [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, 'Process')
    }
  }
  Assert-Gate ([int]$version -ge 160000 -and [int]$version -lt 170000) `
    'PROVISIONING_POSTGRESQL_MAJOR_INVALID'
  Assert-Gate ($migration.Trim() -ceq '42:false') 'PROVISIONING_MIGRATION_STATE_INVALID'
}

function Assert-ProductionHealth {
  $api = Invoke-RestMethod -Uri 'http://127.0.0.1:8080/health' -TimeoutSec 10
  $ready = Invoke-RestMethod -Uri 'http://127.0.0.1:8080/health/ready' -TimeoutSec 10
  $relay = Invoke-RestMethod -Uri 'http://127.0.0.1:8080/execution-ea/health' -TimeoutSec 10
  $gateway = Invoke-RestMethod -Uri 'http://127.0.0.1:8791/health' -TimeoutSec 10
  Assert-Gate (
    [string]$api.status -ceq 'ok' -and
    $ready.ready -is [bool] -and [bool]$ready.ready -and [string]$ready.database -ceq 'up' -and
    $relay.ok -is [bool] -and [bool]$relay.ok -and [string]$relay.service -ceq 'execution-ea-relay' -and
    $gateway.ok -is [bool] -and [bool]$gateway.ok -and [string]$gateway.service -ceq 'execution-gateway'
  ) 'PROVISIONING_LOCAL_HEALTH_INVALID'
  $publicReady = Invoke-RestMethod -Uri 'https://api.tradingterminal.io.vn/health/ready' -TimeoutSec 30
  $publicRelay = Invoke-RestMethod -Uri 'https://api.tradingterminal.io.vn/execution-ea/health' -TimeoutSec 30
  Assert-Gate (
    $publicReady.ready -is [bool] -and [bool]$publicReady.ready -and
    [string]$publicReady.database -ceq 'up' -and
    $publicRelay.ok -is [bool] -and [bool]$publicRelay.ok -and
    [string]$publicRelay.service -ceq 'execution-ea-relay'
  ) 'PROVISIONING_PUBLIC_HEALTH_INVALID'
}

function Assert-ApprovedSourceState {
  $allowed = @(
    'backend/bridge/mt5_vm/test_production_webrequest_probe.py',
    'backend/bridge/mt5_vm/test_terminal_python_api_bootstrap.py',
    'backend/bridge/mt5_vm/test_production_host_provision.py',
    'backend/bridge/mt5_vm/test_baremetal_worker_install.py',
    'backend/bridge/mt5_vm/Mt5VmTerminalUi.ps1',
    'docs/agent-evidence/mt5-production-repair/EVIDENCE.md',
    'docs/agent-evidence/mt5-production-repair/SPEC.md',
    'docs/agent-evidence/production-worker-host-provision/SPEC.md',
    'docs/agent-evidence/production-worker-host-provision/EVIDENCE.md',
    'tools/mt5-baremetal/MT5ProvisioningState.ps1',
    'tools/Install-ProductionManagedWorker.ps1',
    'tools/mt5-baremetal/Invoke-MT5WebRequestProbe.ps1',
    'tools/mt5-baremetal/MarketLensWebRequestProbe.mq5',
    'tools/mt5-baremetal/Set-MT5WebRequestAllowlist.ps1',
    'tools/verify-production-worker-host-provision.ps1',
    'tools/verify-mt5-production-repair.ps1'
  )
  & git -C $repoRoot merge-base --is-ancestor $baselineCommit HEAD
  Assert-NativeSuccess 'PROVISIONING_BASELINE_NOT_ANCESTOR'
  $changed = @(& git -C $repoRoot diff --name-only "$baselineCommit..HEAD")
  Assert-NativeSuccess 'PROVISIONING_GIT_DIFF_FAILED'
  foreach ($path in $changed) {
    Assert-Gate ($allowed -ccontains $path.Replace('\', '/')) 'PROVISIONING_UNAPPROVED_TRACKED_PATH'
  }
  $dirty = @(& git -C $repoRoot status --porcelain=v1 --untracked-files=all)
  Assert-NativeSuccess 'PROVISIONING_GIT_STATUS_FAILED'
  Assert-Gate ($dirty.Count -eq 0) 'PROVISIONING_WORKTREE_NOT_CLEAN'
  $diffCheck = @(& git -C $repoRoot diff --check "$baselineCommit..HEAD")
  Assert-NativeSuccess 'PROVISIONING_DIFF_CHECK_FAILED'
  Assert-Gate ($diffCheck.Count -eq 0) 'PROVISIONING_DIFF_CHECK_FAILED'
  $probeSourceText = Get-Content -LiteralPath (Join-Path $repoRoot 'tools\mt5-baremetal\MarketLensWebRequestProbe.mq5') -Raw
  Assert-Gate ($probeSourceText -notmatch '(?i)OrderSend\(|AccountInfo|PositionSelect|HistoryDeal') `
    'PROVISIONING_PROBE_SOURCE_CAN_TRADE'
}

function Assert-ProvisionSelectedHost {
  Assert-Gate ([Security.Principal.WindowsIdentity]::GetCurrent().Name -ieq $selectedIdentity) 'PROVISIONING_SELECTED_HOST_INVALID'
  Assert-ProductionSelectedTerminalAndProfile
  Assert-ProductionSelectedTerminalAbsent
  $binary = Join-Path $repoRoot 'backend/bin/execution-gateway.exe'
  Assert-ProvisionPath $binary
  Assert-Gate (Test-Path -LiteralPath $binary -PathType Leaf) 'PROVISIONING_GATEWAY_BINARY_MISSING'
  $listeners = @(Get-NetTCPConnection -State Listen -LocalPort 8790 -ErrorAction Stop |
    Where-Object { $_.LocalAddress -ceq '127.0.0.1' })
  Assert-Gate ($listeners.Count -eq 1) 'PROVISIONING_GATEWAY_LISTENER_MISMATCH'
  $owner = Get-Process -Id $listeners[0].OwningProcess -ErrorAction Stop
  Assert-Gate ([IO.Path]::GetFullPath($owner.Path) -ieq [IO.Path]::GetFullPath($binary)) 'PROVISIONING_GATEWAY_LISTENER_MISMATCH'
  $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8790/health' -TimeoutSec 5
  Assert-Gate ($health.ok -is [bool] -and $health.ok -and $health.service -ceq 'execution-gateway' -and
    $health.protocolVersion -eq 1) 'PROVISIONING_GATEWAY_HEALTH_INVALID'
}

# Define the existing host boundaries without executing either tool's entrypoint.
foreach ($definitionFile in @($allowlistDriver, $probeDriver)) {
  $definitionAst = [Management.Automation.Language.Parser]::ParseFile($definitionFile, [ref]$null, [ref]$null)
  foreach ($definition in $definitionAst.FindAll({param($n)
      $n -is [Management.Automation.Language.FunctionDefinitionAst]}, $false)) {
    . ([scriptblock]::Create($definition.Extent.Text))
  }
}
$selectedProfile = $selectedStateRoot
$commonIniRelativePath = 'config\common.ini'
$maximumCommonIniBytes = 1048576
$expectedPublisher = 'CN=MetaQuotes Ltd., O=MetaQuotes Ltd., S=Lemesos, C=CY'
$gatewayOrigin = $expectedOrigin
$script:hostProofs = @()
$script:hostJournal = $null
$script:hostProxyCreated = $false
$listenAddress = '127.0.0.1'
$listenPort = 80
$connectAddress = '127.0.0.1'
$connectPort = 8790

function Invoke-ProvisionHostProofs {
  $script:hostProofs = @()
  $modes = if ($ConfigureNativeAllowlist) { @('configure','verify','verify') } else { @('verify','verify') }
  foreach ($mode in $modes) {
    $arguments = @('-NoProfile','-ExecutionPolicy','Bypass','-File',$allowlistDriver)
    if ($mode -ceq 'configure') { $arguments += '-ConfigureNativeAllowlist' }
    $output = @(& powershell.exe @arguments)
    Assert-NativeSuccess 'PROVISIONING_WEBREQUEST_ALLOWLIST_FAILED'
    if (@($output | Where-Object { $_ -match '^PRODUCTION_WEBREQUEST_ALLOWLIST=PASS proxy_created=True ' }).Count -eq 1) {
      $script:hostProxyCreated = $true
    }
    if ($mode -ceq 'configure') {
      Register-ProvisionOwnedFile (Join-Path $selectedStateRoot 'config/common.ini')
      Register-ProvisionOwnedFile (Join-Path $slotInputRoot 'native-allowlist-state.json')
    }
    $proofLines = @($output | Where-Object { $_ -match '^PRODUCTION_WEBREQUEST_ALLOWLIST_PROOF=' })
    Assert-Gate ($proofLines.Count -eq 1) 'PROVISIONING_PROOF_PATH_INVALID'
    $proofPath = $proofLines[0].Substring('PRODUCTION_WEBREQUEST_ALLOWLIST_PROOF='.Length)
    Assert-ProvisionAcl $proofPath
    $proof = [IO.File]::ReadAllText($proofPath) | ConvertFrom-Json -ErrorAction Stop
    if ($mode -ceq 'verify') {
      Assert-Gate (@($output | Where-Object { $_ -match ' status=UNCHANGED ' }).Count -eq 1) 'PROVISIONING_SECOND_PROBE_CHANGED'
      $script:hostProofs += $proof
    }
  }
  Assert-Gate ($script:hostProofs.Count -eq 2) 'PROVISIONING_PROOF_PAIR_INVALID'
  Assert-ProvisionProofPair $script:hostProofs[0] $script:hostProofs[1]
}

function Invoke-ProvisionInstallerDryRun {
  $agentPath = Join-Path $executionRoot 'target\release\mt5-vm-agent.exe'
  Assert-Gate (Test-Path -LiteralPath $agentPath -PathType Leaf) 'PROVISIONING_MANAGED_WORKER_AGENT_MISSING'
  $dryRunOutput = @(& (Join-Path $repoRoot 'tools\Install-ProductionManagedWorker.ps1') `
    -InstallInputPath $installInputPath -BackendEnvPath $backendEnvPath `
    -RepoRoot $repoRoot -AgentPath $agentPath `
    -GatewayUrl 'http://127.0.0.1:8791' -CredentialApiUrl 'http://127.0.0.1:8080')
  Assert-NativeSuccess 'PROVISIONING_MANAGED_WORKER_DRY_RUN_FAILED'
  Assert-ProvisionInstallerPlan (($dryRunOutput -join "`n") | ConvertFrom-Json -ErrorAction Stop)
  Register-ProvisionOwnedFile $backendEnvPath
}

function Undo-ProvisionHostPreparation {
  Assert-ProductionSelectedTerminalAbsent
  if ($script:hostProxyCreated) {
    Assert-Gate ([bool](Remove-ProductionOwnedLoopbackPortProxy)) 'PROVISIONING_WEBREQUEST_ALLOWLIST_ROLLBACK_FAILED'
    $script:hostProxyCreated = $false
  }
  if ($null -ne $script:hostJournal) { Restore-ProvisionJournal $script:hostJournal }
}

try {
  Assert-ApprovedSourceState
  Assert-ProvisionSelectedHost
  $null = [IO.Directory]::CreateDirectory($reportRoot)

  Invoke-GauntletLayer 'tool-contracts' {
    Assert-PowerShellParses -Path $PSCommandPath
    Assert-PowerShellParses -Path $probeDriver
    Assert-PowerShellParses -Path $allowlistDriver
    & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $PSCommandPath -ContractTestsOnly
    Assert-NativeSuccess 'PROVISIONING_CONTRACT_POSITIVE_FAILED'
    Assert-PowerShellKnownBad `
      -Arguments @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $PSCommandPath, '-ContractTestsOnly', '-KnownBadControl') `
      -ExpectedCode 'PROVISIONING_SELECTED_TERMINAL_INVALID' `
      -FailedOpenCode 'PROVISIONING_CONTRACT_NEGATIVE_FAILED_OPEN' `
      -WrongReasonCode 'PROVISIONING_CONTRACT_NEGATIVE_WRONG_REASON'
    & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $probeDriver -ContractTestsOnly
    Assert-NativeSuccess 'PROVISIONING_PROBE_CONTRACT_POSITIVE_FAILED'
    Assert-PowerShellKnownBad `
      -Arguments @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $probeDriver, '-ContractTestsOnly', '-KnownBadControl') `
      -ExpectedCode 'PROVISIONING_PROBE_RECEIPT_INVALID' `
      -FailedOpenCode 'PROVISIONING_PROBE_CONTRACT_NEGATIVE_FAILED_OPEN' `
      -WrongReasonCode 'PROVISIONING_PROBE_CONTRACT_NEGATIVE_WRONG_REASON'
    & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $allowlistDriver -ContractTestsOnly
    Assert-NativeSuccess 'PROVISIONING_WEBREQUEST_ALLOWLIST_CONTRACT_POSITIVE_FAILED'
    Assert-PowerShellKnownBad `
      -Arguments @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $allowlistDriver, '-ContractTestsOnly', '-KnownBadControl') `
      -ExpectedCode 'PROVISIONING_WEBREQUEST_ALLOWLIST_SCHEMA_INVALID' `
      -FailedOpenCode 'PROVISIONING_WEBREQUEST_ALLOWLIST_CONTRACT_NEGATIVE_FAILED_OPEN' `
      -WrongReasonCode 'PROVISIONING_WEBREQUEST_ALLOWLIST_CONTRACT_NEGATIVE_WRONG_REASON'
    Assert-PowerShellKnownBad `
      -Arguments @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $allowlistDriver, '-ContractTestsOnly', '-UnreadableInputControl') `
      -ExpectedCode 'PROVISIONING_WEBREQUEST_ALLOWLIST_CONFIG_UNREADABLE' `
      -FailedOpenCode 'PROVISIONING_WEBREQUEST_ALLOWLIST_UNREADABLE_CONTROL_FAILED_OPEN' `
      -WrongReasonCode 'PROVISIONING_WEBREQUEST_ALLOWLIST_UNREADABLE_CONTROL_WRONG_REASON'
    Assert-PowerShellKnownBad `
      -Arguments @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $allowlistDriver, '-ContractTestsOnly', '-OccupiedPortControl') `
      -ExpectedCode 'PROVISIONING_WEBREQUEST_PORT80_OCCUPIED' `
      -FailedOpenCode 'PROVISIONING_WEBREQUEST_ALLOWLIST_OCCUPIED_CONTROL_FAILED_OPEN' `
      -WrongReasonCode 'PROVISIONING_WEBREQUEST_ALLOWLIST_OCCUPIED_CONTROL_WRONG_REASON'
    Assert-PowerShellKnownBad `
      -Arguments @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $allowlistDriver, '-ContractTestsOnly', '-MouseHitControl') `
      -ExpectedCode 'PROVISIONING_WEBREQUEST_ALLOWLIST_MOUSE_INVALID' `
      -FailedOpenCode 'PROVISIONING_WEBREQUEST_ALLOWLIST_MOUSE_CONTROL_FAILED_OPEN' `
      -WrongReasonCode 'PROVISIONING_WEBREQUEST_ALLOWLIST_MOUSE_CONTROL_WRONG_REASON'
    Assert-PowerShellKnownBad `
      -Arguments @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $allowlistDriver, '-ContractTestsOnly', '-CursorRestoreControl') `
      -ExpectedCode 'PROVISIONING_WEBREQUEST_ALLOWLIST_CURSOR_RESTORE_FAILED' `
      -FailedOpenCode 'PROVISIONING_WEBREQUEST_ALLOWLIST_CURSOR_CONTROL_FAILED_OPEN' `
      -WrongReasonCode 'PROVISIONING_WEBREQUEST_ALLOWLIST_CURSOR_CONTROL_WRONG_REASON'
    Invoke-AllowlistMutationTests
    Invoke-ProbeMutationTests
    Invoke-MouseMutationTests
  }

  Invoke-GauntletLayer 'go-quality' {
    $unformatted = @(& gofmt.exe -l (Join-Path $backendRoot '.'))
    Assert-NativeSuccess 'PROVISIONING_GOFMT_FAILED'
    Assert-Gate ($unformatted.Count -eq 0) 'PROVISIONING_GOFMT_DIRTY'
    Invoke-InDirectory $backendRoot {
      & go vet ./...
      Assert-NativeSuccess 'PROVISIONING_GO_VET_FAILED'
      & go test ./... -shuffle=on -count=1
      Assert-NativeSuccess 'PROVISIONING_GO_SHUFFLED_TESTS_FAILED'
      & go test ./... -count=1
      Assert-NativeSuccess 'PROVISIONING_GO_TESTS_FAILED'
      & go test -race ./... -count=1
      Assert-NativeSuccess 'PROVISIONING_GO_RACE_FAILED'
    }
  }

  Invoke-GauntletLayer 'go-migration-gate-coverage' {
    $mainPath = Join-Path $backendRoot 'cmd\mt5-migration-gate\main.go'
    $originalBytes = [IO.File]::ReadAllBytes($mainPath)
    $originalHash = (Get-FileHash -LiteralPath $mainPath -Algorithm SHA256).Hash
    $originalText = ([Text.Encoding]::UTF8.GetString($originalBytes)).Replace("`r`n", "`n")
    Assert-Gate (
      [regex]::Matches($originalText, '(?m)^func main\(\) \{\}$').Count -eq 1
    ) 'PROVISIONING_GO_MAIN_SOURCE_UNEXPECTED'
    Invoke-InDirectory $backendRoot {
      & go test ./cmd/mt5-migration-gate -run '^TestProductionCommandMainIsInert$' -count=1
      Assert-NativeSuccess 'PROVISIONING_GO_FOCUSED_TEST_FAILED'
    }
    $mutantText = $originalText.Replace(
      'func main() {}',
      'func main() { panic("PROVISIONING_MAIN_MUTANT") }'
    )
    Assert-Gate (-not [string]::Equals($mutantText, $originalText, [StringComparison]::Ordinal)) `
      'PROVISIONING_GO_MAIN_MUTANT_NOT_APPLIED'
    try {
      [IO.File]::WriteAllBytes($mainPath, [Text.Encoding]::UTF8.GetBytes($mutantText))
      $mutantHash = (Get-FileHash -LiteralPath $mainPath -Algorithm SHA256).Hash
      Assert-Gate ($mutantHash -cne $originalHash) 'PROVISIONING_GO_MAIN_MUTANT_NOT_APPLIED'
      $savedErrorActionPreference = $ErrorActionPreference
      try {
        $ErrorActionPreference = 'Continue'
        $mutantOutput = @(Invoke-InDirectory $backendRoot {
          & go test ./cmd/mt5-migration-gate -run '^TestProductionCommandMainIsInert$' -count=1 2>&1
        })
        $mutantExitCode = $LASTEXITCODE
      } finally {
        $ErrorActionPreference = $savedErrorActionPreference
      }
      Assert-Gate ($mutantExitCode -ne 0) 'PROVISIONING_GO_MAIN_MUTANT_SURVIVED'
      Assert-Gate (($mutantOutput -join "`n").Contains('PROVISIONING_MAIN_MUTANT')) `
        'PROVISIONING_GO_MAIN_MUTANT_WRONG_REASON'
    } finally {
      [IO.File]::WriteAllBytes($mainPath, $originalBytes)
    }
    $restoredHash = (Get-FileHash -LiteralPath $mainPath -Algorithm SHA256).Hash
    Assert-Gate ($restoredHash -ceq $originalHash) 'PROVISIONING_GO_MAIN_RESTORE_HASH_MISMATCH'
    & git -C $repoRoot diff --quiet -- 'backend/cmd/mt5-migration-gate/main.go'
    Assert-NativeSuccess 'PROVISIONING_GO_MAIN_WORKTREE_DIRTY'
    & git -C $repoRoot diff --cached --quiet -- 'backend/cmd/mt5-migration-gate/main.go'
    Assert-NativeSuccess 'PROVISIONING_GO_MAIN_INDEX_DIRTY'
    Invoke-InDirectory $backendRoot {
      & go test ./cmd/mt5-migration-gate -run '^TestProductionCommandMainIsInert$' -count=1
      Assert-NativeSuccess 'PROVISIONING_GO_FOCUSED_RESTORE_TEST_FAILED'
    }
    Write-Output 'PROVISIONING_GO_MAIN_MUTANT=KILLED'
  }

  Invoke-GauntletLayer 'python-managed-suites' {
    $savedPythonUtf8 = [Environment]::GetEnvironmentVariable('PYTHONUTF8', 'Process')
    try {
      [Environment]::SetEnvironmentVariable('PYTHONUTF8', '1', 'Process')
      $managedModules = @(Get-ChildItem -LiteralPath (Join-Path $repoRoot 'backend\bridge\mt5_vm') `
        -File -Filter 'test_*.py' | Sort-Object -Property Name | ForEach-Object {
          'backend.bridge.mt5_vm.' + $_.BaseName
        })
      $eaModules = @(Get-ChildItem -LiteralPath (Join-Path $repoRoot 'backend\bridge\mt5_ea') `
        -File -Filter 'test_*.py' | Sort-Object -Property Name | ForEach-Object {
          'backend.bridge.mt5_ea.' + $_.BaseName
        })
      Assert-Gate ($managedModules.Count -gt 0) 'PROVISIONING_PYTHON_MANAGED_DISCOVERY_EMPTY'
      Assert-Gate ($eaModules.Count -gt 0) 'PROVISIONING_PYTHON_EA_DISCOVERY_EMPTY'
      Invoke-InDirectory $repoRoot {
        & python.exe -m unittest -v @managedModules
        Assert-NativeSuccess 'PROVISIONING_PYTHON_MANAGED_TESTS_FAILED'
        & python.exe -m unittest -v @eaModules
        Assert-NativeSuccess 'PROVISIONING_PYTHON_EA_TESTS_FAILED'
      }
    } finally {
      [Environment]::SetEnvironmentVariable('PYTHONUTF8', $savedPythonUtf8, 'Process')
    }
  }

  Invoke-GauntletLayer 'rust-quality' {
    Invoke-InDirectory $executionRoot {
      & cargo fmt --all -- --check
      Assert-NativeSuccess 'PROVISIONING_RUST_FMT_FAILED'
      & cargo check --workspace --locked
      Assert-NativeSuccess 'PROVISIONING_RUST_CHECK_FAILED'
      & cargo clippy --workspace --all-targets --locked -- -D warnings
      Assert-NativeSuccess 'PROVISIONING_RUST_CLIPPY_FAILED'
      & cargo test --workspace --locked
      Assert-NativeSuccess 'PROVISIONING_RUST_TESTS_FAILED'
      & cargo test -p mt5-vm-agent --locked
      Assert-NativeSuccess 'PROVISIONING_RUST_AGENT_TESTS_FAILED'
    }
  }

  Invoke-GauntletLayer 'frontend-quality' {
    Invoke-InDirectory $frontendRoot {
      & npm.cmd run typecheck
      Assert-NativeSuccess 'PROVISIONING_FRONTEND_TYPECHECK_FAILED'
      & npm.cmd run lint
      Assert-NativeSuccess 'PROVISIONING_FRONTEND_LINT_FAILED'
      & npm.cmd run test:trade
      Assert-NativeSuccess 'PROVISIONING_FRONTEND_TRADE_TESTS_FAILED'
      & npm.cmd run build
      Assert-NativeSuccess 'PROVISIONING_FRONTEND_BUILD_FAILED'
    }
  }

  Invoke-GauntletLayer 'backend-docs' {
    & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass `
      -File (Join-Path $repoRoot 'tools\verify-backend-docs.ps1')
    Assert-NativeSuccess 'PROVISIONING_BACKEND_DOCS_FAILED'
  }

  Invoke-GauntletLayer 'managed-worker-contracts' {
    Invoke-InDirectory $repoRoot {
      & python.exe -m unittest -v `
        backend.bridge.mt5_vm.test_baremetal_worker_install `
        backend.bridge.mt5_vm.test_production_webrequest_probe
      Assert-NativeSuccess 'PROVISIONING_WORKER_CONTRACTS_FAILED'
    }
    foreach ($path in @(
      (Join-Path $repoRoot 'tools\Install-ProductionManagedWorker.ps1'),
      (Join-Path $repoRoot 'tools\mt5-baremetal\Install-MT5BareMetalWorker.ps1'),
      (Join-Path $repoRoot 'tools\mt5-baremetal\Ensure-MT5BareMetalWorkerReady.ps1')
    )) { Assert-PowerShellParses -Path $path }
  }

  Invoke-GauntletLayer 'postgresql-preflight' {
    Assert-PostgreSqlProductionState
  }

  Invoke-ProvisionHostFlow -Actions @{
    Preflight = {
      Assert-ApprovedSourceState
      Assert-ProvisionSelectedHost
      $paths = @($backendEnvPath,$bootstrapTokenPath,$installInputPath,
        (Join-Path $selectedStateRoot 'config/common.ini'),
        (Join-Path $slotInputRoot 'native-allowlist-state.json'),
        (Join-Path $slotInputRoot 'chart01.chr'), (Join-Path $slotInputRoot 'experts.ini'),
        (Join-Path $slotInputRoot 'webrequest-attestation.json'))
      $script:hostJournal = New-ProvisionJournal $paths (Join-Path $reportRoot 'recovery')
      $script:ProvisionJournal = $script:hostJournal
    }
    Proofs = { Invoke-ProvisionHostProofs }
    Prepare = {
      $null = Write-ProvenTopologyInputs
      $secret = Prepare-BootstrapSecret
      Assert-Gate ($secret.Length -ge 32) 'PROVISIONING_BOOTSTRAP_TOKEN_INVALID'
      $null = Prepare-ManagedWorkerInstallInput
    }
    DryRun = {
      Invoke-GauntletLayer 'live-webrequest-and-host-inputs' { Invoke-ProvisionInstallerDryRun }
    }
    Audit = {
  Invoke-GauntletLayer 'source-diff-secret-audit' {
    Assert-ApprovedSourceState
    $parsed = Read-DotEnv -Path $backendEnvPath
    $bootstrap = [string]$parsed.values['EXECUTION_MT5_VM_BOOTSTRAP_TOKEN']
    $tracked = @(& git -C $repoRoot ls-files)
    Assert-NativeSuccess 'PROVISIONING_GIT_LS_FILES_FAILED'
    foreach ($relative in $tracked) {
      $path = Join-Path $repoRoot $relative
      if (Test-Path -LiteralPath $path -PathType Leaf) {
        $bytes = [IO.File]::ReadAllBytes($path)
        if ($bytes.Length -le 5242880) {
          $text = [Text.Encoding]::UTF8.GetString($bytes)
          Assert-Gate (-not $text.Contains($bootstrap)) 'PROVISIONING_SECRET_IN_TRACKED_SOURCE'
        }
      }
    }
  }

    }
    Runner = {
  Invoke-GauntletLayer 'canonical-production-runner' {
    $before = @(& git -C $repoRoot rev-parse HEAD)
    Assert-NativeSuccess 'PROVISIONING_GIT_HEAD_FAILED'
    & (Join-Path $repoRoot 'run-backend-production.ps1')
    Assert-NativeSuccess 'PROVISIONING_CANONICAL_RUNNER_FAILED'
    $after = @(& git -C $repoRoot rev-parse HEAD)
    Assert-NativeSuccess 'PROVISIONING_GIT_HEAD_FAILED'
    Assert-Gate ($before.Count -eq 1 -and $after.Count -eq 1 -and $before[0] -ceq $after[0]) 'PROVISIONING_SOURCE_CHANGED_DURING_RUNNER'
  }

    }
    Postconditions = {
  Invoke-GauntletLayer 'production-postconditions' {
    Assert-PostgreSqlProductionState
    Assert-ProductionHealth
    $parsed = Read-DotEnv -Path $backendEnvPath
    $receiptPath = [string]$parsed.values['EXECUTION_MT5_MANAGED_WORKER_RECEIPT_FILE']
    Assert-Gate (
      [IO.Path]::IsPathRooted($receiptPath) -and
      (Test-Path -LiteralPath $receiptPath -PathType Leaf)
    ) 'PROVISIONING_MANAGED_WORKER_RECEIPT_MISSING'
    . (Join-Path $repoRoot 'tools\mt5-baremetal\Ensure-MT5BareMetalWorkerReady.ps1')
    $readiness = Invoke-MT5BareMetalWorkerReadiness `
      -ReceiptPath $receiptPath -AdminUrl 'http://127.0.0.1:8791' -TimeoutSeconds 30
    Assert-Gate (
      $readiness.ready -is [bool] -and [bool]$readiness.ready -and
      [string]$readiness.worker_id -ceq $workerId -and [int]$readiness.capacity -ge 1
    ) 'PROVISIONING_MANAGED_WORKER_NOT_READY'
    $dirty = @(& git -C $repoRoot status --porcelain=v1 --untracked-files=all)
    Assert-NativeSuccess 'PROVISIONING_GIT_STATUS_FAILED'
    Assert-Gate ($dirty.Count -eq 0) 'PROVISIONING_POST_RUN_WORKTREE_DIRTY'
    Assert-Gate (@($script:layerResults).Count -eq ($expectedLayers.Count - 1)) `
      'PROVISIONING_LAYER_MANIFEST_INCOMPLETE'
  }

    }
    Rollback = { Undo-ProvisionHostPreparation }
    Complete = { Complete-ProvisionJournal $script:hostJournal }
  }

  Assert-Gate ($script:layerResults.Count -eq $expectedLayers.Count) `
    'PROVISIONING_LAYER_MANIFEST_INCOMPLETE'
  for ($index = 0; $index -lt $expectedLayers.Count; $index++) {
    Assert-Gate ([string]$script:layerResults[$index].name -ceq $expectedLayers[$index]) `
      'PROVISIONING_LAYER_MANIFEST_ORDER_INVALID'
  }
  Write-GauntletReport -Status 'PASS'
  Write-Host "`nPRODUCTION_WORKER_HOST_PROVISION=PASS report=$reportPath" -ForegroundColor Green
} catch {
  Write-GauntletReport -Status 'FAIL'
  throw
}
