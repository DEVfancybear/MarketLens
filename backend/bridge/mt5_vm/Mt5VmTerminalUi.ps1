Set-StrictMode -Version Latest

if (-not ('Mt5VmTerminalUiNative' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class Mt5VmTerminalUiNative {
  public delegate bool EnumWindowsProc(IntPtr window, IntPtr parameter);

  [DllImport("user32.dll")]
  public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr parameter);

  [DllImport("user32.dll")]
  public static extern bool EnumChildWindows(
    IntPtr parent,
    EnumWindowsProc callback,
    IntPtr parameter
  );

  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

  [DllImport("user32.dll")]
  public static extern bool IsWindow(IntPtr window);

  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr window);

  [DllImport("user32.dll")]
  public static extern bool IsWindowEnabled(IntPtr window);

  [DllImport("user32.dll")]
  public static extern IntPtr GetDlgItem(IntPtr dialog, int controlId);

  [DllImport("user32.dll")]
  public static extern int GetDlgCtrlID(IntPtr window);

  [DllImport("user32.dll", CharSet = CharSet.Auto)]
  public static extern IntPtr SendMessage(
    IntPtr window,
    uint message,
    IntPtr wParam,
    IntPtr lParam
  );

  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool PostMessage(
    IntPtr window,
    uint message,
    IntPtr wParam,
    IntPtr lParam
  );

  public static IntPtr[] TopWindowsForProcess(uint wantedProcessId) {
    var windows = new List<IntPtr>();
    EnumWindows(delegate(IntPtr window, IntPtr parameter) {
      uint processId;
      GetWindowThreadProcessId(window, out processId);
      if (processId == wantedProcessId) {
        windows.Add(window);
      }
      return true;
    }, IntPtr.Zero);
    return windows.ToArray();
  }

  public static IntPtr[] DescendantsWithControlId(IntPtr parent, int wantedControlId) {
    var controls = new List<IntPtr>();
    EnumChildWindows(parent, delegate(IntPtr window, IntPtr parameter) {
      if (GetDlgCtrlID(window) == wantedControlId) {
        controls.Add(window);
      }
      return true;
    }, IntPtr.Zero);
    return controls.ToArray();
  }
}
'@
}

function Get-MT5VmTerminalUiConstants {
  return [ordered]@{
    WmClose = 0x0010
    WmCommand = 0x0111
    WmKeyDown = 0x0100
    WmKeyUp = 0x0101
    BmGetCheck = 0x00F0
    BmSetCheck = 0x00F1
    BmClick = 0x00F5
    TcmGetCurrentSelection = 0x130B
    VirtualKeyLeft = 0x25
    VirtualKeyRight = 0x27
    ToolsOptionsCommand = 32849
    OptionsTabControl = 12320
    ExpertAdvisorsTabIndex = 3
    LoginPasswordControl = 10138
    DialogOk = 1
    DialogCancel = 2
    AllowAlgorithmicTrading = 10309
    DisableExternalPythonApi = 11072
    AllowDllImports = 10320
    AllowWebRequest = 10322
  }
}

function ConvertTo-MT5VmPythonApiState {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [object]$State
  )

  $normalized = [ordered]@{}
  foreach ($name in @(
      'AllowAlgorithmicTrading',
      'DisableExternalPythonApi',
      'AllowDllImports',
      'AllowWebRequest'
    )) {
    $property = $State.PSObject.Properties[$name]
    if ($null -eq $property -or $property.Value -notin 0, 1) {
      throw "MT5 Python API state is missing a boolean value for $name."
    }
    $normalized[$name] = [int]$property.Value
  }
  return [pscustomobject]$normalized
}

function Get-MT5VmDesiredPythonApiState {
  return [pscustomobject][ordered]@{
    AllowAlgorithmicTrading = 1
    DisableExternalPythonApi = 0
    AllowDllImports = 0
    AllowWebRequest = 0
  }
}

