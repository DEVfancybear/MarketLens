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

  [StructLayout(LayoutKind.Sequential)]
  private struct NativeRectangle {
    public int left;
    public int top;
    public int right;
    public int bottom;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct NativePoint {
    public int x;
    public int y;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct KeyboardInput {
    public ushort virtualKey;
    public ushort scanCode;
    public uint flags;
    public uint time;
    public UIntPtr extraInfo;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct MouseInput {
    public int x;
    public int y;
    public uint mouseData;
    public uint flags;
    public uint time;
    public UIntPtr extraInfo;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct HardwareInput {
    public uint message;
    public ushort parameterLow;
    public ushort parameterHigh;
  }

  [StructLayout(LayoutKind.Explicit)]
  private struct InputUnion {
    [FieldOffset(0)] public MouseInput mouse;
    [FieldOffset(0)] public KeyboardInput keyboard;
    [FieldOffset(0)] public HardwareInput hardware;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct NativeInput {
    public uint type;
    public InputUnion data;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct GuiThreadInfo {
    public uint size;
    public uint flags;
    public IntPtr active;
    public IntPtr focus;
    public IntPtr capture;
    public IntPtr menuOwner;
    public IntPtr moveSize;
    public IntPtr caret;
    public NativeRectangle caretRectangle;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct ListViewHitTestInfo {
    public NativePoint point;
    public uint flags;
    public int item;
    public int subItem;
    public int group;
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
  private static extern IntPtr GetForegroundWindow();

  [DllImport("user32.dll", SetLastError = true)]
  private static extern bool GetCursorPos(out NativePoint point);

  [DllImport("user32.dll", SetLastError = true)]
  private static extern bool SetCursorPos(int x, int y);

  [DllImport("user32.dll", SetLastError = true)]
  private static extern bool ClientToScreen(IntPtr window, ref NativePoint point);

  [DllImport("user32.dll")]
  private static extern IntPtr WindowFromPoint(NativePoint point);

  [DllImport("user32.dll")]
  private static extern int GetSystemMetrics(int index);

  [DllImport("user32.dll", SetLastError = true)]
  private static extern bool GetGUIThreadInfo(uint threadId, ref GuiThreadInfo info);

  [DllImport("user32.dll", SetLastError = true)]
  private static extern uint SendInput(
    uint inputCount,
    NativeInput[] inputs,
    int inputSize
  );

  [DllImport("user32.dll")]
  private static extern short GetKeyState(int virtualKey);

  [DllImport("user32.dll")]
  public static extern bool IsWindow(IntPtr window);

  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr window);

  [DllImport("user32.dll")]
  public static extern bool IsWindowEnabled(IntPtr window);

  [DllImport("user32.dll")]
  private static extern bool GetClientRect(IntPtr window, out NativeRectangle rectangle);

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
  private static extern bool ReadProcessMemory(
    IntPtr process, IntPtr address, byte[] buffer, UIntPtr size, out UIntPtr read
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

  [DllImport("user32.dll", EntryPoint = "PostMessageW", SetLastError = true)]
  private static extern bool PostMessageW(
    IntPtr window,
    uint message,
    IntPtr wParam,
    IntPtr lParam
  );

  public static bool PostMessage(
    IntPtr window,
    uint message,
    IntPtr wParam,
    IntPtr lParam
  ) {
    return PostMessageW(window, message, wParam, lParam);
  }

  public static bool TryPostMessage(
    IntPtr window,
    uint message,
    IntPtr wParam,
    IntPtr lParam
  ) {
    return PostMessageW(window, message, wParam, lParam);
  }

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

  public static uint WindowProcessId(IntPtr window) {
    uint processId;
    if (window == IntPtr.Zero || GetWindowThreadProcessId(window, out processId) == 0) {
      return 0;
    }
    return processId;
  }

  public static bool IsExactForegroundFocus(
    IntPtr optionsWindow,
    IntPtr editorWindow,
    uint expectedProcessId
  ) {
    if (optionsWindow == IntPtr.Zero || editorWindow == IntPtr.Zero ||
        expectedProcessId == 0 || GetForegroundWindow() != optionsWindow) {
      return false;
    }
    uint optionsProcessId;
    uint optionsThreadId = GetWindowThreadProcessId(optionsWindow, out optionsProcessId);
    uint editorProcessId;
    uint editorThreadId = GetWindowThreadProcessId(editorWindow, out editorProcessId);
    if (optionsThreadId == 0 || editorThreadId == 0 ||
        optionsThreadId != editorThreadId || optionsProcessId != expectedProcessId ||
        editorProcessId != expectedProcessId) {
      return false;
    }
    var info = new GuiThreadInfo();
    info.size = (uint)Marshal.SizeOf(typeof(GuiThreadInfo));
    return GetGUIThreadInfo(optionsThreadId, ref info) &&
      info.active == optionsWindow && info.focus == editorWindow;
  }

  public static uint SendKeyboardInput(
    ushort[] virtualKeys,
    ushort[] scanCodes,
    uint[] flags
  ) {
    if (virtualKeys == null || scanCodes == null || flags == null ||
        virtualKeys.Length == 0 || virtualKeys.Length != scanCodes.Length ||
        virtualKeys.Length != flags.Length) {
      return 0;
    }
    var inputs = new NativeInput[virtualKeys.Length];
    for (int index = 0; index < inputs.Length; index++) {
      inputs[index].type = 1;
      inputs[index].data.keyboard.virtualKey = virtualKeys[index];
      inputs[index].data.keyboard.scanCode = scanCodes[index];
      inputs[index].data.keyboard.flags = flags[index];
      inputs[index].data.keyboard.time = 0;
      inputs[index].data.keyboard.extraInfo = UIntPtr.Zero;
    }
    return SendInput(
      (uint)inputs.Length,
      inputs,
      Marshal.SizeOf(typeof(NativeInput))
    );
  }

  public static uint SendMouseInput(
    int[] x,
    int[] y,
    uint[] mouseData,
    uint[] flags
  ) {
    if (x == null || y == null || mouseData == null || flags == null ||
        x.Length == 0 || x.Length != y.Length || x.Length != mouseData.Length ||
        x.Length != flags.Length) {
      return 0;
    }
    var inputs = new NativeInput[x.Length];
    for (int index = 0; index < inputs.Length; index++) {
      inputs[index].type = 0;
      inputs[index].data.mouse.x = x[index];
      inputs[index].data.mouse.y = y[index];
      inputs[index].data.mouse.mouseData = mouseData[index];
      inputs[index].data.mouse.flags = flags[index];
      inputs[index].data.mouse.time = 0;
      inputs[index].data.mouse.extraInfo = UIntPtr.Zero;
    }
    return SendInput(
      (uint)inputs.Length,
      inputs,
      Marshal.SizeOf(typeof(NativeInput))
    );
  }

  public static int[] GetCursorPosition() {
    NativePoint point;
    if (!GetCursorPos(out point)) {
      return new int[0];
    }
    return new int[] { point.x, point.y };
  }

  public static bool TrySetCursorPosition(int x, int y) {
    if (!SetCursorPos(x, y)) {
      return false;
    }
    NativePoint observed;
    return GetCursorPos(out observed) && observed.x == x && observed.y == y;
  }

  public static int[] ClientPointToScreen(IntPtr window, int x, int y) {
    var point = new NativePoint();
    point.x = x;
    point.y = y;
    if (window == IntPtr.Zero || !ClientToScreen(window, ref point)) {
      return new int[0];
    }
    return new int[] { point.x, point.y };
  }

  public static int[] VirtualScreen() {
    return new int[] {
      GetSystemMetrics(76), GetSystemMetrics(77),
      GetSystemMetrics(78), GetSystemMetrics(79)
    };
  }

  public static IntPtr WindowAtScreenPoint(int x, int y) {
    var point = new NativePoint();
    point.x = x;
    point.y = y;
    return WindowFromPoint(point);
  }

  public static bool IsExactPhysicalMouseActivationGuard(
    IntPtr optionsWindow,
    IntPtr listWindow,
    IntPtr checkboxWindow,
    uint expectedProcessId,
    int screenX,
    int screenY,
    uint getCheckMessage,
    uint timeout
  ) {
    if (optionsWindow == IntPtr.Zero || listWindow == IntPtr.Zero ||
        checkboxWindow == IntPtr.Zero || expectedProcessId == 0 ||
        GetForegroundWindow() != optionsWindow ||
        !IsWindowVisible(listWindow) || !IsWindowEnabled(listWindow) ||
        !IsWindowVisible(checkboxWindow) || !IsWindowEnabled(checkboxWindow)) {
      return false;
    }
    uint optionsProcessId;
    uint optionsThreadId = GetWindowThreadProcessId(optionsWindow, out optionsProcessId);
    uint listProcessId;
    uint listThreadId = GetWindowThreadProcessId(listWindow, out listProcessId);
    uint checkboxProcessId;
    uint checkboxThreadId = GetWindowThreadProcessId(checkboxWindow, out checkboxProcessId);
    if (optionsThreadId == 0 || listThreadId == 0 || checkboxThreadId == 0 ||
        optionsThreadId != listThreadId || optionsThreadId != checkboxThreadId ||
        optionsProcessId != expectedProcessId || listProcessId != expectedProcessId ||
        checkboxProcessId != expectedProcessId) {
      return false;
    }
    var point = new NativePoint();
    point.x = screenX;
    point.y = screenY;
    if (WindowFromPoint(point) != listWindow) {
      return false;
    }
    IntPtr checkedResult;
    return TryMessage(
      checkboxWindow,
      getCheckMessage,
      IntPtr.Zero,
      IntPtr.Zero,
      timeout,
      out checkedResult
    ) && checkedResult.ToInt64() == 1;
  }

  public static bool IsToggleKeyOff(int virtualKey) {
    return (GetKeyState(virtualKey) & 0x0001) == 0;
  }

  public static string ReadBoundedText(
    IntPtr window,
    uint getTextLengthMessage,
    uint getTextMessage,
    int maxCharacters,
    uint timeout
  ) {
    if (maxCharacters < 1) {
      throw new InvalidOperationException(
        "PROVISIONING_WEBREQUEST_ALLOWLIST_EDITOR_INVALID"
      );
    }
    IntPtr lengthResult;
    if (!TryMessage(
        window,
        getTextLengthMessage,
        IntPtr.Zero,
        IntPtr.Zero,
        timeout,
        out lengthResult
      ) || lengthResult.ToInt64() < 0 || lengthResult.ToInt64() > maxCharacters) {
      throw new InvalidOperationException(
        "PROVISIONING_WEBREQUEST_ALLOWLIST_EDITOR_INVALID"
      );
    }
    int length = (int)lengthResult.ToInt64();
    var text = new System.Text.StringBuilder(length + 1);
    IntPtr textResult;
    if (SendMessageTimeoutBuffer(
        window,
        getTextMessage,
        new IntPtr(length + 1),
        text,
        0x0002,
        timeout,
        out textResult
      ) == IntPtr.Zero || textResult.ToInt64() < 0 ||
      textResult.ToInt64() > length || text.Length != textResult.ToInt64()) {
      throw new InvalidOperationException(
        "PROVISIONING_WEBREQUEST_ALLOWLIST_EDITOR_INVALID"
      );
    }
    return text.ToString();
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

  public static string[] ReadListViewItems(
    IntPtr list,
    uint getItemCountMessage,
    uint getItemTextMessage,
    int maxItems,
    int maxCharacters,
    uint timeout
  ) {
    if (maxItems < 1 || maxCharacters < 1) {
      throw new InvalidOperationException("PROVISIONING_WEBREQUEST_ALLOWLIST_STATE_INVALID");
    }
    IntPtr countResult;
    if (!TryMessage(
        list, getItemCountMessage, IntPtr.Zero, IntPtr.Zero, timeout, out countResult
      ) || countResult.ToInt64() < 0 || countResult.ToInt64() > maxItems) {
      throw new InvalidOperationException("PROVISIONING_WEBREQUEST_ALLOWLIST_STATE_INVALID");
    }
    int count = (int)countResult.ToInt64();
    uint processId;
    GetWindowThreadProcessId(list, out processId);
    if (processId == 0) {
      throw new InvalidOperationException("PROVISIONING_WEBREQUEST_ALLOWLIST_CONTROL_INVALID");
    }
    var process = OpenProcess(0x0008 | 0x0010 | 0x0020, false, processId);
    if (process == IntPtr.Zero) {
      throw new InvalidOperationException("PROVISIONING_WEBREQUEST_ALLOWLIST_LIST_READ_FAILED");
    }
    int itemSize = Marshal.SizeOf(typeof(ListViewItemState));
    int textBytes = checked((maxCharacters + 2) * 2);
    int totalBytes = checked(itemSize + textBytes);
    var remote = VirtualAllocEx(
      process, IntPtr.Zero, new UIntPtr((uint)totalBytes), 0x1000 | 0x2000, 0x04
    );
    if (remote == IntPtr.Zero) {
      CloseHandle(process);
      throw new InvalidOperationException("PROVISIONING_WEBREQUEST_ALLOWLIST_LIST_READ_FAILED");
    }
    var local = Marshal.AllocHGlobal(itemSize);
    try {
      var items = new List<string>();
      for (int index = 0; index < count; index++) {
        var item = new ListViewItemState();
        item.item = index;
        item.subItem = 0;
        item.text = new IntPtr(remote.ToInt64() + itemSize);
        item.textLength = maxCharacters + 2;
        Marshal.StructureToPtr(item, local, false);
        var itemBytes = new byte[itemSize];
        Marshal.Copy(local, itemBytes, 0, itemSize);
        UIntPtr written;
        if (!WriteProcessMemory(
            process, remote, itemBytes, new UIntPtr((uint)itemSize), out written
          ) || written.ToUInt64() != (ulong)itemSize) {
          throw new InvalidOperationException("PROVISIONING_WEBREQUEST_ALLOWLIST_LIST_READ_FAILED");
        }
        IntPtr textResult;
        if (!TryMessage(
            list, getItemTextMessage, new IntPtr(index), remote, timeout, out textResult
          ) || textResult.ToInt64() < 0 || textResult.ToInt64() > maxCharacters) {
          throw new InvalidOperationException("PROVISIONING_WEBREQUEST_ALLOWLIST_STATE_INVALID");
        }
        var textBuffer = new byte[textBytes];
        UIntPtr read;
        if (!ReadProcessMemory(
            process, item.text, textBuffer, new UIntPtr((uint)textBytes), out read
          ) || read.ToUInt64() != (ulong)textBytes) {
          throw new InvalidOperationException("PROVISIONING_WEBREQUEST_ALLOWLIST_LIST_READ_FAILED");
        }
        string decoded = System.Text.Encoding.Unicode.GetString(textBuffer);
        int terminator = decoded.IndexOf((char)0);
        string value = terminator < 0 ? decoded : decoded.Substring(0, terminator);
        if (value.Length > maxCharacters) {
          throw new InvalidOperationException("PROVISIONING_WEBREQUEST_ALLOWLIST_STATE_INVALID");
        }
        items.Add(value);
      }
      return items.ToArray();
    } finally {
      Marshal.FreeHGlobal(local);
      VirtualFreeEx(process, remote, UIntPtr.Zero, 0x8000);
      CloseHandle(process);
    }
  }

  public static void ReplaceListViewItems(
    IntPtr list,
    uint deleteAllItemsMessage,
    uint insertItemMessage,
    string[] values,
    int maxItems,
    int maxCharacters,
    uint timeout
  ) {
    if (values == null || values.Length > maxItems) {
      throw new InvalidOperationException("PROVISIONING_WEBREQUEST_ALLOWLIST_STATE_INVALID");
    }
    foreach (string value in values) {
      if (value == null || value.Length > maxCharacters || value.IndexOf((char)0) >= 0) {
        throw new InvalidOperationException("PROVISIONING_WEBREQUEST_ALLOWLIST_STATE_INVALID");
      }
    }
    IntPtr deleteResult;
    if (!TryMessage(
        list, deleteAllItemsMessage, IntPtr.Zero, IntPtr.Zero, timeout, out deleteResult
      ) || deleteResult == IntPtr.Zero) {
      throw new InvalidOperationException("PROVISIONING_WEBREQUEST_ALLOWLIST_LIST_WRITE_FAILED");
    }
    uint processId;
    GetWindowThreadProcessId(list, out processId);
    if (processId == 0) {
      throw new InvalidOperationException("PROVISIONING_WEBREQUEST_ALLOWLIST_CONTROL_INVALID");
    }
    var process = OpenProcess(0x0008 | 0x0020, false, processId);
    if (process == IntPtr.Zero) {
      throw new InvalidOperationException("PROVISIONING_WEBREQUEST_ALLOWLIST_LIST_WRITE_FAILED");
    }
    int itemSize = Marshal.SizeOf(typeof(ListViewItemState));
    int textBytes = checked((maxCharacters + 1) * 2);
    int totalBytes = checked(itemSize + textBytes);
    var remote = VirtualAllocEx(
      process, IntPtr.Zero, new UIntPtr((uint)totalBytes), 0x1000 | 0x2000, 0x04
    );
    if (remote == IntPtr.Zero) {
      CloseHandle(process);
      throw new InvalidOperationException("PROVISIONING_WEBREQUEST_ALLOWLIST_LIST_WRITE_FAILED");
    }
    var local = Marshal.AllocHGlobal(itemSize);
    try {
      for (int index = 0; index < values.Length; index++) {
        var encoded = System.Text.Encoding.Unicode.GetBytes(values[index] + (char)0);
        UIntPtr written;
        var remoteText = new IntPtr(remote.ToInt64() + itemSize);
        if (!WriteProcessMemory(
            process, remoteText, encoded, new UIntPtr((uint)encoded.Length), out written
          ) || written.ToUInt64() != (ulong)encoded.Length) {
          throw new InvalidOperationException("PROVISIONING_WEBREQUEST_ALLOWLIST_LIST_WRITE_FAILED");
        }
        var item = new ListViewItemState();
        item.mask = 0x0001;
        item.item = index;
        item.subItem = 0;
        item.text = remoteText;
        item.textLength = values[index].Length + 1;
        Marshal.StructureToPtr(item, local, false);
        var itemBytes = new byte[itemSize];
        Marshal.Copy(local, itemBytes, 0, itemSize);
        if (!WriteProcessMemory(
            process, remote, itemBytes, new UIntPtr((uint)itemSize), out written
          ) || written.ToUInt64() != (ulong)itemSize) {
          throw new InvalidOperationException("PROVISIONING_WEBREQUEST_ALLOWLIST_LIST_WRITE_FAILED");
        }
        IntPtr insertResult;
        if (!TryMessage(
            list, insertItemMessage, IntPtr.Zero, remote, timeout, out insertResult
          ) || insertResult.ToInt64() != index) {
          throw new InvalidOperationException("PROVISIONING_WEBREQUEST_ALLOWLIST_LIST_WRITE_FAILED");
        }
      }
    } finally {
      Marshal.FreeHGlobal(local);
      VirtualFreeEx(process, remote, UIntPtr.Zero, 0x8000);
      CloseHandle(process);
    }
  }

  public static int[] GetListViewActivationGeometry(
    IntPtr list,
    uint getItemRectangleMessage,
    uint hitTestMessage,
    int rectangleKind,
    int itemIndex,
    uint timeout
  ) {
    if (rectangleKind != 1 || itemIndex != 0) {
      throw new InvalidOperationException("PROVISIONING_WEBREQUEST_ALLOWLIST_HIT_INVALID");
    }
    NativeRectangle clientRectangle;
    if (!GetClientRect(list, out clientRectangle) ||
        clientRectangle.left != 0 || clientRectangle.top != 0 ||
        clientRectangle.right <= 0 || clientRectangle.bottom <= 0) {
      throw new InvalidOperationException("PROVISIONING_WEBREQUEST_ALLOWLIST_HIT_INVALID");
    }
    uint processId;
    GetWindowThreadProcessId(list, out processId);
    if (processId == 0) {
      throw new InvalidOperationException("PROVISIONING_WEBREQUEST_ALLOWLIST_CONTROL_INVALID");
    }
    var process = OpenProcess(0x0008 | 0x0010 | 0x0020, false, processId);
    if (process == IntPtr.Zero) {
      throw new InvalidOperationException("PROVISIONING_WEBREQUEST_ALLOWLIST_HIT_INVALID");
    }
    int rectangleSize = Marshal.SizeOf(typeof(NativeRectangle));
    int hitSize = Marshal.SizeOf(typeof(ListViewHitTestInfo));
    int allocationSize = Math.Max(rectangleSize, hitSize);
    var remote = VirtualAllocEx(
      process, IntPtr.Zero, new UIntPtr((uint)allocationSize), 0x1000 | 0x2000, 0x04
    );
    if (remote == IntPtr.Zero) {
      CloseHandle(process);
      throw new InvalidOperationException("PROVISIONING_WEBREQUEST_ALLOWLIST_HIT_INVALID");
    }
    var local = Marshal.AllocHGlobal(allocationSize);
    try {
      var rectangle = new NativeRectangle();
      rectangle.left = rectangleKind;
      Marshal.StructureToPtr(rectangle, local, false);
      var rectangleBytes = new byte[rectangleSize];
      Marshal.Copy(local, rectangleBytes, 0, rectangleSize);
      UIntPtr written;
      if (!WriteProcessMemory(
          process, remote, rectangleBytes, new UIntPtr((uint)rectangleSize), out written
        ) || written.ToUInt64() != (ulong)rectangleSize) {
        throw new InvalidOperationException("PROVISIONING_WEBREQUEST_ALLOWLIST_HIT_INVALID");
      }
      IntPtr rectangleResult;
      if (!TryMessage(
          list, getItemRectangleMessage, new IntPtr(itemIndex), remote, timeout,
          out rectangleResult
        ) || rectangleResult == IntPtr.Zero) {
        throw new InvalidOperationException("PROVISIONING_WEBREQUEST_ALLOWLIST_HIT_INVALID");
      }
      var rectangleOutput = new byte[rectangleSize];
      UIntPtr read;
      if (!ReadProcessMemory(
          process, remote, rectangleOutput, new UIntPtr((uint)rectangleSize), out read
        ) || read.ToUInt64() != (ulong)rectangleSize) {
        throw new InvalidOperationException("PROVISIONING_WEBREQUEST_ALLOWLIST_HIT_INVALID");
      }
      Marshal.Copy(rectangleOutput, 0, local, rectangleSize);
      rectangle = (NativeRectangle)Marshal.PtrToStructure(local, typeof(NativeRectangle));
      if (rectangle.left < 0 || rectangle.top < 0 ||
          rectangle.right <= rectangle.left || rectangle.bottom <= rectangle.top ||
          rectangle.right > clientRectangle.right ||
          rectangle.bottom > clientRectangle.bottom) {
        throw new InvalidOperationException("PROVISIONING_WEBREQUEST_ALLOWLIST_HIT_INVALID");
      }
      int x = rectangle.left + ((rectangle.right - rectangle.left) / 2);
      int y = rectangle.top + ((rectangle.bottom - rectangle.top) / 2);

      var hit = new ListViewHitTestInfo();
      hit.point.x = x;
      hit.point.y = y;
      Marshal.StructureToPtr(hit, local, false);
      var hitBytes = new byte[hitSize];
      Marshal.Copy(local, hitBytes, 0, hitSize);
      if (!WriteProcessMemory(
          process, remote, hitBytes, new UIntPtr((uint)hitSize), out written
        ) || written.ToUInt64() != (ulong)hitSize) {
        throw new InvalidOperationException("PROVISIONING_WEBREQUEST_ALLOWLIST_HIT_INVALID");
      }
      IntPtr hitResult;
      if (!TryMessage(
          list, hitTestMessage, IntPtr.Zero, remote, timeout, out hitResult
        ) || hitResult.ToInt64() < 0) {
        throw new InvalidOperationException("PROVISIONING_WEBREQUEST_ALLOWLIST_HIT_INVALID");
      }
      var hitOutput = new byte[hitSize];
      if (!ReadProcessMemory(
          process, remote, hitOutput, new UIntPtr((uint)hitSize), out read
        ) || read.ToUInt64() != (ulong)hitSize) {
        throw new InvalidOperationException("PROVISIONING_WEBREQUEST_ALLOWLIST_HIT_INVALID");
      }
      Marshal.Copy(hitOutput, 0, local, hitSize);
      hit = (ListViewHitTestInfo)Marshal.PtrToStructure(local, typeof(ListViewHitTestInfo));
      return new int[] {
        rectangle.left, rectangle.top, rectangle.right, rectangle.bottom,
        x, y, (int)hitResult.ToInt64(), unchecked((int)hit.flags), hit.item,
        clientRectangle.right, clientRectangle.bottom
      };
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
    WmChar = 0x0102
    WmKeyUp = 0x0101
    WmLButtonDown = 0x0201
    WmLButtonUp = 0x0202
    WmLButtonDoubleClick = 0x0203
    BmGetCheck = 0x00F0
    BmSetCheck = 0x00F1
    BmClick = 0x00F5
    TcmGetCurrentSelection = 0x130B
    VirtualKeyLeft = 0x25
    VirtualKeyRight = 0x27
    VirtualKeyReturn = 0x0D
    VirtualKeyDelete = 0x2E
    VirtualKeyShift = 0x10
    VirtualKeyCapsLock = 0x14
    VirtualKeyOem1 = 0xBA
    VirtualKeyOemPeriod = 0xBE
    VirtualKeyOem2 = 0xBF
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
    WmGetText = 0x000D
    WmGetTextLength = 0x000E
    KeyEventKeyUp = 0x0002
    KeyEventUnicode = 0x0004
    MouseEventMove = 0x0001
    MouseEventLeftDown = 0x0002
    MouseEventLeftUp = 0x0004
    MouseEventVirtualDesk = 0x4000
    MouseEventAbsolute = 0x8000
    CbGetCount = 0x0146
    CbGetCurrentSelection = 0x0147
    CbGetItemText = 0x0148
    CbGetItemTextLength = 0x0149
    CbSetCurrentSelection = 0x014E
    LvmGetItemCount = 0x1004
    LvmGetNextItem = 0x100C
    LvmGetSelectedCount = 0x1032
    LvmSetItemState = 0x102B
    LvmDeleteAllItems = 0x1009
    LvmGetItemText = 0x1073
    LvmInsertItem = 0x104D
    LvmGetItemRect = 0x100E
    LvmHitTest = 0x1012
    LvirIcon = 0x0001
    LvniSelected = 0x0002
    LvhtOnItemIcon = 0x0002
    LvhtOnItemLabel = 0x0004
    LvhtOnItemMask = 0x000E
    WebRequestList = 10191
    WebRequestEditor = 10325
    WebRequestAddEditor = 32954
    WebRequestMaxItems = 64
    WebRequestMaxCharacters = 2048
    UiMessageTimeoutMs = 2000
    OwnedTerminalCloseTimeoutMs = 15000
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

function ConvertTo-MT5VmWebRequestState {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][object]$State
  )

  $constants = Get-MT5VmTerminalUiConstants
  $enabledProperty = $State.PSObject.Properties['Enabled']
  $itemsProperty = $State.PSObject.Properties['Items']
  if ($null -eq $enabledProperty -or $enabledProperty.Value -notin 0, 1 -or
      $null -eq $itemsProperty) {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_STATE_INVALID'
  }
  $items = @($itemsProperty.Value)
  if ($items.Count -gt $constants.WebRequestMaxItems) {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_STATE_INVALID'
  }
  $normalizedItems = @()
  foreach ($item in $items) {
    if ($null -eq $item -or -not ($item -is [string]) -or
        ([string]$item).Length -gt $constants.WebRequestMaxCharacters -or
        ([string]$item).IndexOf([char]0) -ge 0) {
      throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_STATE_INVALID'
    }
    $normalizedItems += [string]$item
  }
  return [pscustomobject][ordered]@{
    Enabled = [int]$enabledProperty.Value
    Items = @($normalizedItems)
  }
}

function Assert-MT5VmDesiredWebRequestState {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][object]$State,
    [Parameter(Mandatory = $true)][string]$ExpectedOrigin
  )

  if ([string]::IsNullOrWhiteSpace($ExpectedOrigin)) {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_STATE_INVALID'
  }
  $normalized = ConvertTo-MT5VmWebRequestState -State $State
  $nonEmpty = @($normalized.Items | Where-Object { -not [string]::IsNullOrEmpty($_) })
  $blank = @($normalized.Items | Where-Object { [string]::IsNullOrEmpty($_) })
  if ($normalized.Enabled -ne 1 -or $blank.Count -gt 1 -or
      $nonEmpty.Count -ne 1 -or
      -not [string]::Equals(
        [string]$nonEmpty[0],
        $ExpectedOrigin,
        [StringComparison]::Ordinal
      )) {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_STATE_INVALID'
  }
  return $normalized
}

function Test-MT5VmWebRequestStateExact {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][object]$Left,
    [Parameter(Mandatory = $true)][object]$Right
  )

  $leftState = ConvertTo-MT5VmWebRequestState -State $Left
  $rightState = ConvertTo-MT5VmWebRequestState -State $Right
  if ($leftState.Enabled -ne $rightState.Enabled -or
      $leftState.Items.Count -ne $rightState.Items.Count) {
    return $false
  }
  for ($index = 0; $index -lt $leftState.Items.Count; $index++) {
    if (-not [string]::Equals(
        [string]$leftState.Items[$index],
        [string]$rightState.Items[$index],
        [StringComparison]::Ordinal
      )) {
      return $false
    }
  }
  return $true
}

function Test-MT5VmDesiredWebRequestState {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][object]$State,
    [Parameter(Mandatory = $true)][string]$ExpectedOrigin
  )

  try {
    $null = Assert-MT5VmDesiredWebRequestState `
      -State $State `
      -ExpectedOrigin $ExpectedOrigin
    return $true
  } catch {
    return $false
  }
}

function Get-MT5VmWebRequestControlMapBoundary {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][IntPtr]$OptionsHandle
  )

  try {
    Select-MT5VmExpertAdvisorsTabBoundary -OptionsHandle $OptionsHandle
    $constants = Get-MT5VmTerminalUiConstants
    $checkboxMatches = @([Mt5VmTerminalUiNative]::DescendantsWithControlId(
        $OptionsHandle,
        $constants.AllowWebRequest
      ))
    $listMatches = @([Mt5VmTerminalUiNative]::DescendantsWithControlId(
        $OptionsHandle,
        $constants.WebRequestList
      ))
    if ($checkboxMatches.Count -ne 1 -or $listMatches.Count -ne 1) {
      throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_CONTROL_INVALID'
    }
    $checkbox = [IntPtr]$checkboxMatches[0]
    $list = [IntPtr]$listMatches[0]
    if ([Mt5VmTerminalUiNative]::WindowClass($checkbox) -cne 'Button' -or
        [Mt5VmTerminalUiNative]::WindowClass($list) -cne 'SysListView32' -or
        -not [Mt5VmTerminalUiNative]::IsWindowVisible($checkbox) -or
        -not [Mt5VmTerminalUiNative]::IsWindowEnabled($checkbox) -or
        -not [Mt5VmTerminalUiNative]::IsWindowVisible($list)) {
      throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_CONTROL_INVALID'
    }
    return [ordered]@{
      Checkbox = $checkbox
      List = $list
    }
  } catch {
    if ([string]$_.Exception.Message -match '^PROVISIONING_WEBREQUEST_ALLOWLIST_') {
      throw
    }
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_CONTROL_INVALID'
  }
}

function Invoke-MT5VmBoundedUiMessage {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][IntPtr]$Handle,
    [Parameter(Mandatory = $true)][uint32]$Message,
    [IntPtr]$WParam = [IntPtr]::Zero,
    [IntPtr]$LParam = [IntPtr]::Zero
  )

  $constants = Get-MT5VmTerminalUiConstants
  $result = [IntPtr]::Zero
  if (-not [Mt5VmTerminalUiNative]::TryMessage(
      $Handle,
      $Message,
      $WParam,
      $LParam,
      [uint32]$constants.UiMessageTimeoutMs,
      [ref]$result
    )) {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_CONTROL_INVALID'
  }
  return $result
}

