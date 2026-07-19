"""PyInstaller-friendly launcher for the MT5 Connector package."""

from __future__ import annotations

import ctypes
import os
from typing import Any

from bridge.ftmo_mt5.connector import main


_MUTEX_NAME = "Local\\TradingTerminal.MT5Connector.v1"
_ERROR_ALREADY_EXISTS = 183


def _message_box(message: str, *, error: bool = False) -> None:
    if os.name != "nt":
        return
    ctypes.windll.user32.MessageBoxW(
        None,
        message,
        "TradingTerminal MT5 Connector",
        0x10 if error else 0x40,
    )


def _acquire_single_instance() -> tuple[Any, int] | None:
    if os.name != "nt":
        return (None, 0)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.CreateMutexW.argtypes = [ctypes.c_void_p, ctypes.c_bool, ctypes.c_wchar_p]
    kernel32.CreateMutexW.restype = ctypes.c_void_p
    kernel32.CloseHandle.argtypes = [ctypes.c_void_p]
    handle = kernel32.CreateMutexW(None, False, _MUTEX_NAME)
    if not handle:
        raise ctypes.WinError(ctypes.get_last_error())
    if ctypes.get_last_error() == _ERROR_ALREADY_EXISTS:
        kernel32.CloseHandle(handle)
        _message_box(
            "The MT5 Connector is already running. Keep its existing window open."
        )
        return None
    return kernel32, int(handle)


if __name__ == "__main__":
    instance: tuple[Any, int] | None = None
    try:
        instance = _acquire_single_instance()
        if instance is None:
            raise SystemExit(0)
        main()
    except Exception as exc:
        _message_box(str(exc), error=True)
        raise SystemExit(1) from None
    finally:
        if instance is not None and instance[0] is not None:
            instance[0].CloseHandle(instance[1])