function Test-MT5VmPythonApiStateEqual {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][object]$Left,
    [Parameter(Mandatory = $true)][object]$Right
  )

  $normalizedLeft = ConvertTo-MT5VmPythonApiState -State $Left
  $normalizedRight = ConvertTo-MT5VmPythonApiState -State $Right
  foreach ($name in @(
      'AllowAlgorithmicTrading',
      'DisableExternalPythonApi',
      'AllowDllImports',
      'AllowWebRequest'
    )) {
    if ([int]$normalizedLeft.$name -ne [int]$normalizedRight.$name) {
      return $false
    }
  }
  return $true
}

function Get-MT5VmTerminalPathHash {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$TerminalPath
  )

  $canonical = [System.IO.Path]::GetFullPath($TerminalPath).ToUpperInvariant()
  $bytes = [Text.Encoding]::UTF8.GetBytes($canonical)
  $sha256 = [Security.Cryptography.SHA256]::Create()
  try {
    return ([BitConverter]::ToString($sha256.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant()
  } finally {
    $sha256.Dispose()
  }
}

function Assert-MT5VmTrustedTerminalBoundary {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$TerminalPath
  )

  if (-not (Test-Path -LiteralPath $TerminalPath -PathType Leaf)) {
    throw 'The configured MT5 terminal executable does not exist.'
  }
  $item = Get-Item -LiteralPath $TerminalPath -Force
  if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
    throw 'The configured MT5 terminal executable cannot be a reparse point.'
  }
  $signature = Get-AuthenticodeSignature -LiteralPath $TerminalPath
  if ($signature.Status -ne [Management.Automation.SignatureStatus]::Valid -or
      $null -eq $signature.SignerCertificate -or
      [string]$signature.SignerCertificate.Subject -notmatch 'MetaQuotes') {
    throw 'The configured MT5 terminal does not have a valid MetaQuotes Authenticode signature.'
  }
  $company = [string]$item.VersionInfo.CompanyName
  if ($company -notmatch 'MetaQuotes') {
    throw 'The configured executable is not identified as a MetaQuotes terminal.'
  }
}

function Get-MT5VmTerminalProcessesBoundary {
  [CmdletBinding()]
  param()

  return @(Get-CimInstance Win32_Process -Filter "Name='terminal64.exe'" | ForEach-Object {
      [pscustomobject]@{
        ProcessId = [int]$_.ProcessId
        ExecutablePath = [string]$_.ExecutablePath
      }
    })
}

function Start-MT5VmTerminalBoundary {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$TerminalPath
  )

  return Start-Process -FilePath $TerminalPath -PassThru
}

function Wait-MT5VmTerminalProcessBoundary {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$TerminalPath,
    [Parameter(Mandatory = $true)][int]$ProcessId
  )

  for ($attempt = 0; $attempt -lt 75; $attempt++) {
    $matches = @(Get-MT5VmTerminalProcessesBoundary | Where-Object {
        -not [string]::IsNullOrWhiteSpace([string]$_.ExecutablePath) -and
        [int]$_.ProcessId -eq $ProcessId -and
        [string]::Equals(
          [System.IO.Path]::GetFullPath([string]$_.ExecutablePath),
          $TerminalPath,
          [StringComparison]::OrdinalIgnoreCase
        )
      })
    if ($matches.Count -eq 1) {
      $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
      if ($null -ne $process -and $process.MainWindowHandle -ne 0 -and $process.Responding) {
        return $matches[0]
      }
    }
    Start-Sleep -Milliseconds 200
  }
  throw 'The owned MT5 terminal did not become ready in time.'
}