function Invoke-MT5VmQueuedUiMessageBoundary {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][IntPtr]$Handle,
    [Parameter(Mandatory = $true)][uint32]$Message,
    [IntPtr]$WParam = [IntPtr]::Zero,
    [IntPtr]$LParam = [IntPtr]::Zero
  )

  if ($Handle -eq [IntPtr]::Zero -or
      -not [Mt5VmTerminalUiNative]::TryPostMessage(
      $Handle,
      $Message,
      $WParam,
      $LParam
    )) {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_SEQUENCE_QUEUE_FAILED'
  }
  return $true
}

function Assert-MT5VmListActivationGeometry {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][int]$Left,
    [Parameter(Mandatory = $true)][int]$Top,
    [Parameter(Mandatory = $true)][int]$Right,
    [Parameter(Mandatory = $true)][int]$Bottom,
    [Parameter(Mandatory = $true)][int]$HitX,
    [Parameter(Mandatory = $true)][int]$HitY,
    [Parameter(Mandatory = $true)][int]$HitIndex,
    [Parameter(Mandatory = $true)][uint32]$HitFlags
  )

  $constants = Get-MT5VmTerminalUiConstants
  if ($Left -lt 0 -or $Top -lt 0 -or $Right -le $Left -or $Bottom -le $Top -or
      $Right -gt [int16]::MaxValue -or $Bottom -gt [int16]::MaxValue) {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_HIT_INVALID'
  }
  $expectedX = $Left + [int][Math]::Floor(($Right - $Left) / 2.0)
  $expectedY = $Top + [int][Math]::Floor(($Bottom - $Top) / 2.0)
  if ($HitX -ne $expectedX -or $HitY -ne $expectedY -or
      $HitX -lt $Left -or $HitX -ge $Right -or
      $HitY -lt $Top -or $HitY -ge $Bottom -or
      $HitIndex -ne 0 -or
      ($HitFlags -band [uint32]$constants.LvhtOnItemMask) -eq 0) {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_HIT_INVALID'
  }
  return [pscustomobject][ordered]@{
    x = $expectedX
    y = $expectedY
  }
}

