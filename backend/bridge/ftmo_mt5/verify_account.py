"""Verify one MT5 account without exposing credentials in process arguments.

The Go API starts this script as a short-lived process and writes a single JSON
request to stdin. This script writes exactly one sanitized JSON result to stdout
and never includes the supplied password or native MT5 diagnostic text.
"""

from __future__ import annotations

import json
import os
import sys
from typing import Any, TextIO


DEFAULT_NATIVE_TIMEOUT_MS = 8_000
MIN_NATIVE_TIMEOUT_MS = 1_000
MAX_NATIVE_TIMEOUT_MS = 12_000
DEFAULT_MUTEX_NAME = r"Global\SMCTradingTerminal.MT5Verifier.v1"
DEFAULT_MUTEX_TIMEOUT_MS = 15_000
MIN_MUTEX_TIMEOUT_MS = 100
MAX_MUTEX_TIMEOUT_MS = 17_000
AUTH_FAILED_ERROR_CODE = -6

WAIT_OBJECT_0 = 0x00000000
WAIT_ABANDONED = 0x00000080
WAIT_TIMEOUT = 0x00000102


MESSAGES = {
    "verified": "MT5 account verified.",
    "missing_credentials": "MT5 login, server, and password are required.",
    "invalid_request": "The MT5 verification request is invalid.",
    "invalid_login": "The MT5 login must be a positive number.",
    "dependency_unavailable": "MT5 verification is temporarily unavailable.",
    "initialize_failed": "MetaTrader 5 could not be initialized.",
    "login_failed": "MT5 rejected the login, server, or password.",
    "account_unavailable": "MT5 did not return account information.",
    "account_mismatch": "MT5 connected to a different login or server.",
    "unsupported_broker": "This MT5 connection is not an FTMO account.",
    "trading_not_allowed": "The MT5 account is not allowed to trade.",
    "internal_error": "MT5 verification failed unexpectedly.",
}


def _result(code: str, account: dict[str, Any] | None = None) -> dict[str, Any]:
    result: dict[str, Any] = {
        "verified": code == "verified",
        "code": code,
        "message": MESSAGES[code],
    }
    if code == "verified" and account is not None:
        result["account"] = account
    return result


def _safe_text(value: Any, limit: int) -> str:
    text = str(value or "").strip()
    text = "".join(character for character in text if character.isprintable())
    return text[:limit]


def _native_timeout_ms() -> int:
    """Keep the native MT5 call inside the API's outer 30 second budget."""
    try:
        value = int(os.getenv("MT5_VERIFY_NATIVE_TIMEOUT_MS", ""))
    except (TypeError, ValueError):
        return DEFAULT_NATIVE_TIMEOUT_MS
    return max(MIN_NATIVE_TIMEOUT_MS, min(value, MAX_NATIVE_TIMEOUT_MS))


def _mutex_timeout_ms() -> int:
    """Bound lock contention so the API's outer request deadline still wins."""
    try:
        value = int(os.getenv("MT5_VERIFY_MUTEX_TIMEOUT_MS", ""))
    except (TypeError, ValueError):
        return DEFAULT_MUTEX_TIMEOUT_MS
    return max(MIN_MUTEX_TIMEOUT_MS, min(value, MAX_MUTEX_TIMEOUT_MS))


def _mutex_name() -> str:
    configured = os.getenv("MT5_VERIFY_MUTEX_NAME", "").strip()
    return configured[:260] if configured else DEFAULT_MUTEX_NAME


def _platform_is_windows() -> bool:
    return os.name == "nt"


class _NoopMutex:
    """Context-manager fallback for development and tests off Windows."""

    def __enter__(self) -> "_NoopMutex":
        return self

    def __exit__(self, _exc_type: Any, _exc: Any, _traceback: Any) -> bool:
        return False


class _WindowsNamedMutex:
    """Small Win32 named-mutex wrapper with deterministic handle cleanup."""

    def __init__(self, name: str, timeout_ms: int) -> None:
        self.name = name
        self.timeout_ms = timeout_ms
        self._kernel32: Any | None = None
        self._handle: Any | None = None
        self._acquired = False

    def __enter__(self) -> "_WindowsNamedMutex":
        # Import lazily so the verifier remains importable on non-Windows CI.
        import ctypes
        from ctypes import wintypes

        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.CreateMutexW.argtypes = (
            wintypes.LPVOID,
            wintypes.BOOL,
            wintypes.LPCWSTR,
        )
        kernel32.CreateMutexW.restype = wintypes.HANDLE
        kernel32.WaitForSingleObject.argtypes = (wintypes.HANDLE, wintypes.DWORD)
        kernel32.WaitForSingleObject.restype = wintypes.DWORD
        kernel32.ReleaseMutex.argtypes = (wintypes.HANDLE,)
        kernel32.ReleaseMutex.restype = wintypes.BOOL
        kernel32.CloseHandle.argtypes = (wintypes.HANDLE,)
        kernel32.CloseHandle.restype = wintypes.BOOL

        self._kernel32 = kernel32
        self._handle = kernel32.CreateMutexW(None, False, self.name)
        if not self._handle:
            self._kernel32 = None
            raise OSError("Could not create the MT5 verifier mutex.")

        try:
            wait_result = int(
                kernel32.WaitForSingleObject(self._handle, self.timeout_ms)
            )
        except Exception:
            self._close_handle()
            raise
        if wait_result in (WAIT_OBJECT_0, WAIT_ABANDONED):
            # WAIT_ABANDONED grants ownership too; releasing it is mandatory.
            self._acquired = True
            return self

        self._close_handle()
        if wait_result == WAIT_TIMEOUT:
            raise TimeoutError("Timed out waiting for the MT5 verifier mutex.")
        raise OSError("Could not acquire the MT5 verifier mutex.")

    def __exit__(self, _exc_type: Any, _exc: Any, _traceback: Any) -> bool:
        release_failed = False
        try:
            if self._acquired and self._kernel32 is not None and self._handle:
                release_failed = not bool(self._kernel32.ReleaseMutex(self._handle))
        finally:
            self._acquired = False
            self._close_handle()
        if release_failed:
            raise OSError("Could not release the MT5 verifier mutex.")
        return False

    def _close_handle(self) -> None:
        if self._kernel32 is not None and self._handle:
            self._kernel32.CloseHandle(self._handle)
        self._handle = None
        self._kernel32 = None