function Resolve-MT5VmTerminalProcess {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$TerminalPath
  )

  $canonicalPath = [System.IO.Path]::GetFullPath($TerminalPath)
  Assert-MT5VmTrustedTerminalBoundary -TerminalPath $canonicalPath
  $matches = @(Get-MT5VmTerminalProcessesBoundary | Where-Object {
      -not [string]::IsNullOrWhiteSpace([string]$_.ExecutablePath) -and
      [string]::Equals(
        [System.IO.Path]::GetFullPath([string]$_.ExecutablePath),
        $canonicalPath,
        [StringComparison]::OrdinalIgnoreCase
      )
    })
  if ($matches.Count -gt 1) {
    throw 'Multiple MT5 terminal processes match the exact configured path.'
  }
  if ($matches.Count -eq 1) {
    return [pscustomobject]@{
      TerminalPath = $canonicalPath
      ProcessId = [int]$matches[0].ProcessId
      WasStarted = $false
    }
  }

  $started = Start-MT5VmTerminalBoundary -TerminalPath $canonicalPath
  if ($null -eq $started -or $null -eq $started.PSObject.Properties['Id']) {
    throw 'The configured MT5 terminal could not be started.'
  }
  $ready = Wait-MT5VmTerminalProcessBoundary `
    -TerminalPath $canonicalPath `
    -ProcessId ([int]$started.Id)
  if ($null -eq $ready -or
      [int]$ready.ProcessId -ne [int]$started.Id -or
      [string]::IsNullOrWhiteSpace([string]$ready.ExecutablePath) -or
      -not [string]::Equals(
        [System.IO.Path]::GetFullPath([string]$ready.ExecutablePath),
        $canonicalPath,
        [StringComparison]::OrdinalIgnoreCase
      )) {
    throw 'The started MT5 terminal did not resolve to the exact configured path.'
  }
  return [pscustomobject]@{
    TerminalPath = $canonicalPath
    ProcessId = [int]$ready.ProcessId
    WasStarted = $true
  }
}

function Get-MT5VmTopWindowHandlesBoundary {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][int]$ProcessId
  )

  return @([Mt5VmTerminalUiNative]::TopWindowsForProcess([uint32]$ProcessId))
}

function Get-MT5VmVisibleDialogsByControlId {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][int]$ProcessId,
    [Parameter(Mandatory = $true)][int]$ControlId
  )

  $matches = @()
  foreach ($window in @(Get-MT5VmTopWindowHandlesBoundary -ProcessId $ProcessId)) {
    $handle = [IntPtr]$window
    if ([Mt5VmTerminalUiNative]::IsWindowVisible($handle) -and
        [Mt5VmTerminalUiNative]::GetDlgItem($handle, $ControlId) -ne [IntPtr]::Zero) {
      $matches += $handle
    }
  }
  return @($matches)
}

function Get-MT5VmUniqueControlHandleBoundary {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][IntPtr]$OptionsHandle,
    [Parameter(Mandatory = $true)][int]$ControlId
  )

  $matches = @([Mt5VmTerminalUiNative]::DescendantsWithControlId(
      $OptionsHandle,
      $ControlId
    ))
  if ($matches.Count -ne 1) {
    throw "The MT5 Options dialog must contain exactly one required control ($ControlId)."
  }
  return [IntPtr]$matches[0]
}