function Assert-MT5VmIconActivationGeometry {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][int]$RectangleKind,
    [Parameter(Mandatory = $true)][int]$ClientWidth,
    [Parameter(Mandatory = $true)][int]$ClientHeight,
    [Parameter(Mandatory = $true)][int]$Left,
    [Parameter(Mandatory = $true)][int]$Top,
    [Parameter(Mandatory = $true)][int]$Right,
    [Parameter(Mandatory = $true)][int]$Bottom,
    [Parameter(Mandatory = $true)][int]$HitX,
    [Parameter(Mandatory = $true)][int]$HitY,
    [Parameter(Mandatory = $true)][int]$HitIndex,
    [Parameter(Mandatory = $true)][uint32]$HitFlags
  )

  $constants = Get-MT5VmTerminalUiConstants
  if ($RectangleKind -ne [int]$constants.LvirIcon -or
      $ClientWidth -lt 1 -or $ClientHeight -lt 1 -or
      $Left -lt 0 -or $Top -lt 0 -or $Right -le $Left -or $Bottom -le $Top -or
      $Right -gt $ClientWidth -or $Bottom -gt $ClientHeight -or
      ($HitFlags -band [uint32]$constants.LvhtOnItemIcon) -eq 0) {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_HIT_INVALID'
  }
  return Assert-MT5VmListActivationGeometry `
    -Left $Left `
    -Top $Top `
    -Right $Right `
    -Bottom $Bottom `
    -HitX $HitX `
    -HitY $HitY `
    -HitIndex $HitIndex `
    -HitFlags $HitFlags
}

