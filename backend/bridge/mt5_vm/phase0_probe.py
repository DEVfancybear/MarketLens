#!/usr/bin/env python3
"""Credential-safe, read-only MT5 Windows VM Phase 0 probe."""

from __future__ import annotations

import json
import platform
import re
import struct
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


ALIAS_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
ALLOWED_KEYS = {
    "schema_version",
    "account_alias",
    "terminal_path",
    "login",
    "password",
    "server",
    "symbol",
    "timeout_ms",
}


class ProbeInputError(ValueError):
    """Raised when input is incomplete or unsafe."""


def _test(test_id: str, passed: bool, observation: str | None = None) -> dict[str, Any]:
    result: dict[str, Any] = {"id": test_id, "status": "PASS" if passed else "FAIL"}
    if observation:
        result["observation"] = observation
    return result


def _validate_request(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise ProbeInputError("request must be an object")
    if set(raw) - ALLOWED_KEYS:
        raise ProbeInputError("request contains unsupported fields")
    if raw.get("schema_version") != 1:
        raise ProbeInputError("unsupported request schema")

    alias = str(raw.get("account_alias", ""))
    terminal_path = str(raw.get("terminal_path", ""))
    login = str(raw.get("login", ""))
    password = raw.get("password")
    server = str(raw.get("server", "")).strip()
    symbol = str(raw.get("symbol", ""))

    if not ALIAS_RE.fullmatch(alias):
        raise ProbeInputError("invalid account alias")
    if not terminal_path or not Path(terminal_path).is_absolute():
        raise ProbeInputError("terminal path must be absolute")
    if Path(terminal_path).name.lower() != "terminal64.exe":
        raise ProbeInputError("terminal path must identify terminal64.exe")
    if not login.isdigit() or int(login) < 1:
        raise ProbeInputError("login must be a positive integer")
    if not isinstance(password, str) or not password:
        raise ProbeInputError("password is required")
    if (
        not server
        or len(server) > 128
        or any(ord(character) < 32 or ord(character) == 127 for character in server)
    ):
        raise ProbeInputError("server is required")
    if len(symbol) > 64:
        raise ProbeInputError("symbol is too long")

    timeout_ms = int(raw.get("timeout_ms", 12000))
    if timeout_ms < 1000 or timeout_ms > 12000:
        raise ProbeInputError("timeout is outside the Phase 0 bounds")

    return {
        "account_alias": alias,
        "terminal_path": terminal_path,
        "login": int(login),
        "password": password,
        "server": server,
        "symbol": symbol.strip(),
        "timeout_ms": timeout_ms,
    }


def _mode_name(mt5: Any, trade_mode: Any) -> str:
    mapping = {
        getattr(mt5, "ACCOUNT_TRADE_MODE_DEMO", 0): "demo",
        getattr(mt5, "ACCOUNT_TRADE_MODE_CONTEST", 1): "contest",
        getattr(mt5, "ACCOUNT_TRADE_MODE_REAL", 2): "live",
    }
    return mapping.get(trade_mode, "unknown")


def _as_count(value: Any) -> int | None:
    return None if value is None else len(value)


def _last_error_code(mt5: Any) -> int | None:
    try:
        error = mt5.last_error()
        return int(error[0]) if error else None
    except Exception:
        return None


def _symbol_snapshot(mt5: Any, requested_symbol: str) -> dict[str, Any] | None:
    symbols = mt5.symbols_get()
    if symbols is None:
        return None

    selected_name = requested_symbol
    if not selected_name:
        for candidate in symbols[:200]:
            name = str(getattr(candidate, "name", ""))
            if not name or not bool(getattr(candidate, "visible", False)):
                continue
            if mt5.symbol_info_tick(name) is not None:
                selected_name = name
                break
    if not selected_name:
        return None

    info = mt5.symbol_info(selected_name)
    tick = mt5.symbol_info_tick(selected_name)
    if info is None:
        return None

    return {
        "symbol": selected_name,
        "tick_available": tick is not None,
        "digits": getattr(info, "digits", None),
        "point": getattr(info, "point", None),
        "trade_mode": getattr(info, "trade_mode", None),
        "order_mode": getattr(info, "order_mode", None),
        "filling_mode": getattr(info, "filling_mode", None),
        "volume_min": getattr(info, "volume_min", None),
        "volume_max": getattr(info, "volume_max", None),
        "volume_step": getattr(info, "volume_step", None),
        "trade_stops_level": getattr(info, "trade_stops_level", None),
        "trade_freeze_level": getattr(info, "trade_freeze_level", None),
        "trade_contract_size": getattr(info, "trade_contract_size", None),
        "currency_base": getattr(info, "currency_base", None),
        "currency_profit": getattr(info, "currency_profit", None),
        "currency_margin": getattr(info, "currency_margin", None),
    }


def run_probe(mt5: Any, request: dict[str, Any]) -> dict[str, Any]:
    cfg = _validate_request(request)
    return _run_validated_probe(mt5, cfg)


def _run_validated_probe(mt5: Any, cfg: dict[str, Any]) -> dict[str, Any]:
    initialized = False
    tests: list[dict[str, Any]] = []
    generated_at = datetime.now(timezone.utc).isoformat()

    try:
        initialized = bool(
            mt5.initialize(cfg["terminal_path"], timeout=cfg["timeout_ms"])
        )
        tests.append(_test("ACC-01", initialized))
        if not initialized:
            raise RuntimeError("MT5_INITIALIZE_FAILED")

        authenticated = bool(
            mt5.login(
                cfg["login"],
                password=cfg["password"],
                server=cfg["server"],
                timeout=cfg["timeout_ms"],
            )
        )
        if not authenticated:
            raise RuntimeError("MT5_LOGIN_FAILED")

        account = mt5.account_info()
        terminal = mt5.terminal_info()
        if account is None or terminal is None:
            raise RuntimeError("MT5_ACCOUNT_STATE_UNAVAILABLE")

        observed_login = int(getattr(account, "login", 0))
        observed_server = str(getattr(account, "server", "")).strip()
        login_matches = observed_login == cfg["login"]
        server_matches = observed_server.casefold() == cfg["server"].casefold()
        mode = _mode_name(mt5, getattr(account, "trade_mode", None))
        connected = bool(getattr(terminal, "connected", False))

        tests.extend(
            [
                _test("ACC-02", login_matches),
                _test("ACC-03", server_matches),
                _test("ACC-04", mode == "demo", mode),
                _test("READ-01", connected),
            ]
        )

        positions = mt5.positions_get()
        orders = mt5.orders_get()
        portfolio_ok = positions is not None and orders is not None
        tests.append(_test("READ-02", portfolio_ok))

        symbols_total = mt5.symbols_total()
        symbol = _symbol_snapshot(mt5, cfg["symbol"])
        symbol_ok = (
            isinstance(symbols_total, int)
            and symbols_total > 0
            and symbol is not None
            and symbol.get("tick_available") is True
            and symbol.get("volume_min") is not None
            and symbol.get("volume_step") is not None
        )
        tests.append(_test("READ-03", symbol_ok))

        history_from = datetime.now(timezone.utc) - timedelta(days=7)
        history_to = datetime.now(timezone.utc)
        history_orders = mt5.history_orders_get(history_from, history_to)
        history_deals = mt5.history_deals_get(history_from, history_to)
        history_ok = history_orders is not None and history_deals is not None
        tests.append(_test("READ-04", history_ok))

        all_passed = all(item["status"] == "PASS" for item in tests)
        return {
            "schema_version": 1,
            "phase": "mt5_windows_vm_phase0",
            "mode": "account",
            "generated_at": generated_at,
            "status": "PASS" if all_passed else "BLOCKED",
            "account_alias": cfg["account_alias"],
            "runtime": {
                "python": platform.python_version(),
                "bits": struct.calcsize("P") * 8,
                "metatrader5": getattr(mt5, "__version__", "unknown"),
                "initialized": initialized,
            },
            "account": {
                "mode": mode,
                "login_matches": login_matches,
                "server_matches": server_matches,
                "connected": connected,
                "trade_allowed": bool(getattr(account, "trade_allowed", False)),
                "trade_expert": bool(getattr(account, "trade_expert", False)),
                "margin_mode": getattr(account, "margin_mode", None),
                "currency": getattr(account, "currency", None),
                "leverage": getattr(account, "leverage", None),
            },
            "observations": {
                "symbols_total": symbols_total,
                "positions_count": _as_count(positions),
                "pending_orders_count": _as_count(orders),
                "history_orders_count_7d": _as_count(history_orders),
                "history_deals_count_7d": _as_count(history_deals),
                "symbol_specification": symbol,
            },
            "tests": tests,
            "error_class": None,
            "last_error_code": _last_error_code(mt5),
        }
    except Exception as exc:
        return {
            "schema_version": 1,
            "phase": "mt5_windows_vm_phase0",
            "mode": "account",
            "generated_at": generated_at,
            "status": "BLOCKED",
            "account_alias": cfg["account_alias"],
            "runtime": {
                "python": platform.python_version(),
                "bits": struct.calcsize("P") * 8,
                "metatrader5": getattr(mt5, "__version__", "unknown"),
                "initialized": initialized,
            },
            "tests": tests,
            "error_class": str(exc) if str(exc).startswith("MT5_") else type(exc).__name__,
            "last_error_code": _last_error_code(mt5),
        }
    finally:
        if initialized:
            mt5.shutdown()
        cfg["password"] = None


def main() -> int:
    try:
        raw_request = json.load(sys.stdin)
        request = _validate_request(raw_request)
    except Exception as exc:
        result = {
            "schema_version": 1,
            "phase": "mt5_windows_vm_phase0",
            "mode": "account",
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "status": "BLOCKED",
            "error_class": type(exc).__name__,
            "tests": [],
        }
        print(json.dumps(result, separators=(",", ":")))
        return 2

    try:
        import MetaTrader5 as mt5  # type: ignore
    except Exception as exc:
        result = {
            "schema_version": 1,
            "phase": "mt5_windows_vm_phase0",
            "mode": "account",
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "status": "BLOCKED",
            "account_alias": request["account_alias"],
            "error_class": type(exc).__name__,
            "tests": [],
        }
        print(json.dumps(result, separators=(",", ":")))
        return 2

    try:
        result = _run_validated_probe(mt5, request)
    finally:
        raw_request["password"] = None
        request["password"] = None
    print(json.dumps(result, separators=(",", ":"), allow_nan=False))
    return 0 if result["status"] == "PASS" else 2


if __name__ == "__main__":
    raise SystemExit(main())