def _verification_mutex(
    name: str | None = None, timeout_ms: int | None = None
) -> _NoopMutex | _WindowsNamedMutex:
    if not _platform_is_windows():
        return _NoopMutex()
    return _WindowsNamedMutex(
        name if name is not None else _mutex_name(),
        timeout_ms if timeout_ms is not None else _mutex_timeout_ms(),
    )


def _portable_mode() -> bool:
    """Portable mode is enabled only for the runner-managed terminal clone."""
    return os.getenv("MT5_VERIFY_PORTABLE", "").strip().casefold() in {
        "1",
        "true",
        "yes",
        "on",
    }


def _initialize_failure_code(mt5: Any) -> str:
    """Distinguish rejected credentials without returning native diagnostics."""
    try:
        last_error = mt5.last_error()
        if (
            isinstance(last_error, (list, tuple))
            and last_error
            and int(last_error[0]) == AUTH_FAILED_ERROR_CODE
        ):
            return "login_failed"
    except Exception:
        pass
    return "initialize_failed"


def verify_account(
    request: Any, mt5_module: Any | None = None
) -> dict[str, Any]:
    if not isinstance(request, dict):
        return _result("invalid_request")

    login_text = _safe_text(request.get("login"), 32)
    server = _safe_text(request.get("server"), 128)
    password = request.get("password")
    if not login_text or not server or not isinstance(password, str) or not password.strip():
        return _result("missing_credentials")
    try:
        login = int(login_text)
    except (TypeError, ValueError):
        return _result("invalid_login")
    if login <= 0 or str(login) != login_text:
        return _result("invalid_login")

    mt5 = mt5_module
    if mt5 is None:
        try:
            import MetaTrader5 as mt5  # type: ignore[import-not-found,no-redef]
        except ImportError:
            return _result("dependency_unavailable")

    try:
        # The production runner takes the same mutex before stopping or
        # replacing the managed terminal. Keep initialize, account_info, native
        # error inspection, and shutdown inside one ownership window.
        with _verification_mutex():
            try:
                terminal_path = os.getenv("MT5_VERIFY_TERMINAL_PATH", "").strip()
                native_timeout_ms = _native_timeout_ms()
                initialize_args = {
                    "login": login,
                    "password": password,
                    "server": server,
                    "timeout": native_timeout_ms,
                }
                if terminal_path and _portable_mode():
                    initialize_args["portable"] = True
                try:
                    # MetaTrader documents the executable path as a
                    # positional-only argument. Credentials here perform one
                    # bounded connection instead of a second login call.
                    initialized = (
                        mt5.initialize(terminal_path, **initialize_args)
                        if terminal_path
                        else mt5.initialize(**initialize_args)
                    )
                except Exception:
                    initialized = False
                if not initialized:
                    return _result(_initialize_failure_code(mt5))

                account = mt5.account_info()
                if account is None:
                    return _result("account_unavailable")

                actual_login = _safe_text(getattr(account, "login", ""), 32)
                actual_server = _safe_text(getattr(account, "server", ""), 128)
                if (
                    actual_login != login_text
                    or actual_server.casefold() != server.casefold()
                ):
                    return _result("account_mismatch")
                company = _safe_text(getattr(account, "company", ""), 128)
                if (
                    "ftmo" not in actual_server.casefold()
                    and "ftmo" not in company.casefold()
                ):
                    return _result("unsupported_broker")
                trade_allowed = bool(getattr(account, "trade_allowed", False))
                if not trade_allowed:
                    return _result("trading_not_allowed")

                return _result(
                    "verified",
                    {
                        "login": actual_login,
                        "server": actual_server,
                        "currency": _safe_text(
                            getattr(account, "currency", ""), 16
                        ),
                        "tradeAllowed": True,
                    },
                )
            except Exception:
                # Native extension errors must never cross the process boundary.
                return _result("internal_error")
            finally:
                try:
                    mt5.shutdown()
                except Exception:
                    pass
    except Exception:
        # Mutex creation/acquisition/release errors are operational details.
        return _result("internal_error")


def run(stdin: TextIO, stdout: TextIO) -> int:
    try:
        raw = stdin.read(65_537)
        if len(raw) > 65_536:
            result = _result("invalid_request")
        else:
            result = verify_account(json.loads(raw))
    except (json.JSONDecodeError, UnicodeError):
        result = _result("invalid_request")
    except Exception:
        result = _result("internal_error")
    json.dump(result, stdout, ensure_ascii=True, separators=(",", ":"))
    stdout.write("\n")
    stdout.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(run(sys.stdin, sys.stdout))