function Get-MT5VmListActivationGeometryBoundary {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][IntPtr]$ListHandle
  )

  $constants = Get-MT5VmTerminalUiConstants
  $observed = [int[]][Mt5VmTerminalUiNative]::GetListViewActivationGeometry(
    $ListHandle,
    [uint32]$constants.LvmGetItemRect,
    [uint32]$constants.LvmHitTest,
    [int]$constants.LvirIcon,
    0,
    [uint32]$constants.UiMessageTimeoutMs
  )
  if ($observed.Count -ne 11 -or $observed[6] -ne $observed[8]) {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_HIT_INVALID'
  }
  return Assert-MT5VmIconActivationGeometry `
    -RectangleKind ([int]$constants.LvirIcon) `
    -ClientWidth $observed[9] `
    -ClientHeight $observed[10] `
    -Left $observed[0] `
    -Top $observed[1] `
    -Right $observed[2] `
    -Bottom $observed[3] `
    -HitX $observed[4] `
    -HitY $observed[5] `
    -HitIndex $observed[6] `
      -HitFlags ([uint32]$observed[7])
}

function Assert-MT5VmMouseActivationSequence {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][uint32[]]$Messages,
    [Parameter(Mandatory = $true)][long[]]$WParams,
    [Parameter(Mandatory = $true)][long[]]$LParams,
    [Parameter(Mandatory = $true)][long]$ExpectedPoint
  )

  $constants = Get-MT5VmTerminalUiConstants
  $expectedMessages = [uint32[]]@(
    $constants.WmLButtonDown,
    $constants.WmLButtonUp,
    $constants.WmLButtonDoubleClick,
    $constants.WmLButtonUp
  )
  $expectedFlags = [long[]]@(1, 0, 1, 0)
  if ($Messages.Count -ne 4 -or $WParams.Count -ne 4 -or $LParams.Count -ne 4) {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_SEQUENCE_INVALID'
  }
  for ($index = 0; $index -lt 4; $index++) {
    if ($Messages[$index] -ne $expectedMessages[$index] -or
        $WParams[$index] -ne $expectedFlags[$index] -or
        $LParams[$index] -ne $ExpectedPoint) {
      throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_SEQUENCE_INVALID'
    }
  }
  return $true
}

function Invoke-MT5VmMouseActivationSequenceBoundary {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][IntPtr]$Handle,
    [Parameter(Mandatory = $true)][uint32[]]$Messages,
    [Parameter(Mandatory = $true)][long[]]$WParams,
    [Parameter(Mandatory = $true)][long[]]$LParams,
    [Parameter(Mandatory = $true)][long]$ExpectedPoint
  )

  $null = Assert-MT5VmMouseActivationSequence `
    -Messages $Messages `
    -WParams $WParams `
    -LParams $LParams `
    -ExpectedPoint $ExpectedPoint
  for ($messageIndex = 0; $messageIndex -lt 4; $messageIndex++) {
    $null = Invoke-MT5VmQueuedUiMessageBoundary `
      -Handle $Handle `
      -Message $Messages[$messageIndex] `
      -WParam ([IntPtr]$WParams[$messageIndex]) `
      -LParam ([IntPtr]$LParams[$messageIndex])
  }
  return $true
}

function New-MT5VmAbsoluteMouseMoveInputPlan {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][int]$ScreenX,
    [Parameter(Mandatory = $true)][int]$ScreenY,
    [Parameter(Mandatory = $true)][int]$VirtualLeft,
    [Parameter(Mandatory = $true)][int]$VirtualTop,
    [Parameter(Mandatory = $true)][int]$VirtualWidth,
    [Parameter(Mandatory = $true)][int]$VirtualHeight
  )

  $right = [long]$VirtualLeft + [long]$VirtualWidth
  $bottom = [long]$VirtualTop + [long]$VirtualHeight
  if ($VirtualWidth -lt 2 -or $VirtualHeight -lt 2 -or
      [long]$ScreenX -lt [long]$VirtualLeft -or [long]$ScreenX -ge $right -or
      [long]$ScreenY -lt [long]$VirtualTop -or [long]$ScreenY -ge $bottom) {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_MOUSE_INVALID'
  }
  $constants = Get-MT5VmTerminalUiConstants
  $normalizedX = [int][Math]::Round(
    (([long]$ScreenX - [long]$VirtualLeft) * 65535.0) / ($VirtualWidth - 1)
  )
  $normalizedY = [int][Math]::Round(
    (([long]$ScreenY - [long]$VirtualTop) * 65535.0) / ($VirtualHeight - 1)
  )
  return ,([pscustomobject][ordered]@{
      Dx = $normalizedX
      Dy = $normalizedY
      MouseData = 0
      Flags = [long](
        $constants.MouseEventMove -bor
        $constants.MouseEventAbsolute -bor
        $constants.MouseEventVirtualDesk
      )
    })
}

function Assert-MT5VmExactDoubleClickInputPlan {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$Plan
  )

  $constants = Get-MT5VmTerminalUiConstants
  [long[]]$expectedFlags = @(
    $constants.MouseEventLeftDown,
    $constants.MouseEventLeftUp,
    $constants.MouseEventLeftDown,
    $constants.MouseEventLeftUp
  )
  if ($Plan.Count -ne $expectedFlags.Count) {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_MOUSE_INVALID'
  }
  for ($index = 0; $index -lt $expectedFlags.Count; $index++) {
    $record = $Plan[$index]
    foreach ($propertyName in @('Dx', 'Dy', 'MouseData', 'Flags')) {
      if ($null -eq $record -or $null -eq $record.PSObject.Properties[$propertyName]) {
        throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_MOUSE_INVALID'
      }
    }
    if ([int]$record.Dx -ne 0 -or [int]$record.Dy -ne 0 -or
        [int]$record.MouseData -ne 0 -or
        [long]$record.Flags -ne $expectedFlags[$index]) {
      throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_MOUSE_INVALID'
    }
  }
  return $true
}

function New-MT5VmExactDoubleClickInputPlan {
  [CmdletBinding()]
  param()

  $constants = Get-MT5VmTerminalUiConstants
  $plan = @(
    [pscustomobject][ordered]@{
      Dx = 0; Dy = 0; MouseData = 0; Flags = [long]$constants.MouseEventLeftDown
    },
    [pscustomobject][ordered]@{
      Dx = 0; Dy = 0; MouseData = 0; Flags = [long]$constants.MouseEventLeftUp
    },
    [pscustomobject][ordered]@{
      Dx = 0; Dy = 0; MouseData = 0; Flags = [long]$constants.MouseEventLeftDown
    },
    [pscustomobject][ordered]@{
      Dx = 0; Dy = 0; MouseData = 0; Flags = [long]$constants.MouseEventLeftUp
    }
  )
  $null = Assert-MT5VmExactDoubleClickInputPlan -Plan $plan
  return @($plan)
}

function Convert-MT5VmClientPointToScreenBoundary {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][IntPtr]$ListHandle,
    [Parameter(Mandatory = $true)][int]$ClientX,
    [Parameter(Mandatory = $true)][int]$ClientY
  )

  $point = [int[]][Mt5VmTerminalUiNative]::ClientPointToScreen(
    $ListHandle,
    $ClientX,
    $ClientY
  )
  if ($point.Count -ne 2) {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_MOUSE_INVALID'
  }
  return [pscustomobject][ordered]@{ x = $point[0]; y = $point[1] }
}

function Get-MT5VmVirtualScreenBoundary {
  [CmdletBinding()]
  param()

  $screen = [int[]][Mt5VmTerminalUiNative]::VirtualScreen()
  if ($screen.Count -ne 4 -or $screen[2] -lt 2 -or $screen[3] -lt 2) {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_MOUSE_INVALID'
  }
  return [pscustomobject][ordered]@{
    left = $screen[0]
    top = $screen[1]
    width = $screen[2]
    height = $screen[3]
  }
}

function Test-MT5VmPhysicalMouseActivationGuardBoundary {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][IntPtr]$OptionsHandle,
    [Parameter(Mandatory = $true)][IntPtr]$ListHandle,
    [Parameter(Mandatory = $true)][IntPtr]$CheckboxHandle,
    [Parameter(Mandatory = $true)][int]$ProcessId,
    [Parameter(Mandatory = $true)][int]$ScreenX,
    [Parameter(Mandatory = $true)][int]$ScreenY
  )

  $observedPointHandle = [IntPtr][Mt5VmTerminalUiNative]::WindowAtScreenPoint(
    $ScreenX,
    $ScreenY
  )
  $null = Assert-MT5VmPhysicalMousePointIdentity `
    -ExpectedListHandle $ListHandle `
    -ObservedPointHandle $observedPointHandle
  $constants = Get-MT5VmTerminalUiConstants
  return [bool][Mt5VmTerminalUiNative]::IsExactPhysicalMouseActivationGuard(
    $OptionsHandle,
    $ListHandle,
    $CheckboxHandle,
    [uint32]$ProcessId,
    $ScreenX,
    $ScreenY,
    [uint32]$constants.BmGetCheck,
    [uint32]$constants.UiMessageTimeoutMs
  )
}

function Assert-MT5VmPhysicalMousePointIdentity {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][IntPtr]$ExpectedListHandle,
    [Parameter(Mandatory = $true)][IntPtr]$ObservedPointHandle
  )

  if ($ExpectedListHandle -eq [IntPtr]::Zero -or
      $ObservedPointHandle -ne $ExpectedListHandle) {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_MOUSE_INVALID'
  }
  return $true
}

function Invoke-MT5VmNativeMouseInputBoundary {
  [CmdletBinding()]
  param([Parameter(Mandatory = $true)][object[]]$Plan)

  try {
    [int[]]$x = @($Plan | ForEach-Object { [int]$_.Dx })
    [int[]]$y = @($Plan | ForEach-Object { [int]$_.Dy })
    [uint32[]]$data = @($Plan | ForEach-Object { [uint32]$_.MouseData })
    [uint32[]]$flags = @($Plan | ForEach-Object { [uint32]$_.Flags })
    return [int][Mt5VmTerminalUiNative]::SendMouseInput($x, $y, $data, $flags)
  } catch {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_MOUSE_INVALID'
  }
}

function Invoke-MT5VmGuardedPhysicalMouseActivationBoundary {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][IntPtr]$OptionsHandle,
    [Parameter(Mandatory = $true)][IntPtr]$ListHandle,
    [Parameter(Mandatory = $true)][IntPtr]$CheckboxHandle,
    [Parameter(Mandatory = $true)][int]$ProcessId,
    [Parameter(Mandatory = $true)][int]$ClientX,
    [Parameter(Mandatory = $true)][int]$ClientY
  )

  $point = Convert-MT5VmClientPointToScreenBoundary `
    -ListHandle $ListHandle -ClientX $ClientX -ClientY $ClientY
  $screen = Get-MT5VmVirtualScreenBoundary
  $move = @(New-MT5VmAbsoluteMouseMoveInputPlan `
      -ScreenX ([int]$point.x) -ScreenY ([int]$point.y) `
      -VirtualLeft ([int]$screen.left) -VirtualTop ([int]$screen.top) `
      -VirtualWidth ([int]$screen.width) -VirtualHeight ([int]$screen.height))
  $clicks = @(New-MT5VmExactDoubleClickInputPlan)
  if (-not (Test-MT5VmPhysicalMouseActivationGuardBoundary `
      -OptionsHandle $OptionsHandle -ListHandle $ListHandle `
      -CheckboxHandle $CheckboxHandle -ProcessId $ProcessId `
      -ScreenX ([int]$point.x) -ScreenY ([int]$point.y)
    )) {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_MOUSE_INVALID'
  }
  if ((Invoke-MT5VmNativeMouseInputBoundary -Plan $move) -ne $move.Count) {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_MOUSE_INVALID'
  }
  if (-not (Test-MT5VmPhysicalMouseActivationGuardBoundary `
      -OptionsHandle $OptionsHandle -ListHandle $ListHandle `
      -CheckboxHandle $CheckboxHandle -ProcessId $ProcessId `
      -ScreenX ([int]$point.x) -ScreenY ([int]$point.y)
    )) {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_MOUSE_INVALID'
  }
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
  return $true
}

function Get-MT5VmCursorPositionBoundary {
  [CmdletBinding()]
  param()

  $position = [int[]][Mt5VmTerminalUiNative]::GetCursorPosition()
  if ($position.Count -ne 2) {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_MOUSE_INVALID'
  }
  return [pscustomobject][ordered]@{ x = $position[0]; y = $position[1] }
}

function Restore-MT5VmCursorPositionBoundary {
  [CmdletBinding()]
  param([Parameter(Mandatory = $true)][object]$Cursor)

  if ($null -eq $Cursor.PSObject.Properties['x'] -or
      $null -eq $Cursor.PSObject.Properties['y'] -or
      -not [Mt5VmTerminalUiNative]::TrySetCursorPosition(
        [int]$Cursor.x,
        [int]$Cursor.y
      )) {
    return $false
  }
  return $true
}

function Invoke-MT5VmPhysicalMouseActivationTransactionCore {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][scriptblock]$CaptureCursorAction,
    [Parameter(Mandatory = $true)][scriptblock]$ActivationAction,
    [Parameter(Mandatory = $true)][scriptblock]$ContinuationAction,
    [Parameter(Mandatory = $true)][scriptblock]$RestoreCursorAction
  )

  $cursor = & $CaptureCursorAction
  $originalFailure = $null
  $result = $null
  try {
    $null = & $ActivationAction
    $result = & $ContinuationAction
  } catch {
    $originalFailure = $_.Exception
  }
  try {
    if ((& $RestoreCursorAction $cursor) -ne $true) {
      throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_CURSOR_RESTORE_FAILED'
    }
  } catch {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_CURSOR_RESTORE_FAILED'
  }
  if ($null -ne $originalFailure) {
    throw $originalFailure
  }
  return $result
}

function Assert-MT5VmWebRequestEditorCandidate {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][int]$ExpectedControlId,
    [Parameter(Mandatory = $true)][int]$ObservedControlId,
    [Parameter(Mandatory = $true)][int]$CandidateCount,
    [Parameter(Mandatory = $true)][AllowEmptyString()][string]$WindowClass,
    [Parameter(Mandatory = $true)][bool]$Visible,
    [Parameter(Mandatory = $true)][bool]$Enabled,
    [Parameter(Mandatory = $true)][int]$ExpectedProcessId,
    [Parameter(Mandatory = $true)][int]$ObservedProcessId
  )

  $constants = Get-MT5VmTerminalUiConstants
  if ($ExpectedControlId -ne [int]$constants.WebRequestAddEditor -or
      $ObservedControlId -ne $ExpectedControlId -or
      $CandidateCount -ne 1 -or
      $WindowClass -cne 'Edit' -or
      -not $Visible -or -not $Enabled -or
      $ExpectedProcessId -lt 1 -or $ObservedProcessId -ne $ExpectedProcessId) {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_EDITOR_INVALID'
  }
  return $true
}

function Assert-MT5VmEditorCommitSequence {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][uint32[]]$Messages,
    [Parameter(Mandatory = $true)][long[]]$WParams
  )

  $constants = Get-MT5VmTerminalUiConstants
  $expectedMessages = [uint32[]]@(
    $constants.WmKeyDown,
    $constants.WmChar,
    $constants.WmKeyUp
  )
  if ($Messages.Count -ne 3 -or $WParams.Count -ne 3) {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_EDITOR_INVALID'
  }
  for ($index = 0; $index -lt 3; $index++) {
    if ($Messages[$index] -ne $expectedMessages[$index] -or
        $WParams[$index] -ne [long]$constants.VirtualKeyReturn) {
      throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_EDITOR_INVALID'
    }
  }
  return $true
}

function Invoke-MT5VmEditorCommitSequenceBoundary {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][IntPtr]$EditorHandle
  )

  $constants = Get-MT5VmTerminalUiConstants
  $messages = [uint32[]]@(
    $constants.WmKeyDown,
    $constants.WmChar,
    $constants.WmKeyUp
  )
  $wParams = [long[]]@(
    $constants.VirtualKeyReturn,
    $constants.VirtualKeyReturn,
    $constants.VirtualKeyReturn
  )
  $null = Assert-MT5VmEditorCommitSequence `
    -Messages $messages `
    -WParams $wParams
  for ($index = 0; $index -lt 3; $index++) {
    try {
      $null = Invoke-MT5VmBoundedUiMessage `
        -Handle $EditorHandle `
        -Message $messages[$index] `
        -WParam ([IntPtr]$wParams[$index]) `
        -LParam ([IntPtr]::Zero)
    } catch {
      throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_EDITOR_INVALID'
    }
  }
  return $true
}

function Assert-MT5VmExactOriginCharacterStream {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$Origin,
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][long[]]$CharacterCodes,
    [Parameter(Mandatory = $true)][string]$ExpectedOrigin
  )

  if ([string]::IsNullOrWhiteSpace($Origin) -or
      $Origin.Contains([char]0) -or
      -not [string]::Equals($Origin, $ExpectedOrigin, [StringComparison]::Ordinal) -or
      $CharacterCodes.Count -ne $Origin.Length) {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_EDITOR_INVALID'
  }
  for ($index = 0; $index -lt $Origin.Length; $index++) {
    if ($CharacterCodes[$index] -eq 0 -or
        $CharacterCodes[$index] -ne [long][int]$Origin[$index]) {
      throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_EDITOR_INVALID'
    }
  }
  return $true
}

function Set-MT5VmEditorTextBoundary {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][IntPtr]$EditorHandle,
    [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Text
  )

  $constants = Get-MT5VmTerminalUiConstants
  if (-not [Mt5VmTerminalUiNative]::TrySetText(
      $EditorHandle,
      [uint32]$constants.WmSetText,
      $Text,
      [uint32]$constants.UiMessageTimeoutMs
    )) {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_EDITOR_INVALID'
  }
  return $true
}

function Read-MT5VmEditorTextBoundary {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][IntPtr]$EditorHandle
  )

  $constants = Get-MT5VmTerminalUiConstants
  return [Mt5VmTerminalUiNative]::ReadBoundedText(
    $EditorHandle,
    [uint32]$constants.WmGetTextLength,
    [uint32]$constants.WmGetText,
    [int]$constants.WebRequestMaxCharacters,
    [uint32]$constants.UiMessageTimeoutMs
  )
}

function Invoke-MT5VmExactEditorTextBoundary {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][IntPtr]$EditorHandle,
    [Parameter(Mandatory = $true)][string]$ExpectedOrigin
  )

  $constants = Get-MT5VmTerminalUiConstants
  $null = Set-MT5VmEditorTextBoundary -EditorHandle $EditorHandle -Text ''
  [long[]]$characterCodes = @(
    $ExpectedOrigin.ToCharArray() | ForEach-Object { [long][int]$_ }
  )
  $null = Assert-MT5VmExactOriginCharacterStream `
    -Origin $ExpectedOrigin `
    -CharacterCodes $characterCodes `
    -ExpectedOrigin $ExpectedOrigin
  foreach ($characterCode in $characterCodes) {
    try {
      $null = Invoke-MT5VmBoundedUiMessage `
        -Handle $EditorHandle `
        -Message ([uint32]$constants.WmChar) `
        -WParam ([IntPtr]$characterCode) `
        -LParam ([IntPtr]::Zero)
    } catch {
      throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_EDITOR_INVALID'
    }
  }
  $readback = Read-MT5VmEditorTextBoundary -EditorHandle $EditorHandle
  if (-not [string]::Equals(
      [string]$readback,
      $ExpectedOrigin,
      [StringComparison]::Ordinal
    )) {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_EDITOR_INVALID'
  }
  try {
    $null = Invoke-MT5VmBoundedUiMessage `
      -Handle $EditorHandle `
      -Message ([uint32]$constants.WmChar) `
      -WParam ([IntPtr]$constants.VirtualKeyReturn) `
      -LParam ([IntPtr]::Zero)
  } catch {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_EDITOR_INVALID'
  }
  return $true
}

function Invoke-MT5VmQueuedExactEditorTextBoundary {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][IntPtr]$EditorHandle,
    [Parameter(Mandatory = $true)][string]$ExpectedOrigin
  )

  $constants = Get-MT5VmTerminalUiConstants
  $null = Set-MT5VmEditorTextBoundary -EditorHandle $EditorHandle -Text ''
  [long[]]$characterCodes = @(
    $ExpectedOrigin.ToCharArray() | ForEach-Object { [long][int]$_ }
  )
  $null = Assert-MT5VmExactOriginCharacterStream `
    -Origin $ExpectedOrigin `
    -CharacterCodes $characterCodes `
    -ExpectedOrigin $ExpectedOrigin
  foreach ($characterCode in $characterCodes) {
    try {
      $null = Invoke-MT5VmQueuedUiMessageBoundary `
        -Handle $EditorHandle `
        -Message ([uint32]$constants.WmChar) `
        -WParam ([IntPtr]$characterCode) `
        -LParam ([IntPtr]::Zero)
    } catch {
      throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_EDITOR_INVALID'
    }
  }

  $readbackExact = $false
  for ($attempt = 0; $attempt -lt 25; $attempt++) {
    try {
      $readback = Read-MT5VmEditorTextBoundary -EditorHandle $EditorHandle
    } catch {
      throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_EDITOR_INVALID'
    }
    if ([string]::Equals(
        [string]$readback,
        $ExpectedOrigin,
        [StringComparison]::Ordinal
      )) {
      $readbackExact = $true
      break
    }
    Start-Sleep -Milliseconds 100
  }
  if (-not $readbackExact) {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_EDITOR_INVALID'
  }

  try {
    $null = Invoke-MT5VmQueuedUiMessageBoundary `
      -Handle $EditorHandle `
      -Message ([uint32]$constants.WmChar) `
      -WParam ([IntPtr]$constants.VirtualKeyReturn) `
      -LParam ([IntPtr]::Zero)
  } catch {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_EDITOR_INVALID'
  }
  return $true
}

function New-MT5VmExactKeyboardInputPlan {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$Origin,
    [Parameter(Mandatory = $true)][string]$ExpectedOrigin
  )

  $constants = Get-MT5VmTerminalUiConstants
  [long[]]$characterCodes = @(
    $Origin.ToCharArray() | ForEach-Object { [long][int]$_ }
  )
  $null = Assert-MT5VmExactOriginCharacterStream `
    -Origin $Origin `
    -CharacterCodes $characterCodes `
    -ExpectedOrigin $ExpectedOrigin
  $plan = [Collections.Generic.List[object]]::new()
  foreach ($characterCode in $characterCodes) {
    $plan.Add([pscustomobject][ordered]@{
        VirtualKey = 0
        ScanCode = $characterCode
        Flags = [long]$constants.KeyEventUnicode
      })
    $plan.Add([pscustomobject][ordered]@{
        VirtualKey = 0
        ScanCode = $characterCode
        Flags = [long]($constants.KeyEventUnicode -bor $constants.KeyEventKeyUp)
      })
  }
  $plan.Add([pscustomobject][ordered]@{
      VirtualKey = [long]$constants.VirtualKeyReturn
      ScanCode = 0
      Flags = 0
    })
  $plan.Add([pscustomobject][ordered]@{
      VirtualKey = [long]$constants.VirtualKeyReturn
      ScanCode = 0
      Flags = [long]$constants.KeyEventKeyUp
    })
  $result = @($plan)
  $null = Assert-MT5VmExactKeyboardInputPlan `
    -Origin $Origin `
    -Plan $result `
    -ExpectedOrigin $ExpectedOrigin
  return $result
}

function Assert-MT5VmExactKeyboardInputPlan {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$Origin,
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$Plan,
    [Parameter(Mandatory = $true)][string]$ExpectedOrigin
  )

  try {
    $constants = Get-MT5VmTerminalUiConstants
    [long[]]$characterCodes = @(
      $Origin.ToCharArray() | ForEach-Object { [long][int]$_ }
    )
    $null = Assert-MT5VmExactOriginCharacterStream `
      -Origin $Origin `
      -CharacterCodes $characterCodes `
      -ExpectedOrigin $ExpectedOrigin
    if ($Plan.Count -ne (($characterCodes.Count * 2) + 2)) {
      throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_EDITOR_INVALID'
    }
    for ($characterIndex = 0; $characterIndex -lt $characterCodes.Count; $characterIndex++) {
      $down = $Plan[$characterIndex * 2]
      $up = $Plan[($characterIndex * 2) + 1]
      foreach ($record in @($down, $up)) {
        foreach ($propertyName in @('VirtualKey', 'ScanCode', 'Flags')) {
          if ($null -eq $record -or
              $null -eq $record.PSObject.Properties[$propertyName]) {
            throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_EDITOR_INVALID'
          }
        }
      }
      if ([long]$down.VirtualKey -ne 0 -or
          [long]$down.ScanCode -ne $characterCodes[$characterIndex] -or
          [long]$down.Flags -ne [long]$constants.KeyEventUnicode -or
          [long]$up.VirtualKey -ne 0 -or
          [long]$up.ScanCode -ne $characterCodes[$characterIndex] -or
          [long]$up.Flags -ne [long](
            $constants.KeyEventUnicode -bor $constants.KeyEventKeyUp
          )) {
        throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_EDITOR_INVALID'
      }
    }
    $returnDown = $Plan[$Plan.Count - 2]
    $returnUp = $Plan[$Plan.Count - 1]
    foreach ($record in @($returnDown, $returnUp)) {
      foreach ($propertyName in @('VirtualKey', 'ScanCode', 'Flags')) {
        if ($null -eq $record -or
            $null -eq $record.PSObject.Properties[$propertyName]) {
          throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_EDITOR_INVALID'
        }
      }
    }
    if ([long]$returnDown.VirtualKey -ne [long]$constants.VirtualKeyReturn -or
        [long]$returnDown.ScanCode -ne 0 -or [long]$returnDown.Flags -ne 0 -or
        [long]$returnUp.VirtualKey -ne [long]$constants.VirtualKeyReturn -or
        [long]$returnUp.ScanCode -ne 0 -or
        [long]$returnUp.Flags -ne [long]$constants.KeyEventKeyUp) {
      throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_EDITOR_INVALID'
    }
  } catch {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_EDITOR_INVALID'
  }
  return $true
}

