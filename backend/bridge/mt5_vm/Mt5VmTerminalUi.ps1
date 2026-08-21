Set-StrictMode -Version Latest

if (-not ('Mt5VmTerminalUiNative' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class Mt5VmTerminalUiNative {
  public delegate bool EnumWindowsProc(IntPtr window, IntPtr parameter);

  [StructLayout(LayoutKind.Sequential)]
  private struct ListViewItemState {
    public uint mask;
    public int item;
    public int subItem;
    public uint state;
    public uint stateMask;
    public IntPtr text;
    public int textLength;
    public int image;
    public IntPtr parameter;
  }

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

  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern IntPtr OpenProcess(uint access, bool inheritHandle, uint processId);

  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern IntPtr VirtualAllocEx(
    IntPtr process, IntPtr address, UIntPtr size, uint allocationType, uint protection
  );

  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern bool VirtualFreeEx(
    IntPtr process, IntPtr address, UIntPtr size, uint freeType
  );

  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern bool WriteProcessMemory(
    IntPtr process, IntPtr address, byte[] buffer, UIntPtr size, out UIntPtr written
  );

  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern bool CloseHandle(IntPtr handle);

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

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetClassName(IntPtr window, System.Text.StringBuilder text, int count);

  [DllImport("user32.dll", EntryPoint = "SendMessageTimeoutW", SetLastError = true)]
  private static extern IntPtr SendMessageTimeoutPointer(
    IntPtr window,
    uint message,
    IntPtr wParam,
    IntPtr lParam,
    uint flags,
    uint timeout,
    out IntPtr result
  );

  [DllImport("user32.dll", EntryPoint = "SendMessageTimeoutW", CharSet = CharSet.Unicode,
    SetLastError = true)]
  private static extern IntPtr SendMessageTimeoutText(
    IntPtr window,
    uint message,
    IntPtr wParam,
    string lParam,
    uint flags,
    uint timeout,
    out IntPtr result
  );

  [DllImport("user32.dll", EntryPoint = "SendMessageTimeoutW", CharSet = CharSet.Unicode,
    SetLastError = true)]
  private static extern IntPtr SendMessageTimeoutBuffer(
    IntPtr window,
    uint message,
    IntPtr wParam,
    System.Text.StringBuilder lParam,
    uint flags,
    uint timeout,
    out IntPtr result
  );

  public static bool TryMessage(
    IntPtr window,
    uint message,
    IntPtr wParam,
    IntPtr lParam,
    uint timeout,
    out IntPtr result
  ) {
    return SendMessageTimeoutPointer(
      window, message, wParam, lParam, 0x0002, timeout, out result
    ) != IntPtr.Zero;
  }

  public static bool TrySetText(IntPtr window, uint message, string text, uint timeout) {
    IntPtr result;
    return SendMessageTimeoutText(
      window, message, IntPtr.Zero, text, 0x0002, timeout, out result
    ) != IntPtr.Zero && result != IntPtr.Zero;
  }

  public static string WindowClass(IntPtr window) {
    var text = new System.Text.StringBuilder(256);
    if (GetClassName(window, text, text.Capacity) <= 0) {
      return String.Empty;
    }
    return text.ToString();
  }

  public static string ComboItemText(
    IntPtr combo,
    uint lengthMessage,
    uint textMessage,
    int index,
    uint timeout
  ) {
    IntPtr lengthResult;
    if (SendMessageTimeoutPointer(
        combo, lengthMessage, new IntPtr(index), IntPtr.Zero, 0x0002, timeout,
        out lengthResult
      ) == IntPtr.Zero || lengthResult.ToInt64() < 0 || lengthResult.ToInt64() > 512) {
      throw new InvalidOperationException("MT5 combo item length could not be read safely.");
    }
    var text = new System.Text.StringBuilder((int)lengthResult.ToInt64() + 1);
    IntPtr textResult;
    if (SendMessageTimeoutBuffer(
        combo, textMessage, new IntPtr(index), text, 0x0002, timeout,
        out textResult
      ) == IntPtr.Zero || textResult.ToInt64() < 0) {
      throw new InvalidOperationException("MT5 combo item could not be read safely.");
    }
    return text.ToString();
  }

  public static bool TrySelectListItem(
    IntPtr list,
    uint setStateMessage,
    int index,
    uint timeout
  ) {
    uint processId;
    GetWindowThreadProcessId(list, out processId);
    if (processId == 0 || index < 0) {
      return false;
    }
    var process = OpenProcess(0x0008 | 0x0020, false, processId);
    if (process == IntPtr.Zero) {
      return false;
    }
    int size = Marshal.SizeOf(typeof(ListViewItemState));
    var remote = VirtualAllocEx(
      process, IntPtr.Zero, new UIntPtr((uint)size), 0x1000 | 0x2000, 0x04
    );
    if (remote == IntPtr.Zero) {
      CloseHandle(process);
      return false;
    }
    var local = Marshal.AllocHGlobal(size);
    try {
      var item = new ListViewItemState();
      item.stateMask = 0x0001 | 0x0002;
      item.state = 0;
      Marshal.StructureToPtr(item, local, false);
      var bytes = new byte[size];
      Marshal.Copy(local, bytes, 0, size);
      UIntPtr written;
      if (!WriteProcessMemory(
          process, remote, bytes, new UIntPtr((uint)size), out written
        ) || written.ToUInt64() != (ulong)size) {
        return false;
      }
      IntPtr result;
      if (SendMessageTimeoutPointer(
          list, setStateMessage, new IntPtr(-1), remote, 0x0002, timeout, out result
        ) == IntPtr.Zero) {
        return false;
      }

      item.state = 0x0001 | 0x0002;
      Marshal.StructureToPtr(item, local, false);
      Marshal.Copy(local, bytes, 0, size);
      if (!WriteProcessMemory(
          process, remote, bytes, new UIntPtr((uint)size), out written
        ) || written.ToUInt64() != (ulong)size) {
        return false;
      }
      return SendMessageTimeoutPointer(
        list, setStateMessage, new IntPtr(index), remote, 0x0002, timeout, out result
      ) != IntPtr.Zero;
    } finally {
      Marshal.FreeHGlobal(local);
      VirtualFreeEx(process, remote, UIntPtr.Zero, 0x8000);
      CloseHandle(process);
    }
  }

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
    OpenAccountCommand = 32919
    EnrollmentSearchEdit = 10814
    EnrollmentSearchButton = 10815
    EnrollmentCompanyList = 10729
    EnrollmentExistingAccount = 10469
    EnrollmentLoginEdit = 10137
    EnrollmentPasswordEdit = 10138
    EnrollmentServerCombo = 10139
    EnrollmentBack = 12323
    EnrollmentNext = 12324
    EnrollmentFinish = 12325
    WmSetText = 0x000C
    CbGetCount = 0x0146
    CbGetCurrentSelection = 0x0147
    CbGetItemText = 0x0148
    CbGetItemTextLength = 0x0149
    CbSetCurrentSelection = 0x014E
    LvmGetItemCount = 0x1004
    LvmGetNextItem = 0x100C
    LvmGetSelectedCount = 0x1032
    LvmSetItemState = 0x102B
    LvniSelected = 0x0002
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

function Open-MT5VmServerEnrollmentDialogBoundary {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][int]$ProcessId
  )

  $constants = Get-MT5VmTerminalUiConstants
  $findDialogs = {
    $matches = @()
    foreach ($window in @(Get-MT5VmTopWindowHandlesBoundary -ProcessId $ProcessId)) {
      $candidate = [IntPtr]$window
      if (-not [Mt5VmTerminalUiNative]::IsWindowVisible($candidate) -or
          -not [Mt5VmTerminalUiNative]::IsWindowEnabled($candidate) -or
          [Mt5VmTerminalUiNative]::WindowClass($candidate) -ne '#32770') {
        continue
      }
      $searchControls = @([Mt5VmTerminalUiNative]::DescendantsWithControlId(
          $candidate, $constants.EnrollmentSearchEdit
        ))
      $accountControls = @([Mt5VmTerminalUiNative]::DescendantsWithControlId(
          $candidate, $constants.EnrollmentExistingAccount
        ))
      if ($searchControls.Count -eq 1 -or $accountControls.Count -eq 1) {
        $matches += $candidate
      }
    }
    return @($matches)
  }

  $dialogs = @(& $findDialogs)
  if ($dialogs.Count -gt 1) {
    throw 'SERVER_ENROLLMENT_DIALOG_AMBIGUOUS'
  }
  if ($dialogs.Count -eq 1) {
    return [IntPtr]$dialogs[0]
  }

  $mainWindows = @(Get-MT5VmTopWindowHandlesBoundary -ProcessId $ProcessId | Where-Object {
      $handle = [IntPtr]$_
      [Mt5VmTerminalUiNative]::IsWindowVisible($handle) -and
      [Mt5VmTerminalUiNative]::IsWindowEnabled($handle) -and
      [Mt5VmTerminalUiNative]::WindowClass($handle) -eq 'MetaQuotes::MetaTrader::5.00'
    })
  if ($mainWindows.Count -ne 1) {
    throw 'SERVER_ENROLLMENT_MAIN_WINDOW_AMBIGUOUS'
  }
  if (-not [Mt5VmTerminalUiNative]::PostMessage(
      [IntPtr]$mainWindows[0],
      $constants.WmCommand,
      [IntPtr]$constants.OpenAccountCommand,
      [IntPtr]::Zero
    )) {
    throw 'SERVER_ENROLLMENT_DIALOG_OPEN_REJECTED'
  }

  for ($attempt = 0; $attempt -lt 100; $attempt++) {
    Start-Sleep -Milliseconds 100
    $dialogs = @(& $findDialogs)
    if ($dialogs.Count -gt 1) {
      throw 'SERVER_ENROLLMENT_DIALOG_AMBIGUOUS'
    }
    if ($dialogs.Count -eq 1) {
      return [IntPtr]$dialogs[0]
    }
  }
  throw 'SERVER_ENROLLMENT_DIALOG_TIMEOUT'
}

function Get-MT5VmEnrollmentControlBoundary {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][IntPtr]$DialogHandle,
    [Parameter(Mandatory = $true)][int]$ControlId,
    [Parameter(Mandatory = $true)][string]$ExpectedClass,
    [switch]$AllowDisabled
  )

  $matches = @([Mt5VmTerminalUiNative]::DescendantsWithControlId(
      $DialogHandle, $ControlId
    ))
  if ($matches.Count -ne 1) {
    throw 'SERVER_ENROLLMENT_CONTROL_MAP_MISMATCH'
  }
  $control = [IntPtr]$matches[0]
  if ([Mt5VmTerminalUiNative]::WindowClass($control) -ne $ExpectedClass -or
      -not [Mt5VmTerminalUiNative]::IsWindowVisible($control) -or
      (-not $AllowDisabled -and -not [Mt5VmTerminalUiNative]::IsWindowEnabled($control))) {
    throw 'SERVER_ENROLLMENT_CONTROL_MAP_MISMATCH'
  }
  return $control
}