function Open-MT5VmOptionsDialogBoundary {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][int]$ProcessId
  )

  $constants = Get-MT5VmTerminalUiConstants
  $options = @(Get-MT5VmVisibleDialogsByControlId `
      -ProcessId $ProcessId `
      -ControlId $constants.OptionsTabControl)
  if ($options.Count -gt 1) {
    throw 'Multiple MT5 Options dialogs are visible for the selected terminal.'
  }
  if ($options.Count -eq 1) {
    return [IntPtr]$options[0]
  }

  $loginDialogs = @(Get-MT5VmVisibleDialogsByControlId `
      -ProcessId $ProcessId `
      -ControlId $constants.LoginPasswordControl)
  if ($loginDialogs.Count -gt 1) {
    throw 'Multiple MT5 login dialogs obstruct the selected terminal.'
  }
  if ($loginDialogs.Count -eq 1) {
    $login = [IntPtr]$loginDialogs[0]
    if (-not [Mt5VmTerminalUiNative]::IsWindowEnabled($login)) {
      throw 'A disabled MT5 login dialog obstructs the selected terminal.'
    }
    $cancel = [Mt5VmTerminalUiNative]::GetDlgItem($login, $constants.DialogCancel)
    if ($cancel -eq [IntPtr]::Zero) {
      throw 'The obstructing MT5 login dialog has no Cancel control.'
    }
    if (-not [Mt5VmTerminalUiNative]::PostMessage(
      $cancel,
      $constants.BmClick,
      [IntPtr]::Zero,
      [IntPtr]::Zero
    )) {
      throw 'The obstructing MT5 login dialog rejected Cancel.'
    }
    for ($attempt = 0; $attempt -lt 25; $attempt++) {
      if (-not [Mt5VmTerminalUiNative]::IsWindowVisible($login)) {
        break
      }
      Start-Sleep -Milliseconds 100
    }
    if ([Mt5VmTerminalUiNative]::IsWindowVisible($login)) {
      throw 'The obstructing MT5 login dialog did not close.'
    }
  }

  $process = Get-Process -Id $ProcessId -ErrorAction Stop
  if ($process.MainWindowHandle -eq 0 -or -not $process.Responding) {
    throw 'The selected MT5 terminal has no responsive main window.'
  }
  if (-not [Mt5VmTerminalUiNative]::PostMessage(
    [IntPtr]$process.MainWindowHandle,
    $constants.WmCommand,
    [IntPtr]$constants.ToolsOptionsCommand,
    [IntPtr]::Zero
  )) {
    throw 'The selected MT5 terminal rejected the Options command.'
  }
  for ($attempt = 0; $attempt -lt 50; $attempt++) {
    Start-Sleep -Milliseconds 100
    $options = @(Get-MT5VmVisibleDialogsByControlId `
        -ProcessId $ProcessId `
        -ControlId $constants.OptionsTabControl)
    if ($options.Count -gt 1) {
      throw 'Multiple MT5 Options dialogs opened for the selected terminal.'
    }
    if ($options.Count -eq 1) {
      return [IntPtr]$options[0]
    }
  }
  throw 'The MT5 Options dialog did not open.'
}

function Select-MT5VmExpertAdvisorsTabBoundary {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][IntPtr]$OptionsHandle
  )

  $constants = Get-MT5VmTerminalUiConstants
  $tab = Get-MT5VmUniqueControlHandleBoundary `
    -OptionsHandle $OptionsHandle `
    -ControlId $constants.OptionsTabControl
  $current = [int][Mt5VmTerminalUiNative]::SendMessage(
    $tab,
    $constants.TcmGetCurrentSelection,
    [IntPtr]::Zero,
    [IntPtr]::Zero
  )
  if ($current -lt 0) {
    throw 'The MT5 Options tab selection could not be read.'
  }
  for ($attempt = 0; $attempt -lt 16 -and
      $current -ne $constants.ExpertAdvisorsTabIndex; $attempt++) {
    $key = if ($current -lt $constants.ExpertAdvisorsTabIndex) {
      $constants.VirtualKeyRight
    } else {
      $constants.VirtualKeyLeft
    }
    [void][Mt5VmTerminalUiNative]::SendMessage(
      $tab,
      $constants.WmKeyDown,
      [IntPtr]$key,
      [IntPtr]::Zero
    )
    [void][Mt5VmTerminalUiNative]::SendMessage(
      $tab,
      $constants.WmKeyUp,
      [IntPtr]$key,
      [IntPtr]::Zero
    )
    Start-Sleep -Milliseconds 100
    $current = [int][Mt5VmTerminalUiNative]::SendMessage(
      $tab,
      $constants.TcmGetCurrentSelection,
      [IntPtr]::Zero,
      [IntPtr]::Zero
    )
  }
  if ($current -ne $constants.ExpertAdvisorsTabIndex) {
    throw 'The MT5 Expert Advisors options tab could not be selected.'
  }
}