function Test-MT5VmExactEditorInputGuardBoundary {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][IntPtr]$OptionsHandle,
    [Parameter(Mandatory = $true)][IntPtr]$EditorHandle,
    [Parameter(Mandatory = $true)][int]$ProcessId
  )

  if ($ProcessId -lt 1) { return $false }
  return [Mt5VmTerminalUiNative]::IsExactForegroundFocus(
    $OptionsHandle,
    $EditorHandle,
    [uint32]$ProcessId
  )
}

function Invoke-MT5VmNativeKeyboardInputBoundary {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][object[]]$Plan
  )

  try {
    [uint16[]]$virtualKeys = @($Plan | ForEach-Object { [uint16]$_.VirtualKey })
    [uint16[]]$scanCodes = @($Plan | ForEach-Object { [uint16]$_.ScanCode })
    [uint32[]]$flags = @($Plan | ForEach-Object { [uint32]$_.Flags })
    return [int][Mt5VmTerminalUiNative]::SendKeyboardInput(
      $virtualKeys,
      $scanCodes,
      $flags
    )
  } catch {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_EDITOR_INVALID'
  }
}

function Invoke-MT5VmGuardedExactKeyboardInputBoundary {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][IntPtr]$OptionsHandle,
    [Parameter(Mandatory = $true)][IntPtr]$EditorHandle,
    [Parameter(Mandatory = $true)][int]$ProcessId,
    [Parameter(Mandatory = $true)][string]$ExpectedOrigin
  )

  $plan = @(New-MT5VmExactKeyboardInputPlan `
      -Origin $ExpectedOrigin `
      -ExpectedOrigin $ExpectedOrigin)
  $null = Assert-MT5VmExactKeyboardInputPlan `
    -Origin $ExpectedOrigin `
    -Plan $plan `
    -ExpectedOrigin $ExpectedOrigin
  $null = Set-MT5VmEditorTextBoundary -EditorHandle $EditorHandle -Text ''
  if (-not (Test-MT5VmExactEditorInputGuardBoundary `
      -OptionsHandle $OptionsHandle `
      -EditorHandle $EditorHandle `
      -ProcessId $ProcessId
    )) {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_EDITOR_INVALID'
  }
  $inserted = Invoke-MT5VmNativeKeyboardInputBoundary -Plan $plan
  if ([int]$inserted -ne $plan.Count) {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_EDITOR_INVALID'
  }
  return $true
}

