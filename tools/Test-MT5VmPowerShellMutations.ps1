[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
$repoPrefix = $repoRoot + [System.IO.Path]::DirectorySeparatorChar
$utf8NoBom = New-Object System.Text.UTF8Encoding($false, $true)

$focusedTests = @(
  'backend.bridge.mt5_vm.test_phase0_probe',
  'backend.bridge.mt5_vm.test_phase1_adapter',
  'backend.bridge.mt5_vm.test_powershell_process_contracts',
  'backend.bridge.mt5_vm.test_terminal_python_api_bootstrap',
  'backend.bridge.mt5_vm.test_live_readonly_matrix',
  'backend.bridge.mt5_vm.test_local_image_automation'
)

$credentialProcessArgumentPattern = (
  '(?m)\$startInfo\.Arguments\s*=.*\$(?:secret|plainPayload|plainPassword|credential)'
)

$mutants = @(
  [ordered]@{
    id = 'M1_REENABLE_UTF8_BOM'
    path = 'backend\bridge\mt5_vm\Mt5VmProcess.ps1'
    before = 'New-Object System.Text.UTF8Encoding($false)'
    after = 'New-Object System.Text.UTF8Encoding($true)'
  },
  [ordered]@{
    id = 'M2_BYPASS_PHASE0_START_HELPER'
    path = 'backend\bridge\mt5_vm\Invoke-MT5VmPhase0.ps1'
    before = 'Start-MT5VmProcessWithUtf8NoBomStandardInput -Process $process'
    after = '$process.Start()'
  },
  [ordered]@{
    id = 'M3_BROADEN_TOLERATED_ACL_EXCEPTION'
    path = 'backend\bridge\mt5_vm\Save-MT5VmPhase0Credential.ps1'
    before = 'if ($candidate -is [Security.AccessControl.PrivilegeNotHeldException]) {'
    after = @'
if ($candidate -is [Security.AccessControl.PrivilegeNotHeldException] -or
        $candidate -is [UnauthorizedAccessException]) {
'@
  },
  [ordered]@{
    id = 'M4_SKIP_ACL_POSTCONDITION_AFTER_PRIVILEGE_ERROR'
    path = 'backend\bridge\mt5_vm\Save-MT5VmPhase0Credential.ps1'
    before = '$effectiveAcl = Get-Acl -LiteralPath $fullCredentialPath'
    after = @'
if ($null -ne $setAclError) {
  Write-Host 'Saved DPAPI-protected disposable demo credential.' -ForegroundColor Green
  return
}
$effectiveAcl = Get-Acl -LiteralPath $fullCredentialPath
'@
  },
  [ordered]@{
    id = 'M5_MATCH_TERMINAL_BY_NAME_ONLY'
    path = 'backend\bridge\mt5_vm\Mt5VmTerminalUi.ps1'
    before = @'
  Assert-MT5VmTrustedTerminalBoundary -TerminalPath $canonicalPath
  $matches = @(Get-MT5VmTerminalProcessesBoundary | Where-Object {
      -not [string]::IsNullOrWhiteSpace([string]$_.ExecutablePath) -and
      [string]::Equals(
        [System.IO.Path]::GetFullPath([string]$_.ExecutablePath),
        $canonicalPath,
        [StringComparison]::OrdinalIgnoreCase
      )
    })
'@
    after = @'
  Assert-MT5VmTrustedTerminalBoundary -TerminalPath $canonicalPath
  $matches = @(Get-MT5VmTerminalProcessesBoundary | Where-Object {
      -not [string]::IsNullOrWhiteSpace([string]$_.ExecutablePath) -and
      [System.IO.Path]::GetFileName([string]$_.ExecutablePath) -eq
        [System.IO.Path]::GetFileName($canonicalPath)
    })
'@
  },
  [ordered]@{
    id = 'M6_SKIP_POST_OK_PERSISTENCE_CHECK'
    path = 'backend\bridge\mt5_vm\Mt5VmTerminalUi.ps1'
    before = 'if (-not (Test-MT5VmPythonApiStateEqual -Left $persisted -Right $desired)) {'
    after = 'if ($false) {'
  },
  [ordered]@{
    id = 'M7_SKIP_IPC_TIMEOUT_ROLLBACK'
    path = 'backend\bridge\mt5_vm\Mt5VmTerminalUi.ps1'
    before = '$rollBack = $null -ne $lastErrorCode -and [int]$lastErrorCode -eq -10005'
    after = '$rollBack = $false'
  },
  [ordered]@{
    id = 'M8_CLOSE_PREEXISTING_TERMINAL'
    path = 'backend\bridge\mt5_vm\Mt5VmTerminalUi.ps1'
    before = @'
    if ($null -ne $target -and [bool]$target.WasStarted) {
      $ownedProcessId = if ($null -ne $activeTarget) {
'@
    after = @'
    if ($null -ne $target) {
      $ownedProcessId = if ($null -ne $activeTarget) {
'@
  },
  [ordered]@{
    id = 'M9_BLOCK_ON_MODAL_OPTIONS_COMMAND'
    path = 'backend\bridge\mt5_vm\Mt5VmTerminalUi.ps1'
    before = @'
  if (-not [Mt5VmTerminalUiNative]::PostMessage(
    [IntPtr]$process.MainWindowHandle,
    $constants.WmCommand,
    [IntPtr]$constants.ToolsOptionsCommand,
    [IntPtr]::Zero
  )) {
'@
    after = @'
  if (-not [Mt5VmTerminalUiNative]::SendMessage(
    [IntPtr]$process.MainWindowHandle,
    $constants.WmCommand,
    [IntPtr]$constants.ToolsOptionsCommand,
    [IntPtr]::Zero
  )) {
'@
  },
  [ordered]@{
    id = 'M10_RESTART_WITHOUT_OPT_IN_SWITCH'
    path = 'backend\bridge\mt5_vm\Mt5VmTerminalUi.ps1'
    before = @'
    if ($RestartTerminalAfterSettings) {
      try {
        Close-MT5VmTerminalForRestartBoundary `
'@
    after = @'
    if ($true) {
      try {
        Close-MT5VmTerminalForRestartBoundary `
'@
  },
  [ordered]@{
    id = 'M11_ROLLBACK_RESTART_USING_STALE_PID'
    path = 'backend\bridge\mt5_vm\Mt5VmTerminalUi.ps1'
    before = @'
      if ($rollBack) {
        $null = Restore-MT5VmTerminalPythonApiSettings `
          -ProcessId ([int]$activeTarget.ProcessId) `
          -State $transaction.PriorState
      }
'@
    after = @'
      if ($rollBack) {
        $null = Restore-MT5VmTerminalPythonApiSettings `
          -ProcessId ([int]$target.ProcessId) `
          -State $transaction.PriorState
      }
'@
  },
  [ordered]@{
    id = 'M12_SKIP_RESTARTED_PATH_VERIFICATION'
    path = 'backend\bridge\mt5_vm\Mt5VmTerminalUi.ps1'
    before = @'
        if ($null -eq $candidateTarget -or
            $null -eq $candidateTarget.PSObject.Properties['TerminalPath'] -or
            $null -eq $candidateTarget.PSObject.Properties['ProcessId'] -or
            [int]$candidateTarget.ProcessId -eq [int]$target.ProcessId -or
            -not [string]::Equals(
              [System.IO.Path]::GetFullPath([string]$candidateTarget.TerminalPath),
              [System.IO.Path]::GetFullPath([string]$target.TerminalPath),
              [StringComparison]::OrdinalIgnoreCase
            )) {
          throw 'The restarted MT5 process failed exact path and PID verification.'
        }
'@
    after = @'
        if ($false) {
          throw 'The restarted MT5 process failed exact path and PID verification.'
        }
'@
  },
  [ordered]@{
    id = 'M13_FORCE_CLOSE_RESTART_TARGET'
    path = 'backend\bridge\mt5_vm\Mt5VmTerminalUi.ps1'
    before = 'Close-MT5VmOwnedTerminalBoundary -ProcessId $ProcessId'
    after = 'Stop-Process -Id $ProcessId -Force'
  },
  [ordered]@{
    id = 'M14_REMOVE_PHASE0_INITIALIZE_CREDENTIALS'
    path = 'backend\bridge\mt5_vm\phase0_probe.py'
    before = @'
            mt5.initialize(
                cfg["terminal_path"],
                login=cfg["login"],
                password=cfg["password"],
                server=cfg["server"],
'@
    after = @'
            mt5.initialize(
                cfg["terminal_path"],
'@
  },
  [ordered]@{
    id = 'M15_REDUCE_PHASE0_TIMEOUT_BOUND'
    path = 'backend\bridge\mt5_vm\phase0_probe.py'
    before = 'if timeout_ms < 1000 or timeout_ms > 60_000:'
    after = 'if timeout_ms < 1000 or timeout_ms > 12_000:'
  },
  [ordered]@{
    id = 'M16_ACCEPT_WRONG_PHASE0_TERMINAL_PATH'
    path = 'backend\bridge\mt5_vm\phase0_probe.py'
    before = @'
    return ntpath.normcase(candidate) == ntpath.normcase(
        ntpath.normpath(requested_executable)
    )
'@
    after = '    return True'
  },
  [ordered]@{
    id = 'M17_LEAK_IDENTITY_TO_CHILD_ARGUMENT'
    path = 'backend\bridge\mt5_vm\Invoke-MT5VmPhase0.ps1'
    before = '$startInfo.Arguments = ''"'' + $probePath + ''"'''
    after = '$startInfo.Arguments = ''"'' + $probePath + ''" '' + [string]$secret.login'
  },
  [ordered]@{
    id = 'M18_SKIP_LIVE_MATRIX_TOPOLOGY_RESTORE'
    path = 'backend\bridge\mt5_vm\Invoke-MT5VmLiveReadonlyMatrix.ps1'
    before = @'
    for ($index = 0; $index -lt 2; $index++) {
      Set-MT5VmLiveReadonlyMatrixPresenceBoundary `
        -TerminalPath $canonicalPaths[$index] `
        -Present ([bool]$initial[$index].Present)
    }
'@
    after = '    # Mutant skips restoration of the initial process topology.'
  },
  [ordered]@{
    id = 'M19_SKIP_INSTALLER_HASH_VERIFICATION'
    path = 'tools\mt5-vm-image\Install-MT5VmTerminalSlots.ps1'
    before = @'
  if (-not [string]::Equals(
      [string]$attestation.sha256,
      $ExpectedInstallerSha256,
      [StringComparison]::OrdinalIgnoreCase
    )) {
    throw 'INSTALLER_HASH_MISMATCH'
  }
'@
    after = @'
  if ($false) {
    throw 'INSTALLER_HASH_MISMATCH'
  }
'@
  },
  [ordered]@{
    id = 'M20_ACCEPT_INVALID_INSTALLER_SIGNER'
    path = 'tools\mt5-vm-image\Install-MT5VmTerminalSlots.ps1'
    before = @'
  if ($attestation.signature_status -ne 'Valid' -or
      [string]$attestation.signer_subject -notmatch $ExpectedSignerPattern) {
    throw 'INSTALLER_SIGNER_MISMATCH'
  }
'@
    after = @'
  if ($false) {
    throw 'INSTALLER_SIGNER_MISMATCH'
  }
'@
  },
  [ordered]@{
    id = 'M21_PUBLISH_IMAGE_BEFORE_ATTESTATION'
    path = 'tools\mt5-vm-image\New-MT5VmGoldenImage.ps1'
    before = @'
    Invoke-MT5VmImageProvisionBoundary -Stage $stage -ImageVersion $ImageVersion
    if (-not (Test-MT5VmImageAttestationBoundary -Stage $stage)) {
'@
    after = @'
    Invoke-MT5VmImageProvisionBoundary -Stage $stage -ImageVersion $ImageVersion
    Publish-MT5VmImageBoundary `
      -Stage $stage -PublishedRoot $published -ImageVersion $ImageVersion
    if (-not (Test-MT5VmImageAttestationBoundary -Stage $stage)) {
'@
  },
  [ordered]@{
    id = 'M22_ADD_INSTALLER_CAPABILITY_TO_ACCOUNT_RUNTIME'
    path = 'backend\bridge\mt5_vm\phase1_adapter.py'
    before = 'from __future__ import annotations'
    after = @'
from __future__ import annotations
# mt5setup /auto is a forbidden account-runtime capability mutant.
'@
  },
  [ordered]@{
    id = 'M23_DUPLICATE_CONCURRENT_CLONE'
    path = 'tools\mt5-vm-image\New-MT5VmHyperVWorker.ps1'
    before = '    if ($state.generation_exists) {'
    after = '    if ($false) {'
  },
  [ordered]@{
    id = 'M24_PARTIAL_SERVER_MATCH'
    path = 'backend\bridge\mt5_vm\Mt5VmTerminalUi.ps1'
    before = @'
    if ([string]::Equals(
        [string]$Candidates[$index], $Expected, [StringComparison]::Ordinal
      )) {
'@
    after = @'
    if ([string]$Candidates[$index] -like ('*' + $Expected + '*')) {
'@
  },
  [ordered]@{
    id = 'M25_ACCEPT_STALE_SERVER_CATALOG'
    path = 'backend\bridge\mt5_vm\Mt5VmTerminalUi.ps1'
    before = '$catalog.LastWriteTimeUtc -lt $NotBeforeUtc'
    after = '$false'
  },
  [ordered]@{
    id = 'M26_LEAK_SERVER_TO_CHILD_ARGUMENT'
    path = 'backend\bridge\mt5_vm\Invoke-MT5VmPhase0.ps1'
    before = '$startInfo.Arguments = ''"'' + $probePath + ''"'''
    after = '$startInfo.Arguments = ''"'' + $probePath + ''" '' + [string]$secret.server'
  }
)

$killed = 0
foreach ($mutant in $mutants) {
  $target = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $mutant.path))
  if (-not $target.StartsWith($repoPrefix, [StringComparison]::OrdinalIgnoreCase) -or
      -not (Test-Path -LiteralPath $target -PathType Leaf)) {
    throw "Mutation target is invalid: $($mutant.id)"
  }
  $targetItem = Get-Item -LiteralPath $target -Force
  if ($targetItem.Attributes -band [IO.FileAttributes]::ReparsePoint) {
    throw "Mutation target cannot be a reparse point: $($mutant.id)"
  }

  $originalBytes = [System.IO.File]::ReadAllBytes($target)
  if ($originalBytes.Length -ge 3 -and
      $originalBytes[0] -eq 0xEF -and
      $originalBytes[1] -eq 0xBB -and
      $originalBytes[2] -eq 0xBF) {
    throw "Mutation runner requires BOM-free UTF-8 source: $($mutant.id)"
  }
  $originalHash = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash
  $originalText = $utf8NoBom.GetString($originalBytes)
  $occurrences = ([Regex]::Matches(
      $originalText,
      [Regex]::Escape([string]$mutant.before)
    )).Count
  if ($occurrences -ne 1) {
    throw "Mutation anchor count for $($mutant.id) was $occurrences, expected 1."
  }
  $mutatedText = $originalText.Replace([string]$mutant.before, [string]$mutant.after)

  try {
    [System.IO.File]::WriteAllText($target, $mutatedText, $utf8NoBom)
    $mutatedHash = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash
    if ($mutatedHash -eq $originalHash) {
      throw "Mutation did not change source bytes: $($mutant.id)"
    }

    if ($mutatedText -match $credentialProcessArgumentPattern) {
      $testOutput = 'credential process-argument gate rejected the mutant'
      $testExit = 1
    } else {
      $previousErrorPreference = $ErrorActionPreference
      try {
        $ErrorActionPreference = 'Continue'
        $testOutput = & python -m unittest @focusedTests -v 2>&1
        $testExit = $LASTEXITCODE
      } finally {
        $ErrorActionPreference = $previousErrorPreference
      }
    }
    if ($testExit -eq 0) {
      throw "SURVIVED: $($mutant.id)"
    }
    Write-Host "KILLED: $($mutant.id)" -ForegroundColor Green
    $killed += 1
  } finally {
    [System.IO.File]::WriteAllBytes($target, $originalBytes)
    $restoredBytes = [System.IO.File]::ReadAllBytes($target)
    if ([Convert]::ToBase64String($originalBytes) -ne
        [Convert]::ToBase64String($restoredBytes)) {
      throw "Mutation restore was not byte-exact: $($mutant.id)"
    }
  }
}

if ($killed -ne $mutants.Count) {
  throw "Mutation score was $killed/$($mutants.Count)."
}
Write-Host "MUTATION_OK=$killed/$($mutants.Count)" -ForegroundColor Green