function Invoke-MT5VmEnrollmentMessageBoundary {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][IntPtr]$ControlHandle,
    [Parameter(Mandatory = $true)][uint32]$Message,
    [IntPtr]$WParam = [IntPtr]::Zero,
    [IntPtr]$LParam = [IntPtr]::Zero,
    [ValidateRange(100, 5000)][int]$TimeoutMs = 2000
  )

  $result = [IntPtr]::Zero
  if (-not [Mt5VmTerminalUiNative]::TryMessage(
      $ControlHandle, $Message, $WParam, $LParam, [uint32]$TimeoutMs, [ref]$result
    )) {
    throw 'SERVER_ENROLLMENT_UI_MESSAGE_TIMEOUT'
  }
  return $result
}

function Get-MT5VmEnrollmentActionButtonBoundary {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][IntPtr]$DialogHandle
  )

  $constants = Get-MT5VmTerminalUiConstants
  $matches = @(
    @([Mt5VmTerminalUiNative]::DescendantsWithControlId(
        $DialogHandle, $constants.EnrollmentNext
      )) +
    @([Mt5VmTerminalUiNative]::DescendantsWithControlId(
        $DialogHandle, $constants.EnrollmentFinish
      )) | Where-Object {
        $handle = [IntPtr]$_
        [Mt5VmTerminalUiNative]::IsWindowVisible($handle) -and
        [Mt5VmTerminalUiNative]::IsWindowEnabled($handle)
      }
  )
  if ($matches.Count -ne 1) {
    throw 'SERVER_ENROLLMENT_ACTION_CONTROL_MISMATCH'
  }
  $control = [IntPtr]$matches[0]
  if ([Mt5VmTerminalUiNative]::WindowClass($control) -ne 'Button') {
    throw 'SERVER_ENROLLMENT_ACTION_CONTROL_MISMATCH'
  }
  return $control
}