function ConvertTo-MT5VmExactVirtualKeyRecords {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][char[]]$Characters
  )

  $constants = Get-MT5VmTerminalUiConstants
  $records = [Collections.Generic.List[object]]::new()
  foreach ($character in $Characters) {
    $characterCode = [int]$character
    $virtualKey = 0
    if ($characterCode -ge [int][char]'a' -and
        $characterCode -le [int][char]'z') {
      $virtualKey = $characterCode - 32
    } elseif ($characterCode -ge [int][char]'0' -and
        $characterCode -le [int][char]'9') {
      $virtualKey = $characterCode
    } elseif ($characterCode -eq [int][char]'.') {
      $virtualKey = [int]$constants.VirtualKeyOemPeriod
    } elseif ($characterCode -eq [int][char]'/') {
      $virtualKey = [int]$constants.VirtualKeyOem2
    } elseif ($characterCode -eq [int][char]':') {
      $records.Add([pscustomobject][ordered]@{
          VirtualKey = [long]$constants.VirtualKeyShift
          ScanCode = 0
          Flags = 0
        })
      $records.Add([pscustomobject][ordered]@{
          VirtualKey = [long]$constants.VirtualKeyOem1
          ScanCode = 0
          Flags = 0
        })
      $records.Add([pscustomobject][ordered]@{
          VirtualKey = [long]$constants.VirtualKeyOem1
          ScanCode = 0
          Flags = [long]$constants.KeyEventKeyUp
        })
      $records.Add([pscustomobject][ordered]@{
          VirtualKey = [long]$constants.VirtualKeyShift
          ScanCode = 0
          Flags = [long]$constants.KeyEventKeyUp
        })
      continue
    } else {
      throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_EDITOR_INVALID'
    }
    $records.Add([pscustomobject][ordered]@{
        VirtualKey = [long]$virtualKey
        ScanCode = 0
        Flags = 0
      })
    $records.Add([pscustomobject][ordered]@{
        VirtualKey = [long]$virtualKey
        ScanCode = 0
        Flags = [long]$constants.KeyEventKeyUp
      })
  }
  return @($records)
}

