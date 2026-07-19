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


MESSAGES = {
    "verified": "MT5 account verified.",
    "missing_credentials": "MT5 login, server, and password are required.",
    "invalid_request": "The MT5 verification request is invalid.",
    "invalid_login": "The MT5 login must be a positive number.",
    "dependency_unavailable": "MetaTrader 5 verification is unavailable on this server.",
    "initialize_failed": "MetaTrader 5 could not be initialized.",
    "login_failed": "MT5 rejected the login, server, or password.",
    "account_unavailable": "MT5 did not return account information.",
    "account_mismatch": "MT5 connected to a different login or server.",
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
        terminal_path = os.getenv("MT5_VERIFY_TERMINAL_PATH", "").strip()
        initialize_args = {"path": terminal_path} if terminal_path else {}
        if not mt5.initialize(**initialize_args):
            return _result("initialize_failed")
        if not mt5.login(login, password=password, server=server):
            return _result("login_failed")

        account = mt5.account_info()
        if account is None:
            return _result("account_unavailable")

        actual_login = _safe_text(getattr(account, "login", ""), 32)
        actual_server = _safe_text(getattr(account, "server", ""), 128)
        if actual_login != login_text or actual_server.casefold() != server.casefold():
            return _result("account_mismatch")
        trade_allowed = bool(getattr(account, "trade_allowed", False))
        if not trade_allowed:
            return _result("trading_not_allowed")

        return _result(
            "verified",
            {
                "login": actual_login,
                "server": actual_server,
                "currency": _safe_text(getattr(account, "currency", ""), 16),
                "tradeAllowed": True,
            },
        )
    except Exception:  # Native extension errors must never cross the process boundary.
        return _result("internal_error")
    finally:
        try:
            mt5.shutdown()
        except Exception:
            pass


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