function Get-MT5VmPythonApiControlMapBoundary {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][IntPtr]$OptionsHandle
  )

  Select-MT5VmExpertAdvisorsTabBoundary -OptionsHandle $OptionsHandle
  $constants = Get-MT5VmTerminalUiConstants
  return [ordered]@{
    AllowAlgorithmicTrading = Get-MT5VmUniqueControlHandleBoundary `
      -OptionsHandle $OptionsHandle -ControlId $constants.AllowAlgorithmicTrading
    DisableExternalPythonApi = Get-MT5VmUniqueControlHandleBoundary `
      -OptionsHandle $OptionsHandle -ControlId $constants.DisableExternalPythonApi
    AllowDllImports = Get-MT5VmUniqueControlHandleBoundary `
      -OptionsHandle $OptionsHandle -ControlId $constants.AllowDllImports
    AllowWebRequest = Get-MT5VmUniqueControlHandleBoundary `
      -OptionsHandle $OptionsHandle -ControlId $constants.AllowWebRequest
  }
}

function Read-MT5VmPythonApiStateBoundary {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][IntPtr]$OptionsHandle
  )

  $constants = Get-MT5VmTerminalUiConstants
  $controls = Get-MT5VmPythonApiControlMapBoundary -OptionsHandle $OptionsHandle
  $state = [ordered]@{}
  foreach ($name in $controls.Keys) {
    $value = [int][Mt5VmTerminalUiNative]::SendMessage(
      [IntPtr]$controls[$name],
      $constants.BmGetCheck,
      [IntPtr]::Zero,
      [IntPtr]::Zero
    )
    if ($value -notin 0, 1) {
      throw "The MT5 checkbox state is not boolean for $name."
    }
    $state[$name] = $value
  }
  return [pscustomobject]$state
}

function Write-MT5VmPythonApiStateBoundary {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][IntPtr]$OptionsHandle,
    [Parameter(Mandatory = $true)][object]$State
  )

  $normalized = ConvertTo-MT5VmPythonApiState -State $State
  $constants = Get-MT5VmTerminalUiConstants
  $controls = Get-MT5VmPythonApiControlMapBoundary -OptionsHandle $OptionsHandle
  foreach ($name in $controls.Keys) {
    [void][Mt5VmTerminalUiNative]::SendMessage(
      [IntPtr]$controls[$name],
      $constants.BmSetCheck,
      [IntPtr][int]$normalized.$name,
      [IntPtr]::Zero
    )
  }
}

function Close-MT5VmOptionsDialogBoundary {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][IntPtr]$OptionsHandle,
    [Parameter(Mandatory = $true)][int]$ButtonId
  )

  $constants = Get-MT5VmTerminalUiConstants
  $button = Get-MT5VmUniqueControlHandleBoundary `
    -OptionsHandle $OptionsHandle `
    -ControlId $ButtonId
  [void][Mt5VmTerminalUiNative]::SendMessage(
    $button,
    $constants.BmClick,
    [IntPtr]::Zero,
    [IntPtr]::Zero
  )
  for ($attempt = 0; $attempt -lt 50; $attempt++) {
    if (-not [Mt5VmTerminalUiNative]::IsWindow($OptionsHandle) -or
        -not [Mt5VmTerminalUiNative]::IsWindowVisible($OptionsHandle)) {
      return
    }
    Start-Sleep -Milliseconds 100
  }
  throw 'The MT5 Options dialog did not close.'
}

function Confirm-MT5VmOptionsDialogBoundary {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][IntPtr]$OptionsHandle
  )

  $constants = Get-MT5VmTerminalUiConstants
  Close-MT5VmOptionsDialogBoundary `
    -OptionsHandle $OptionsHandle `
    -ButtonId $constants.DialogOk
}

function Cancel-MT5VmOptionsDialogBoundary {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][IntPtr]$OptionsHandle
  )

  $constants = Get-MT5VmTerminalUiConstants
  Close-MT5VmOptionsDialogBoundary `
    -OptionsHandle $OptionsHandle `
    -ButtonId $constants.DialogCancel
}