function Assert-MT5VmExactVirtualKeyInputPlan {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$Origin,
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$Plan,
    [Parameter(Mandatory = $true)][string]$ExpectedOrigin
  )

  try {
    [long[]]$characterCodes = @(
      $Origin.ToCharArray() | ForEach-Object { [long][int]$_ }
    )
    $null = Assert-MT5VmExactOriginCharacterStream `
      -Origin $Origin `
      -CharacterCodes $characterCodes `
      -ExpectedOrigin $ExpectedOrigin
    $expected = @(ConvertTo-MT5VmExactVirtualKeyRecords `
        -Characters $Origin.ToCharArray())
    if ($Plan.Count -ne $expected.Count) {
      throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_EDITOR_INVALID'
    }
    for ($index = 0; $index -lt $expected.Count; $index++) {
      foreach ($propertyName in @('VirtualKey', 'ScanCode', 'Flags')) {
        if ($null -eq $Plan[$index] -or
            $null -eq $Plan[$index].PSObject.Properties[$propertyName]) {
          throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_EDITOR_INVALID'
        }
      }
      if ([long]$Plan[$index].VirtualKey -ne [long]$expected[$index].VirtualKey -or
          [long]$Plan[$index].ScanCode -ne [long]$expected[$index].ScanCode -or
          [long]$Plan[$index].Flags -ne [long]$expected[$index].Flags) {
        throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_EDITOR_INVALID'
      }
    }
  } catch {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_EDITOR_INVALID'
  }
  return $true
}

function New-MT5VmExactVirtualKeyInputPlan {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$Origin,
    [Parameter(Mandatory = $true)][string]$ExpectedOrigin
  )

  [long[]]$characterCodes = @(
    $Origin.ToCharArray() | ForEach-Object { [long][int]$_ }
  )
  $null = Assert-MT5VmExactOriginCharacterStream `
    -Origin $Origin `
    -CharacterCodes $characterCodes `
    -ExpectedOrigin $ExpectedOrigin
  $plan = @(ConvertTo-MT5VmExactVirtualKeyRecords -Characters $Origin.ToCharArray())
  $null = Assert-MT5VmExactVirtualKeyInputPlan `
    -Origin $Origin `
    -Plan $plan `
    -ExpectedOrigin $ExpectedOrigin
  return $plan
}

function Assert-MT5VmExactReturnKeyInputPlan {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$Plan
  )

  $constants = Get-MT5VmTerminalUiConstants
  if ($Plan.Count -ne 2) {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_EDITOR_INVALID'
  }
  foreach ($record in $Plan) {
    foreach ($propertyName in @('VirtualKey', 'ScanCode', 'Flags')) {
      if ($null -eq $record -or
          $null -eq $record.PSObject.Properties[$propertyName]) {
        throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_EDITOR_INVALID'
      }
    }
  }
  if ([long]$Plan[0].VirtualKey -ne [long]$constants.VirtualKeyReturn -or
      [long]$Plan[0].ScanCode -ne 0 -or [long]$Plan[0].Flags -ne 0 -or
      [long]$Plan[1].VirtualKey -ne [long]$constants.VirtualKeyReturn -or
      [long]$Plan[1].ScanCode -ne 0 -or
      [long]$Plan[1].Flags -ne [long]$constants.KeyEventKeyUp) {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_EDITOR_INVALID'
  }
  return $true
}

function New-MT5VmReturnKeyInputPlan {
  [CmdletBinding()]
  param()

  $constants = Get-MT5VmTerminalUiConstants
  $plan = @(
    [pscustomobject][ordered]@{
      VirtualKey = [long]$constants.VirtualKeyReturn
      ScanCode = 0
      Flags = 0
    },
    [pscustomobject][ordered]@{
      VirtualKey = [long]$constants.VirtualKeyReturn
      ScanCode = 0
      Flags = [long]$constants.KeyEventKeyUp
    }
  )
  $null = Assert-MT5VmExactReturnKeyInputPlan -Plan $plan
  return $plan
}

function Test-MT5VmCapsLockOffBoundary {
  [CmdletBinding()]
  param()

  $constants = Get-MT5VmTerminalUiConstants
  return [Mt5VmTerminalUiNative]::IsToggleKeyOff(
    [int]$constants.VirtualKeyCapsLock
  )
}

function Invoke-MT5VmGuardedExactVirtualKeyStageBoundary {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][IntPtr]$OptionsHandle,
    [Parameter(Mandatory = $true)][IntPtr]$EditorHandle,
    [Parameter(Mandatory = $true)][int]$ProcessId,
    [Parameter(Mandatory = $true)][string]$ExpectedOrigin
  )

  $characterPlan = @(New-MT5VmExactVirtualKeyInputPlan `
      -Origin $ExpectedOrigin `
      -ExpectedOrigin $ExpectedOrigin)
  $null = Set-MT5VmEditorTextBoundary -EditorHandle $EditorHandle -Text ''
  if (-not (Test-MT5VmCapsLockOffBoundary)) {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_EDITOR_INVALID'
  }
  if (-not (Test-MT5VmExactEditorInputGuardBoundary `
      -OptionsHandle $OptionsHandle `
      -EditorHandle $EditorHandle `
      -ProcessId $ProcessId
    )) {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_EDITOR_INVALID'
  }
  $insertedCharacters = Invoke-MT5VmNativeKeyboardInputBoundary -Plan $characterPlan
  if ([int]$insertedCharacters -ne $characterPlan.Count) {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_EDITOR_INVALID'
  }

  $readbackExact = $false
  for ($attempt = 0; $attempt -lt 25; $attempt++) {
    try {
      $readback = Read-MT5VmEditorTextBoundary -EditorHandle $EditorHandle
    } catch {
      throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_EDITOR_INVALID'
    }
    if ([string]::Equals(
        [string]$readback,
        $ExpectedOrigin,
        [StringComparison]::Ordinal
      )) {
      $readbackExact = $true
      break
    }
    Start-Sleep -Milliseconds 100
  }
  if (-not $readbackExact) {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_EDITOR_INVALID'
  }
  if (-not (Test-MT5VmExactEditorInputGuardBoundary `
      -OptionsHandle $OptionsHandle `
      -EditorHandle $EditorHandle `
      -ProcessId $ProcessId
    )) {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_EDITOR_INVALID'
  }
  return $true
}

function Get-MT5VmWebRequestEditorBoundary {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][IntPtr]$OptionsHandle,
    [Parameter(Mandatory = $true)][int]$ProcessId
  )

  $constants = Get-MT5VmTerminalUiConstants
  $matches = @([Mt5VmTerminalUiNative]::DescendantsWithControlId(
      $OptionsHandle,
      $constants.WebRequestAddEditor
    ))
  if ($matches.Count -eq 0) {
    return [IntPtr]::Zero
  }
  if ($matches.Count -ne 1) {
    $null = Assert-MT5VmWebRequestEditorCandidate `
      -ExpectedControlId ([int]$constants.WebRequestAddEditor) `
      -ObservedControlId ([int]$constants.WebRequestAddEditor) `
      -CandidateCount $matches.Count `
      -WindowClass '' `
      -Visible $false `
      -Enabled $false `
      -ExpectedProcessId $ProcessId `
      -ObservedProcessId 0
  }
  $editor = [IntPtr]$matches[0]
  $null = Assert-MT5VmWebRequestEditorCandidate `
    -ExpectedControlId ([int]$constants.WebRequestAddEditor) `
    -ObservedControlId ([Mt5VmTerminalUiNative]::GetDlgCtrlID($editor)) `
    -CandidateCount $matches.Count `
    -WindowClass ([Mt5VmTerminalUiNative]::WindowClass($editor)) `
    -Visible ([Mt5VmTerminalUiNative]::IsWindowVisible($editor)) `
    -Enabled ([Mt5VmTerminalUiNative]::IsWindowEnabled($editor)) `
    -ExpectedProcessId $ProcessId `
    -ObservedProcessId ([int][Mt5VmTerminalUiNative]::WindowProcessId($editor))
  return $editor
}