function Get-MT5VmExactServerIndex {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string[]]$Candidates,
    [Parameter(Mandatory = $true)][string]$Expected
  )

  $matches = @()
  for ($index = 0; $index -lt $Candidates.Count; $index++) {
    if ([string]::Equals(
        [string]$Candidates[$index], $Expected, [StringComparison]::Ordinal
      )) {
      $matches += $index
    }
  }
  if ($matches.Count -ne 1) {
    throw 'SERVER_SELECTION_MISMATCH'
  }
  return [int]$matches[0]
}

function Invoke-MT5VmServerEnrollmentUiBoundary {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][IntPtr]$DialogHandle,
    [Parameter(Mandatory = $true)][string]$CompanySearchLabel,
    [Parameter(Mandatory = $true)][string]$Login,
    [Parameter(Mandatory = $true)][string]$Server,
    [Parameter(Mandatory = $true)][string]$Password,
    [Parameter(Mandatory = $true)][int]$TimeoutMs
  )

  $constants = Get-MT5VmTerminalUiConstants
  $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMs)
  $searchPage = $false
  $companyCount = 1

  $searchMatches = @([Mt5VmTerminalUiNative]::DescendantsWithControlId(
      $DialogHandle, $constants.EnrollmentSearchEdit
    ))
  if ($searchMatches.Count -gt 1) {
    throw 'SERVER_ENROLLMENT_CONTROL_MAP_MISMATCH'
  }
  if ($searchMatches.Count -eq 1 -and
      [Mt5VmTerminalUiNative]::IsWindowVisible([IntPtr]$searchMatches[0])) {
    $searchPage = $true
    $searchEdit = Get-MT5VmEnrollmentControlBoundary `
      -DialogHandle $DialogHandle -ControlId $constants.EnrollmentSearchEdit `
      -ExpectedClass 'Edit'
    $searchButton = Get-MT5VmEnrollmentControlBoundary `
      -DialogHandle $DialogHandle -ControlId $constants.EnrollmentSearchButton `
      -ExpectedClass 'Button'
    $companyList = Get-MT5VmEnrollmentControlBoundary `
      -DialogHandle $DialogHandle -ControlId $constants.EnrollmentCompanyList `
      -ExpectedClass 'SysListView32'
    if (-not [Mt5VmTerminalUiNative]::TrySetText(
        $searchEdit, $constants.WmSetText, $CompanySearchLabel, 2000
      )) {
      throw 'SERVER_ENROLLMENT_SEARCH_TEXT_REJECTED'
    }
    $null = Invoke-MT5VmEnrollmentMessageBoundary `
      -ControlHandle $searchButton -Message $constants.BmClick
    while ([DateTime]::UtcNow -lt $deadline) {
      $companyCount = (Invoke-MT5VmEnrollmentMessageBoundary `
          -ControlHandle $companyList -Message $constants.LvmGetItemCount
        ).ToInt32()
      if ($companyCount -gt 0) {
        break
      }
      Start-Sleep -Milliseconds 100
    }
    if ($companyCount -lt 1 -or $companyCount -gt 64) {
      throw 'SERVER_ENROLLMENT_SEARCH_TIMEOUT'
    }
  }

  for ($companyIndex = 0; $companyIndex -lt $companyCount; $companyIndex++) {
    if ([DateTime]::UtcNow -ge $deadline) {
      throw 'SERVER_ENROLLMENT_SEARCH_TIMEOUT'
    }
    if ($searchPage) {
      $companyList = Get-MT5VmEnrollmentControlBoundary `
        -DialogHandle $DialogHandle -ControlId $constants.EnrollmentCompanyList `
        -ExpectedClass 'SysListView32'
      if (-not [Mt5VmTerminalUiNative]::TrySelectListItem(
          $companyList, $constants.LvmSetItemState, $companyIndex, 2000
        )) {
        throw 'SERVER_ENROLLMENT_COMPANY_SELECTION_FAILED'
      }
      $selectedCount = (Invoke-MT5VmEnrollmentMessageBoundary `
          -ControlHandle $companyList -Message $constants.LvmGetSelectedCount
        ).ToInt32()
      $selectedIndex = (Invoke-MT5VmEnrollmentMessageBoundary `
          -ControlHandle $companyList -Message $constants.LvmGetNextItem `
          -WParam ([IntPtr](-1)) -LParam ([IntPtr]$constants.LvniSelected)
        ).ToInt32()
      if ($selectedCount -ne 1 -or $selectedIndex -ne $companyIndex) {
        throw 'SERVER_ENROLLMENT_COMPANY_SELECTION_FAILED'
      }
      $rowDeadline = [DateTime]::UtcNow.AddSeconds(10)
      if ($rowDeadline -gt $deadline) { $rowDeadline = $deadline }
      $nextButton = $null
      while ([DateTime]::UtcNow -lt $rowDeadline) {
        $nextMatches = @([Mt5VmTerminalUiNative]::DescendantsWithControlId(
            $DialogHandle, $constants.EnrollmentNext
          ))
        if ($nextMatches.Count -gt 1) {
          throw 'SERVER_ENROLLMENT_ACTION_CONTROL_MISMATCH'
        }
        if ($nextMatches.Count -eq 1) {
          $candidateNext = [IntPtr]$nextMatches[0]
          if ([Mt5VmTerminalUiNative]::WindowClass($candidateNext) -ne 'Button') {
            throw 'SERVER_ENROLLMENT_ACTION_CONTROL_MISMATCH'
          }
          if ([Mt5VmTerminalUiNative]::IsWindowVisible($candidateNext) -and
              [Mt5VmTerminalUiNative]::IsWindowEnabled($candidateNext)) {
            $nextButton = $candidateNext
            break
          }
        }
        Start-Sleep -Milliseconds 100
      }
      if ($null -eq $nextButton) {
        continue
      }
      $null = Invoke-MT5VmEnrollmentMessageBoundary `
        -ControlHandle $nextButton -Message $constants.BmClick
    }

    $existingAccount = $null
    $accountPageDeadline = [DateTime]::UtcNow.AddSeconds(10)
    if ($accountPageDeadline -gt $deadline) { $accountPageDeadline = $deadline }
    while ([DateTime]::UtcNow -lt $accountPageDeadline) {
      $accountMatches = @([Mt5VmTerminalUiNative]::DescendantsWithControlId(
          $DialogHandle, $constants.EnrollmentExistingAccount
        ))
      if ($accountMatches.Count -gt 1) {
        throw 'SERVER_ENROLLMENT_CONTROL_MAP_MISMATCH'
      }
      if ($accountMatches.Count -eq 1 -and
          [Mt5VmTerminalUiNative]::IsWindowVisible([IntPtr]$accountMatches[0])) {
        $existingAccount = Get-MT5VmEnrollmentControlBoundary `
          -DialogHandle $DialogHandle `
          -ControlId $constants.EnrollmentExistingAccount `
          -ExpectedClass 'Button'
        break
      }
      Start-Sleep -Milliseconds 100
    }
    if ($null -eq $existingAccount) {
      $returnedSearch = @([Mt5VmTerminalUiNative]::DescendantsWithControlId(
          $DialogHandle, $constants.EnrollmentCompanyList
        )) | Where-Object {
          [Mt5VmTerminalUiNative]::IsWindowVisible([IntPtr]$_)
        }
      if ($searchPage -and @($returnedSearch).Count -eq 1) {
        continue
      }
      throw 'SERVER_ENROLLMENT_ACCOUNT_PAGE_TIMEOUT'
    }
    $null = Invoke-MT5VmEnrollmentMessageBoundary `
      -ControlHandle $existingAccount -Message $constants.BmClick

    $controlMap = $null
    $controlDeadline = [DateTime]::UtcNow.AddSeconds(10)
    if ($controlDeadline -gt $deadline) { $controlDeadline = $deadline }
    while ([DateTime]::UtcNow -lt $controlDeadline) {
      $candidateMap = [ordered]@{
        Login = @([Mt5VmTerminalUiNative]::DescendantsWithControlId(
            $DialogHandle, $constants.EnrollmentLoginEdit
          ))
        Password = @([Mt5VmTerminalUiNative]::DescendantsWithControlId(
            $DialogHandle, $constants.EnrollmentPasswordEdit
          ))
        Server = @([Mt5VmTerminalUiNative]::DescendantsWithControlId(
            $DialogHandle, $constants.EnrollmentServerCombo
          ))
        Submit = @(
          @([Mt5VmTerminalUiNative]::DescendantsWithControlId(
              $DialogHandle, $constants.EnrollmentNext
            )) +
          @([Mt5VmTerminalUiNative]::DescendantsWithControlId(
              $DialogHandle, $constants.EnrollmentFinish
            )) | Where-Object {
              [Mt5VmTerminalUiNative]::IsWindowVisible([IntPtr]$_)
            }
        )
      }
      if (@($candidateMap.Values | Where-Object { $_.Count -ne 1 }).Count -gt 0) {
        throw 'SERVER_ENROLLMENT_CONTROL_MAP_MISMATCH'
      }
      $candidateLogin = [IntPtr]$candidateMap.Login[0]
      $candidatePassword = [IntPtr]$candidateMap.Password[0]
      $candidateServer = [IntPtr]$candidateMap.Server[0]
      $candidateSubmit = [IntPtr]$candidateMap.Submit[0]
      if ([Mt5VmTerminalUiNative]::WindowClass($candidateLogin) -ne 'Edit' -or
          [Mt5VmTerminalUiNative]::WindowClass($candidatePassword) -ne 'Edit' -or
          [Mt5VmTerminalUiNative]::WindowClass($candidateServer) -ne 'ComboBox' -or
          [Mt5VmTerminalUiNative]::WindowClass($candidateSubmit) -ne 'Button') {
        throw 'SERVER_ENROLLMENT_CONTROL_MAP_MISMATCH'
      }
      if ([Mt5VmTerminalUiNative]::IsWindowVisible($candidateLogin) -and
          [Mt5VmTerminalUiNative]::IsWindowEnabled($candidateLogin) -and
          [Mt5VmTerminalUiNative]::IsWindowVisible($candidatePassword) -and
          [Mt5VmTerminalUiNative]::IsWindowEnabled($candidatePassword) -and
          [Mt5VmTerminalUiNative]::IsWindowVisible($candidateServer) -and
          [Mt5VmTerminalUiNative]::IsWindowEnabled($candidateServer) -and
          [Mt5VmTerminalUiNative]::IsWindowVisible($candidateSubmit) -and
          [Mt5VmTerminalUiNative]::IsWindowEnabled($candidateSubmit)) {
        $controlMap = [pscustomobject]@{
          Login = $candidateLogin
          Password = $candidatePassword
          Server = $candidateServer
          Submit = $candidateSubmit
        }
        break
      }
      Start-Sleep -Milliseconds 100
    }
    if ($null -eq $controlMap) {
      throw 'SERVER_ENROLLMENT_ACCOUNT_CONTROLS_TIMEOUT'
    }

    $serverCount = (Invoke-MT5VmEnrollmentMessageBoundary `
        -ControlHandle $controlMap.Server -Message $constants.CbGetCount
      ).ToInt32()
    if ($serverCount -lt 1 -or $serverCount -gt 256) {
      throw 'SERVER_SELECTION_MISMATCH'
    }
    $serverCandidates = @()
    for ($serverIndex = 0; $serverIndex -lt $serverCount; $serverIndex++) {
      $candidate = [Mt5VmTerminalUiNative]::ComboItemText(
        $controlMap.Server, $constants.CbGetItemTextLength,
        $constants.CbGetItemText, $serverIndex, 2000
      )
      $serverCandidates += $candidate
      $candidate = $null
    }
    $exactServerIndex = $null
    try {
      $exactServerIndex = Get-MT5VmExactServerIndex `
        -Candidates $serverCandidates -Expected $Server
    } catch {
      $exactServerIndex = $null
    }
    $serverCandidates = $null
    if ($null -ne $exactServerIndex) {
      $selected = (Invoke-MT5VmEnrollmentMessageBoundary `
          -ControlHandle $controlMap.Server `
          -Message $constants.CbSetCurrentSelection `
          -WParam ([IntPtr]$exactServerIndex)
        ).ToInt32()
      $selectedAgain = (Invoke-MT5VmEnrollmentMessageBoundary `
          -ControlHandle $controlMap.Server -Message $constants.CbGetCurrentSelection
        ).ToInt32()
      if ($selected -ne $exactServerIndex -or $selectedAgain -ne $exactServerIndex -or
          -not [string]::Equals(
            [Mt5VmTerminalUiNative]::ComboItemText(
              $controlMap.Server, $constants.CbGetItemTextLength,
              $constants.CbGetItemText, $selectedAgain, 2000
            ),
            $Server,
            [StringComparison]::Ordinal
          )) {
        throw 'SERVER_SELECTION_MISMATCH'
      }
      if (-not [Mt5VmTerminalUiNative]::TrySetText(
          $controlMap.Login, $constants.WmSetText, $Login, 2000
        ) -or -not [Mt5VmTerminalUiNative]::TrySetText(
          $controlMap.Password, $constants.WmSetText, $Password, 2000
        )) {
        throw 'SERVER_ENROLLMENT_CREDENTIAL_TEXT_REJECTED'
      }
      $null = Invoke-MT5VmEnrollmentMessageBoundary `
        -ControlHandle $controlMap.Submit -Message $constants.BmClick
      while ([DateTime]::UtcNow -lt $deadline) {
        if (-not [Mt5VmTerminalUiNative]::IsWindow($DialogHandle) -or
            -not [Mt5VmTerminalUiNative]::IsWindowVisible($DialogHandle)) {
          $Login = $null
          $Server = $null
          $Password = $null
          return [pscustomobject]@{server_exact = $true; submitted = $true}
        }
        Start-Sleep -Milliseconds 100
      }
      throw 'SERVER_ENROLLMENT_LOGIN_REJECTED_OR_TIMEOUT'
    }

    if (-not $searchPage -or $companyIndex -ge ($companyCount - 1)) {
      throw 'SERVER_SELECTION_MISMATCH'
    }
    $backButton = Get-MT5VmEnrollmentControlBoundary `
      -DialogHandle $DialogHandle -ControlId $constants.EnrollmentBack `
      -ExpectedClass 'Button'
    $null = Invoke-MT5VmEnrollmentMessageBoundary `
      -ControlHandle $backButton -Message $constants.BmClick
    while ([DateTime]::UtcNow -lt $deadline) {
      $listMatches = @([Mt5VmTerminalUiNative]::DescendantsWithControlId(
          $DialogHandle, $constants.EnrollmentCompanyList
        ))
      if ($listMatches.Count -eq 1 -and
          [Mt5VmTerminalUiNative]::IsWindowVisible([IntPtr]$listMatches[0]) -and
          [Mt5VmTerminalUiNative]::IsWindowEnabled([IntPtr]$listMatches[0])) {
        break
      }
      Start-Sleep -Milliseconds 100
    }
  }
  throw 'SERVER_SELECTION_MISMATCH'
}

function Test-MT5VmServerCatalogRefreshBoundary {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$TerminalPath,
    [Parameter(Mandatory = $true)][string]$Server,
    [Parameter(Mandatory = $true)][datetime]$NotBeforeUtc
  )

  $installationRoot = [System.IO.Path]::GetFullPath(
    (Split-Path -Parent $TerminalPath)
  ).TrimEnd('\')
  $terminalProfilesRoot = Join-Path $env:APPDATA 'MetaQuotes\Terminal'
  if (-not (Test-Path -LiteralPath $terminalProfilesRoot -PathType Container)) {
    return $false
  }
  $matches = @()
  foreach ($profile in @(Get-ChildItem -LiteralPath $terminalProfilesRoot -Directory -Force)) {
    if ($profile.Attributes -band [IO.FileAttributes]::ReparsePoint) {
      continue
    }
    $originPath = Join-Path $profile.FullName 'origin.txt'
    if (-not (Test-Path -LiteralPath $originPath -PathType Leaf)) {
      continue
    }
    $originItem = Get-Item -LiteralPath $originPath -Force
    if ($originItem.Attributes -band [IO.FileAttributes]::ReparsePoint) {
      continue
    }
    $origin = [System.IO.Path]::GetFullPath(
      (Get-Content -LiteralPath $originPath -Raw).Trim()
    ).TrimEnd('\')
    if ([string]::Equals(
        $origin, $installationRoot, [StringComparison]::OrdinalIgnoreCase
      )) {
      $matches += $profile
    }
  }
  if ($matches.Count -ne 1) {
    return $false
  }
  $catalogPath = Join-Path $matches[0].FullName 'config\servers.dat'
  if (-not (Test-Path -LiteralPath $catalogPath -PathType Leaf)) {
    return $false
  }
  $catalog = Get-Item -LiteralPath $catalogPath -Force
  if ($catalog.Attributes -band [IO.FileAttributes]::ReparsePoint -or
      $catalog.Length -lt 1 -or $catalog.LastWriteTimeUtc -lt $NotBeforeUtc) {
    return $false
  }
  return $true
}

function Invoke-MT5VmServerCatalogEnrollmentCore {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$TerminalPath,
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$')]
    [string]$AccountAlias,
    [Parameter(Mandatory = $true)][ValidateLength(1, 128)]
    [string]$CompanySearchLabel,
    [Parameter(Mandatory = $true)][scriptblock]$CredentialLoader,
    [ValidateRange(1000, 120000)][int]$TimeoutMs = 60000
  )

  $target = $null
  $credential = $null
  try {
    $target = Resolve-MT5VmTerminalProcess -TerminalPath $TerminalPath
    $credential = & $CredentialLoader $AccountAlias
    if ($null -eq $credential) {
      throw 'ENROLLMENT_CREDENTIAL_MALFORMED'
    }

    foreach ($propertyName in @('login', 'server', 'password')) {
      if ($null -eq $credential.PSObject.Properties[$propertyName] -or
          [string]::IsNullOrWhiteSpace([string]$credential.$propertyName)) {
        throw 'ENROLLMENT_CREDENTIAL_MALFORMED'
      }
    }
    $parsedLogin = 0L
    if (-not [long]::TryParse(
        [string]$credential.login,
        [Globalization.NumberStyles]::None,
        [Globalization.CultureInfo]::InvariantCulture,
        [ref]$parsedLogin
      ) -or $parsedLogin -lt 1 -or
        [string]$credential.server -match '[\x00-\x1F\x7F]') {
      throw 'ENROLLMENT_CREDENTIAL_MALFORMED'
    }

    $notBeforeUtc = (Get-Date).ToUniversalTime()
    $dialog = Open-MT5VmServerEnrollmentDialogBoundary -ProcessId ([int]$target.ProcessId)
    if ($dialog -eq [IntPtr]::Zero) {
      throw 'SERVER_ENROLLMENT_DIALOG_MISSING'
    }

    $uiResult = Invoke-MT5VmServerEnrollmentUiBoundary `
      ([IntPtr]$dialog) `
      $CompanySearchLabel `
      ([string]$credential.login) `
      ([string]$credential.server) `
      ([string]$credential.password) `
      $TimeoutMs
    if ($null -eq $uiResult -or
        $null -eq $uiResult.PSObject.Properties['server_exact'] -or
        $null -eq $uiResult.PSObject.Properties['submitted'] -or
        -not [bool]$uiResult.server_exact -or
        -not [bool]$uiResult.submitted) {
      throw 'SERVER_SELECTION_MISMATCH'
    }

    $catalogRefreshed = Test-MT5VmServerCatalogRefreshBoundary `
      $target.TerminalPath `
      ([string]$credential.server) `
      $notBeforeUtc
    if (-not $catalogRefreshed) {
      throw 'SERVER_CATALOG_NOT_REFRESHED'
    }

    return [pscustomobject][ordered]@{
      status = 'PASS'
      server_exact = $true
      catalog_refreshed = $true
      process_was_started = [bool]$target.WasStarted
      terminal_path_hash = Get-MT5VmTerminalPathHash -TerminalPath $target.TerminalPath
    }
  } finally {
    if ($null -ne $credential) {
      foreach ($propertyName in @('login', 'server', 'password')) {
        if ($null -ne $credential.PSObject.Properties[$propertyName]) {
          $credential.$propertyName = $null
        }
      }
      $credential = $null
    }
    if ($null -ne $target -and [bool]$target.WasStarted) {
      Close-MT5VmOwnedTerminalBoundary -ProcessId ([int]$target.ProcessId)
    }
  }
}