function Restore-MT5VmTerminalPythonApiSettings {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][int]$ProcessId,
    [Parameter(Mandatory = $true)][object]$State
  )

  $targetState = ConvertTo-MT5VmPythonApiState -State $State
  $activeDialog = [IntPtr]::Zero
  try {
    $activeDialog = Open-MT5VmOptionsDialogBoundary -ProcessId $ProcessId
    Write-MT5VmPythonApiStateBoundary -OptionsHandle $activeDialog -State $targetState
    $pending = Read-MT5VmPythonApiStateBoundary -OptionsHandle $activeDialog
    if (-not (Test-MT5VmPythonApiStateEqual -Left $pending -Right $targetState)) {
      throw 'The MT5 rollback state was not applied before confirmation.'
    }
    Confirm-MT5VmOptionsDialogBoundary -OptionsHandle $activeDialog
    $activeDialog = [IntPtr]::Zero

    $activeDialog = Open-MT5VmOptionsDialogBoundary -ProcessId $ProcessId
    $persisted = Read-MT5VmPythonApiStateBoundary -OptionsHandle $activeDialog
    Cancel-MT5VmOptionsDialogBoundary -OptionsHandle $activeDialog
    $activeDialog = [IntPtr]::Zero
    if (-not (Test-MT5VmPythonApiStateEqual -Left $persisted -Right $targetState)) {
      throw 'The MT5 rollback state did not persist after confirmation.'
    }
    return $persisted
  } catch {
    if ($activeDialog -ne [IntPtr]::Zero) {
      try {
        Cancel-MT5VmOptionsDialogBoundary -OptionsHandle $activeDialog
      } catch {
        # The original fail-closed error remains authoritative.
      }
    }
    throw
  }
}

function Set-MT5VmTerminalPythonApiSettings {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][int]$ProcessId
  )

  $desired = Get-MT5VmDesiredPythonApiState
  $prior = $null
  $activeDialog = [IntPtr]::Zero
  try {
    $activeDialog = Open-MT5VmOptionsDialogBoundary -ProcessId $ProcessId
    $prior = ConvertTo-MT5VmPythonApiState -State (
      Read-MT5VmPythonApiStateBoundary -OptionsHandle $activeDialog
    )
    Write-MT5VmPythonApiStateBoundary -OptionsHandle $activeDialog -State $desired
    $pending = Read-MT5VmPythonApiStateBoundary -OptionsHandle $activeDialog
    if (-not (Test-MT5VmPythonApiStateEqual -Left $pending -Right $desired)) {
      throw 'The approved MT5 Python API state was not applied before confirmation.'
    }
    Confirm-MT5VmOptionsDialogBoundary -OptionsHandle $activeDialog
    $activeDialog = [IntPtr]::Zero

    $activeDialog = Open-MT5VmOptionsDialogBoundary -ProcessId $ProcessId
    $persisted = Read-MT5VmPythonApiStateBoundary -OptionsHandle $activeDialog
    Cancel-MT5VmOptionsDialogBoundary -OptionsHandle $activeDialog
    $activeDialog = [IntPtr]::Zero
    if (-not (Test-MT5VmPythonApiStateEqual -Left $persisted -Right $desired)) {
      throw 'The approved MT5 Python API state did not persist after confirmation.'
    }
    return [pscustomobject]@{
      PriorState = $prior
      AppliedState = ConvertTo-MT5VmPythonApiState -State $persisted
    }
  } catch {
    $originalError = $_.Exception
    if ($activeDialog -ne [IntPtr]::Zero) {
      try {
        Cancel-MT5VmOptionsDialogBoundary -OptionsHandle $activeDialog
      } catch {
        # Continue to the exact-state rollback below when a snapshot exists.
      }
    }
    if ($null -ne $prior) {
      try {
        $null = Restore-MT5VmTerminalPythonApiSettings `
          -ProcessId $ProcessId `
          -State $prior
      } catch {
        throw [InvalidOperationException]::new(
          'MT5_VM_ROLLBACK_FAILED: settings transaction and exact rollback both failed.',
          $originalError
        )
      }
    }
    throw $originalError
  }
}