function Invoke-MT5VmWebRequestEditorApplyBoundary {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][IntPtr]$OptionsHandle,
    [Parameter(Mandatory = $true)][string]$ExpectedOrigin
  )

  $before = Read-MT5VmWebRequestStateBoundary -OptionsHandle $OptionsHandle
  if ($before.Enabled -ne 0 -or $before.Items.Count -ne 1 -or
      -not [string]::IsNullOrEmpty([string]$before.Items[0])) {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_STATE_INVALID'
  }
  $constants = Get-MT5VmTerminalUiConstants
  $controls = Get-MT5VmWebRequestControlMapBoundary -OptionsHandle $OptionsHandle
  $null = Invoke-MT5VmBoundedUiMessage `
    -Handle ([IntPtr]$controls.Checkbox) `
    -Message ([uint32]$constants.BmClick)
  $controlsReady = $false
  for ($attempt = 0; $attempt -lt 25; $attempt++) {
    $checked = Invoke-MT5VmBoundedUiMessage `
      -Handle ([IntPtr]$controls.Checkbox) `
      -Message ([uint32]$constants.BmGetCheck)
    if ([int]$checked.ToInt64() -eq 1 -and
        [Mt5VmTerminalUiNative]::IsWindowEnabled([IntPtr]$controls.List)) {
      $controlsReady = $true
      break
    }
    Start-Sleep -Milliseconds 100
  }
  if (-not $controlsReady) {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_CONTROL_INVALID'
  }

  $geometry = Get-MT5VmListActivationGeometryBoundary `
    -ListHandle ([IntPtr]$controls.List)
  $terminalProcessId = [int][Mt5VmTerminalUiNative]::WindowProcessId($OptionsHandle)
  if ($terminalProcessId -lt 1) {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_EDITOR_INVALID'
  }
  $null = Invoke-MT5VmPhysicalMouseActivationTransactionCore `
    -CaptureCursorAction {
      return Get-MT5VmCursorPositionBoundary
    } `
    -ActivationAction {
      return Invoke-MT5VmGuardedPhysicalMouseActivationBoundary `
        -OptionsHandle $OptionsHandle `
        -ListHandle ([IntPtr]$controls.List) `
        -CheckboxHandle ([IntPtr]$controls.Checkbox) `
        -ProcessId $terminalProcessId `
        -ClientX ([int]$geometry.x) `
        -ClientY ([int]$geometry.y)
    } `
    -ContinuationAction {
      $editor = [IntPtr]::Zero
      for ($attempt = 0; $attempt -lt 25; $attempt++) {
        $editor = Get-MT5VmWebRequestEditorBoundary `
          -OptionsHandle $OptionsHandle `
          -ProcessId $terminalProcessId
        if ($editor -ne [IntPtr]::Zero) { break }
        Start-Sleep -Milliseconds 100
      }
      if ($editor -eq [IntPtr]::Zero) {
        throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_EDITOR_INVALID'
      }
      $null = Invoke-MT5VmGuardedExactVirtualKeyStageBoundary `
        -OptionsHandle $OptionsHandle `
        -EditorHandle $editor `
        -ProcessId $terminalProcessId `
        -ExpectedOrigin $ExpectedOrigin
      return $true
    } `
    -RestoreCursorAction {
      param($cursor)
      return Restore-MT5VmCursorPositionBoundary -Cursor $cursor
    }
}

function Read-MT5VmWebRequestStateBoundary {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][IntPtr]$OptionsHandle
  )

  $constants = Get-MT5VmTerminalUiConstants
  $controls = Get-MT5VmWebRequestControlMapBoundary -OptionsHandle $OptionsHandle
  $enabledResult = Invoke-MT5VmBoundedUiMessage `
    -Handle ([IntPtr]$controls.Checkbox) `
    -Message ([uint32]$constants.BmGetCheck)
  $enabled = [int]$enabledResult.ToInt64()
  if ($enabled -notin 0, 1) {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_STATE_INVALID'
  }
  $items = @([Mt5VmTerminalUiNative]::ReadListViewItems(
      [IntPtr]$controls.List,
      [uint32]$constants.LvmGetItemCount,
      [uint32]$constants.LvmGetItemText,
      [int]$constants.WebRequestMaxItems,
      [int]$constants.WebRequestMaxCharacters,
      [uint32]$constants.UiMessageTimeoutMs
    ))
  return ConvertTo-MT5VmWebRequestState -State ([pscustomobject][ordered]@{
      Enabled = $enabled
      Items = @($items)
    })
}

function Select-MT5VmWebRequestListItemBoundary {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][IntPtr]$ListHandle,
    [Parameter(Mandatory = $true)][int]$ItemIndex
  )

  $constants = Get-MT5VmTerminalUiConstants
  return [bool][Mt5VmTerminalUiNative]::TrySelectListItem(
    $ListHandle,
    [uint32]$constants.LvmSetItemState,
    $ItemIndex,
    [uint32]$constants.UiMessageTimeoutMs
  )
}

function Remove-MT5VmWebRequestItemsBoundary {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][IntPtr]$OptionsHandle,
    [Parameter(Mandatory = $true)][IntPtr]$ListHandle
  )

  $constants = Get-MT5VmTerminalUiConstants
  $before = Read-MT5VmWebRequestStateBoundary -OptionsHandle $OptionsHandle
  $realItemCount = @($before.Items | Where-Object {
      -not [string]::IsNullOrEmpty([string]$_)
    }).Count
  for ($index = 0; $index -lt $realItemCount; $index++) {
    if (-not (Select-MT5VmWebRequestListItemBoundary `
        -ListHandle $ListHandle -ItemIndex 0
      )) {
      throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_LIST_WRITE_FAILED'
    }
    $null = Invoke-MT5VmBoundedUiMessage `
      -Handle $ListHandle `
      -Message ([uint32]$constants.WmKeyDown) `
      -WParam ([IntPtr]$constants.VirtualKeyDelete)
    $null = Invoke-MT5VmBoundedUiMessage `
      -Handle $ListHandle `
      -Message ([uint32]$constants.WmKeyUp) `
      -WParam ([IntPtr]$constants.VirtualKeyDelete)
  }
  $after = Read-MT5VmWebRequestStateBoundary -OptionsHandle $OptionsHandle
  if (@($after.Items).Count -ne 1 -or
      -not [string]::IsNullOrEmpty([string]@($after.Items)[0])) {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_LIST_WRITE_FAILED'
  }
  return $true
}

function Write-MT5VmWebRequestStateBoundary {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][IntPtr]$OptionsHandle,
    [Parameter(Mandatory = $true)][object]$State
  )

  $target = ConvertTo-MT5VmWebRequestState -State $State
  $targetNonEmpty = @($target.Items | Where-Object {
      -not [string]::IsNullOrEmpty([string]$_)
    })
  if ($target.Enabled -eq 1 -and $target.Items.Count -eq 1 -and
      $targetNonEmpty.Count -eq 1) {
    Invoke-MT5VmWebRequestEditorApplyBoundary `
      -OptionsHandle $OptionsHandle `
      -ExpectedOrigin ([string]$targetNonEmpty[0])
    return
  }
  $constants = Get-MT5VmTerminalUiConstants
  $controls = Get-MT5VmWebRequestControlMapBoundary -OptionsHandle $OptionsHandle
  $currentResult = Invoke-MT5VmBoundedUiMessage `
    -Handle ([IntPtr]$controls.Checkbox) `
    -Message ([uint32]$constants.BmGetCheck)
  $current = [int]$currentResult.ToInt64()
  if ($current -notin 0, 1) {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_STATE_INVALID'
  }
  if ($current -eq 0) {
    $null = Invoke-MT5VmBoundedUiMessage `
      -Handle ([IntPtr]$controls.Checkbox) `
      -Message ([uint32]$constants.BmClick)
    $checked = Invoke-MT5VmBoundedUiMessage `
      -Handle ([IntPtr]$controls.Checkbox) `
      -Message ([uint32]$constants.BmGetCheck)
    if ([int]$checked.ToInt64() -ne 1 -or
        -not [Mt5VmTerminalUiNative]::IsWindowEnabled([IntPtr]$controls.List)) {
      throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_CONTROL_INVALID'
    }
  }
  if ($targetNonEmpty.Count -eq 0) {
    $null = Remove-MT5VmWebRequestItemsBoundary `
      -OptionsHandle $OptionsHandle `
      -ListHandle ([IntPtr]$controls.List)
  } else {
    [Mt5VmTerminalUiNative]::ReplaceListViewItems(
      [IntPtr]$controls.List,
      [uint32]$constants.LvmDeleteAllItems,
      [uint32]$constants.LvmInsertItem,
      [string[]]@($targetNonEmpty),
      [int]$constants.WebRequestMaxItems,
      [int]$constants.WebRequestMaxCharacters,
      [uint32]$constants.UiMessageTimeoutMs
    )
  }
  if ($target.Enabled -eq 0) {
    $null = Invoke-MT5VmBoundedUiMessage `
      -Handle ([IntPtr]$controls.Checkbox) `
      -Message ([uint32]$constants.BmClick)
  }
  $final = Invoke-MT5VmBoundedUiMessage `
    -Handle ([IntPtr]$controls.Checkbox) `
    -Message ([uint32]$constants.BmGetCheck)
  if ([int]$final.ToInt64() -ne $target.Enabled) {
    throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_STATE_INVALID'
  }
}

function Restore-MT5VmTerminalWebRequestState {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][int]$ProcessId,
    [Parameter(Mandatory = $true)][object]$State
  )

  $target = ConvertTo-MT5VmWebRequestState -State $State
  $activeDialog = [IntPtr]::Zero
  try {
    $activeDialog = Open-MT5VmOptionsDialogBoundary -ProcessId $ProcessId
    Write-MT5VmWebRequestStateBoundary -OptionsHandle $activeDialog -State $target
    Confirm-MT5VmOptionsDialogBoundary -OptionsHandle $activeDialog
    $activeDialog = [IntPtr]::Zero

    $activeDialog = Open-MT5VmOptionsDialogBoundary -ProcessId $ProcessId
    $persisted = Read-MT5VmWebRequestStateBoundary -OptionsHandle $activeDialog
    Cancel-MT5VmOptionsDialogBoundary -OptionsHandle $activeDialog
    $activeDialog = [IntPtr]::Zero
    if (-not (Test-MT5VmWebRequestStateExact -Left $persisted -Right $target)) {
      throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_ROLLBACK_FAILED'
    }
  } catch {
    if ($activeDialog -ne [IntPtr]::Zero) {
      try {
        Cancel-MT5VmOptionsDialogBoundary -OptionsHandle $activeDialog
      } catch {
        # The rollback failure remains authoritative.
      }
    }
    throw
  }
}

function Set-MT5VmTerminalWebRequestAllowlist {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][int]$ProcessId,
    [Parameter(Mandatory = $true)][string]$Origin
  )

  $desired = Assert-MT5VmDesiredWebRequestState `
    -State ([pscustomobject][ordered]@{ Enabled = 1; Items = @($Origin) }) `
    -ExpectedOrigin $Origin
  $prior = $null
  $activeDialog = [IntPtr]::Zero
  try {
    $activeDialog = Open-MT5VmOptionsDialogBoundary -ProcessId $ProcessId
    $prior = ConvertTo-MT5VmWebRequestState -State (
      Read-MT5VmWebRequestStateBoundary -OptionsHandle $activeDialog
    )
    if (Test-MT5VmDesiredWebRequestState -State $prior -ExpectedOrigin $Origin) {
      Cancel-MT5VmOptionsDialogBoundary -OptionsHandle $activeDialog
      $activeDialog = [IntPtr]::Zero
      return [pscustomobject][ordered]@{
        status = 'UNCHANGED'
        enabled = $true
        non_empty_count = 1
      }
    }

    if ($prior.Enabled -ne 0 -or $prior.Items.Count -ne 1 -or
        -not [string]::IsNullOrEmpty([string]$prior.Items[0])) {
      throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_STATE_INVALID'
    }

    Write-MT5VmWebRequestStateBoundary -OptionsHandle $activeDialog -State $desired
    Confirm-MT5VmOptionsDialogBoundary -OptionsHandle $activeDialog
    $activeDialog = [IntPtr]::Zero

    $activeDialog = Open-MT5VmOptionsDialogBoundary -ProcessId $ProcessId
    $persisted = Read-MT5VmWebRequestStateBoundary -OptionsHandle $activeDialog
    Cancel-MT5VmOptionsDialogBoundary -OptionsHandle $activeDialog
    $activeDialog = [IntPtr]::Zero
    if (-not (Test-MT5VmDesiredWebRequestState -State $persisted -ExpectedOrigin $Origin)) {
      throw 'PROVISIONING_WEBREQUEST_ALLOWLIST_PERSIST_FAILED'
    }
    return [pscustomobject][ordered]@{
      status = 'APPLIED'
      enabled = $true
      non_empty_count = 1
    }
  } catch {
    $originalError = $_.Exception
    if ($activeDialog -ne [IntPtr]::Zero) {
      try {
        Cancel-MT5VmOptionsDialogBoundary -OptionsHandle $activeDialog
      } catch {
        # Continue to the exact snapshot rollback when one exists.
      }
    }
    if ($null -ne $prior) {
      try {
        Restore-MT5VmTerminalWebRequestState -ProcessId $ProcessId -State $prior
      } catch {
        throw [InvalidOperationException]::new(
          'PROVISIONING_WEBREQUEST_ALLOWLIST_ROLLBACK_FAILED',
          $originalError
        )
      }
    }
    throw $originalError
  }
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
  if (-not $process.WaitForExit($constants.OwnedTerminalCloseTimeoutMs)) {
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