function Close-MT5VmOwnedTerminalBoundary {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][int]$ProcessId
  )

  $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
  if ($null -eq $process) {
    return
  }
  if ($process.MainWindowHandle -eq 0) {
    throw 'The owned MT5 terminal has no main window for graceful close.'
  }
  $constants = Get-MT5VmTerminalUiConstants
  if (-not [Mt5VmTerminalUiNative]::PostMessage(
      [IntPtr]$process.MainWindowHandle,
      $constants.WmClose,
      [IntPtr]::Zero,
      [IntPtr]::Zero
    )) {
    throw 'The owned MT5 terminal rejected graceful close.'
  }
  if (-not $process.WaitForExit(5000)) {
    throw 'The owned MT5 terminal did not exit after graceful close.'
  }
}

function Close-MT5VmTerminalForRestartBoundary {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$TerminalPath,
    [Parameter(Mandatory = $true)][int]$ProcessId
  )

  $canonicalPath = [System.IO.Path]::GetFullPath($TerminalPath)
  $matches = @(Get-MT5VmTerminalProcessesBoundary | Where-Object {
      -not [string]::IsNullOrWhiteSpace([string]$_.ExecutablePath) -and
      [string]::Equals(
        [System.IO.Path]::GetFullPath([string]$_.ExecutablePath),
        $canonicalPath,
        [StringComparison]::OrdinalIgnoreCase
      )
    })
  if ($matches.Count -ne 1 -or [int]$matches[0].ProcessId -ne $ProcessId) {
    throw 'The restart target no longer matches one exact-path MT5 process.'
  }
  Close-MT5VmOwnedTerminalBoundary -ProcessId $ProcessId
  $remaining = @(Get-MT5VmTerminalProcessesBoundary | Where-Object {
      [int]$_.ProcessId -eq $ProcessId -and
      -not [string]::IsNullOrWhiteSpace([string]$_.ExecutablePath) -and
      [string]::Equals(
        [System.IO.Path]::GetFullPath([string]$_.ExecutablePath),
        $canonicalPath,
        [StringComparison]::OrdinalIgnoreCase
      )
    })
  if ($remaining.Count -ne 0) {
    throw 'The selected MT5 terminal remained after graceful restart close.'
  }
}

function Resolve-MT5VmRestartedTerminalProcessBoundary {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$TerminalPath,
    [Parameter(Mandatory = $true)][int]$PreviousProcessId
  )

  $canonicalPath = [System.IO.Path]::GetFullPath($TerminalPath)
  $resolved = Resolve-MT5VmTerminalProcess -TerminalPath $canonicalPath
  if ([int]$resolved.ProcessId -eq $PreviousProcessId -or
      -not [string]::Equals(
        [System.IO.Path]::GetFullPath([string]$resolved.TerminalPath),
        $canonicalPath,
        [StringComparison]::OrdinalIgnoreCase
      )) {
    throw 'The restarted MT5 terminal did not resolve to a new exact-path process.'
  }
  return $resolved
}

function Invoke-MT5VmTerminalPythonApiBootstrapCore {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$TerminalPath,
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$')]
    [string]$AccountAlias,
    [Parameter(Mandatory = $true)][scriptblock]$ProbeRunner,
    [switch]$RestartTerminalAfterSettings
  )

  $target = $null
  $activeTarget = $null
  $transaction = $null
  $restartCompleted = $false
  try {
    $target = Resolve-MT5VmTerminalProcess -TerminalPath $TerminalPath
    $activeTarget = $target
    $transaction = Set-MT5VmTerminalPythonApiSettings -ProcessId $target.ProcessId

    if ($RestartTerminalAfterSettings) {
      try {
        Close-MT5VmTerminalForRestartBoundary `
          -TerminalPath $target.TerminalPath `
          -ProcessId ([int]$target.ProcessId)
        $restartCompleted = $true
        $activeTarget = $null
      } catch {
        $restartError = $_.Exception
        try {
          $null = Restore-MT5VmTerminalPythonApiSettings `
            -ProcessId ([int]$target.ProcessId) `
            -State $transaction.PriorState
        } catch {
          throw [InvalidOperationException]::new(
            'MT5_VM_ROLLBACK_FAILED: restart close failed and exact rollback also failed.',
            $restartError
          )
        }
        throw $restartError
      }
    }

    try {
      $probe = & $ProbeRunner
      if ($null -eq $probe -or
          $null -eq $probe.PSObject.Properties['ExitCode'] -or
          $null -eq $probe.PSObject.Properties['Result'] -or
          $null -eq $probe.Result -or
          $null -eq $probe.Result.PSObject.Properties['status'] -or
          $null -eq $probe.Result.PSObject.Properties['error_class'] -or
          $null -eq $probe.Result.PSObject.Properties['last_error_code']) {
        throw 'The sanitized Phase 0 probe result is malformed.'
      }
      if ($RestartTerminalAfterSettings) {
        $candidateTarget = Resolve-MT5VmRestartedTerminalProcessBoundary `
          -TerminalPath $target.TerminalPath `
          -PreviousProcessId ([int]$target.ProcessId)
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
        $activeTarget = $candidateTarget
      }
      $exitCode = [int]$probe.ExitCode
      $lastErrorCode = $probe.Result.last_error_code
      $rollBack = $null -ne $lastErrorCode -and [int]$lastErrorCode -eq -10005
      if ($rollBack) {
        $null = Restore-MT5VmTerminalPythonApiSettings `
          -ProcessId ([int]$activeTarget.ProcessId) `
          -State $transaction.PriorState
      }
      return [pscustomobject][ordered]@{
        TerminalPathHash = Get-MT5VmTerminalPathHash -TerminalPath $target.TerminalPath
        ProcessWasStarted = [bool]$target.WasStarted
        TerminalRestarted = $restartCompleted
        SettingsRetained = -not $rollBack
        RolledBack = $rollBack
        PhaseStatus = [string]$probe.Result.status
        ErrorClass = if ($null -eq $probe.Result.error_class) {
          $null
        } else {
          [string]$probe.Result.error_class
        }
        LastErrorCode = if ($null -eq $lastErrorCode) { $null } else { [int]$lastErrorCode }
        ExitCode = $exitCode
      }
    } catch {
      $probeError = $_.Exception
      try {
        if ($null -eq $activeTarget -and $restartCompleted) {
          $candidateTarget = Resolve-MT5VmRestartedTerminalProcessBoundary `
            -TerminalPath $target.TerminalPath `
            -PreviousProcessId ([int]$target.ProcessId)
          if ($null -eq $candidateTarget -or
              $null -eq $candidateTarget.PSObject.Properties['TerminalPath'] -or
              $null -eq $candidateTarget.PSObject.Properties['ProcessId'] -or
              [int]$candidateTarget.ProcessId -eq [int]$target.ProcessId -or
              -not [string]::Equals(
                [System.IO.Path]::GetFullPath([string]$candidateTarget.TerminalPath),
                [System.IO.Path]::GetFullPath([string]$target.TerminalPath),
                [StringComparison]::OrdinalIgnoreCase
              )) {
            throw 'The rollback target failed exact restarted-process verification.'
          }
          $activeTarget = $candidateTarget
        }
        $null = Restore-MT5VmTerminalPythonApiSettings `
          -ProcessId ([int]$activeTarget.ProcessId) `
          -State $transaction.PriorState
      } catch {
        throw [InvalidOperationException]::new(
          'MT5_VM_ROLLBACK_FAILED: probe failed and exact rollback also failed.',
          $probeError
        )
      }
      throw $probeError
    }
  } finally {
    if ($null -ne $target -and [bool]$target.WasStarted) {
      $ownedProcessId = if ($null -ne $activeTarget) {
        [int]$activeTarget.ProcessId
      } elseif (-not $restartCompleted) {
        [int]$target.ProcessId
      } else {
        $null
      }
      if ($null -ne $ownedProcessId) {
        Close-MT5VmOwnedTerminalBoundary -ProcessId $ownedProcessId
      }
    }
  }
}
