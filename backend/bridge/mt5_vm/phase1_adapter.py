#!/usr/bin/env python3
"""Single-account, authenticated-stdio MT5 adapter for the Phase 1 VM worker."""

from __future__ import annotations

import hashlib
import hmac
import json
import math
import re
import struct
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

try:
    from . import phase4_snapshots
except ImportError:  # Direct script execution on the managed Windows host.
    import phase4_snapshots  # type: ignore[no-redef]


PROTOCOL_VERSION = 1
KEY_BYTES = 32
MAX_FRAME_BYTES = 64 * 1024
MAX_FRAME_TTL_MS = 60_000
MAX_FUTURE_SKEW_MS = 30_000
ALIAS_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
BOOTSTRAP_KEYS = {
    "protocol_version",
    "worker_id",
    "account_id",
    "lease_generation",
    "ipc_key_hex",
    "terminal_path",
    "login",
    "password",
    "server",
    "symbol",
    "timeout_ms",
}
FRAME_KEYS = {
    "protocol_version",
    "worker_id",
    "account_id",
    "lease_generation",
    "message_id",
    "sent_at_ms",
    "expires_at_ms",
    "sequence",
    "kind",
    "payload_json",
    "mac_hex",
}
ALLOWED_COMMANDS = {"agent_heartbeat", "stop_account", "snapshot_sync", "history_sync"}
MAX_SYNC_SYMBOLS = 256


class AdapterInputError(ValueError):
    """Raised when private IPC input fails closed."""


def _now_ms() -> int:
    return time.time_ns() // 1_000_000


def _validate_identifier(value: Any, field: str) -> str:
    text = str(value)
    if not ALIAS_RE.fullmatch(text):
        raise AdapterInputError(f"invalid {field}")
    return text


def validate_bootstrap(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict) or set(raw) != BOOTSTRAP_KEYS:
        raise AdapterInputError("invalid bootstrap shape")
    if raw.get("protocol_version") != PROTOCOL_VERSION:
        raise AdapterInputError("unsupported protocol")

    worker_id = _validate_identifier(raw.get("worker_id"), "worker_id")
    account_id = _validate_identifier(raw.get("account_id"), "account_id")
    lease_generation = int(raw.get("lease_generation", 0))
    if lease_generation < 1:
        raise AdapterInputError("invalid lease generation")

    key_hex = str(raw.get("ipc_key_hex", ""))
    if len(key_hex) != KEY_BYTES * 2:
        raise AdapterInputError("invalid IPC key")
    try:
        ipc_key = bytearray.fromhex(key_hex)
    except ValueError as exc:
        raise AdapterInputError("invalid IPC key") from exc
    if len(ipc_key) != KEY_BYTES:
        raise AdapterInputError("invalid IPC key")

    terminal_path = str(raw.get("terminal_path", ""))
    if not Path(terminal_path).is_absolute() or Path(terminal_path).name.lower() != "terminal64.exe":
        raise AdapterInputError("invalid terminal path")
    login = str(raw.get("login", ""))
    password = raw.get("password")
    server = str(raw.get("server", "")).strip()
    if not login.isdigit() or int(login) < 1:
        raise AdapterInputError("invalid login")
    if not isinstance(password, str) or not password:
        raise AdapterInputError("password is required")
    if (
        not server
        or len(server) > 128
        or any(ord(character) < 32 or ord(character) == 127 for character in server)
    ):
        raise AdapterInputError("invalid server")
    symbol = str(raw.get("symbol", "")).strip()
    if len(symbol) > 64:
        raise AdapterInputError("invalid symbol")
    timeout_ms = int(raw.get("timeout_ms", 12_000))
    if timeout_ms < 1_000 or timeout_ms > 30_000:
        raise AdapterInputError("invalid timeout")

    return {
        "worker_id": worker_id,
        "account_id": account_id,
        "lease_generation": lease_generation,
        "ipc_key": ipc_key,
        "terminal_path": terminal_path,
        "login": int(login),
        "password": password,
        "server": server,
        "symbol": symbol,
        "timeout_ms": timeout_ms,
    }


def _length_prefixed(fields: list[str]) -> bytes:
    output = bytearray()
    for field in fields:
        encoded = field.encode("utf-8")
        if len(encoded) > MAX_FRAME_BYTES:
            raise AdapterInputError("frame field is too large")
        output.extend(struct.pack(">I", len(encoded)))
        output.extend(encoded)
    if len(output) > MAX_FRAME_BYTES:
        raise AdapterInputError("frame is too large")
    return bytes(output)


def _signing_bytes(frame: dict[str, Any]) -> bytes:
    return _length_prefixed(
        [
            str(frame["protocol_version"]),
            str(frame["worker_id"]),
            str(frame["account_id"]),
            str(frame["lease_generation"]),
            str(frame["message_id"]),
            str(frame["sent_at_ms"]),
            str(frame["expires_at_ms"]),
            str(frame["sequence"]),
            str(frame["kind"]),
            str(frame["payload_json"]),
        ]
    )


def sign_frame(
    cfg: dict[str, Any],
    *,
    sequence: int,
    kind: str,
    payload: Any,
    now_ms: int | None = None,
    ttl_ms: int = 30_000,
) -> dict[str, Any]:
    if sequence < 1 or ttl_ms < 1 or ttl_ms > MAX_FRAME_TTL_MS:
        raise AdapterInputError("invalid frame sequence or TTL")
    sent_at_ms = _now_ms() if now_ms is None else now_ms
    payload_json = json.dumps(
        _json_safe(payload), separators=(",", ":"), sort_keys=True, allow_nan=False
    )
    frame = {
        "protocol_version": PROTOCOL_VERSION,
        "worker_id": cfg["worker_id"],
        "account_id": cfg["account_id"],
        "lease_generation": cfg["lease_generation"],
        "message_id": str(uuid.uuid4()),
        "sent_at_ms": sent_at_ms,
        "expires_at_ms": sent_at_ms + ttl_ms,
        "sequence": sequence,
        "kind": kind,
        "payload_json": payload_json,
        "mac_hex": "",
    }
    frame["mac_hex"] = hmac.new(
        bytes(cfg["ipc_key"]), _signing_bytes(frame), hashlib.sha256
    ).hexdigest()
    return frame


def verify_command_frame(
    cfg: dict[str, Any], raw_line: str, *, last_sequence: int, now_ms: int | None = None
) -> tuple[dict[str, Any], int]:
    if len(raw_line.encode("utf-8")) > MAX_FRAME_BYTES:
        raise AdapterInputError("frame is too large")
    try:
        frame = json.loads(raw_line)
    except json.JSONDecodeError as exc:
        raise AdapterInputError("malformed frame") from exc
    if not isinstance(frame, dict) or set(frame) != FRAME_KEYS:
        raise AdapterInputError("invalid frame shape")
    if frame.get("protocol_version") != PROTOCOL_VERSION:
        raise AdapterInputError("unsupported protocol")
    if frame.get("worker_id") != cfg["worker_id"] or frame.get("account_id") != cfg["account_id"]:
        raise AdapterInputError("frame identity mismatch")
    if int(frame.get("lease_generation", 0)) != cfg["lease_generation"]:
        raise AdapterInputError("frame lease mismatch")
    sequence = int(frame.get("sequence", 0))
    if sequence <= last_sequence:
        raise AdapterInputError("frame replay detected")
    current_ms = _now_ms() if now_ms is None else now_ms
    sent_at_ms = int(frame.get("sent_at_ms", 0))
    expires_at_ms = int(frame.get("expires_at_ms", 0))
    if (
        expires_at_ms < current_ms
        or sent_at_ms > current_ms + MAX_FUTURE_SKEW_MS
        or expires_at_ms < sent_at_ms
        or expires_at_ms - sent_at_ms > MAX_FRAME_TTL_MS
    ):
        raise AdapterInputError("invalid frame timestamp")
    if frame.get("kind") not in ALLOWED_COMMANDS:
        raise AdapterInputError("unsupported adapter command")
    supplied_mac = str(frame.get("mac_hex", ""))
    expected_mac = hmac.new(
        bytes(cfg["ipc_key"]), _signing_bytes(frame), hashlib.sha256
    ).hexdigest()
    if not hmac.compare_digest(supplied_mac, expected_mac):
        raise AdapterInputError("frame authentication failed")
    try:
        payload = json.loads(str(frame["payload_json"]))
    except json.JSONDecodeError as exc:
        raise AdapterInputError("malformed frame payload") from exc
    return {"kind": frame["kind"], "payload": payload}, sequence


def _mode_name(mt5: Any, trade_mode: Any) -> str:
    mapping = {
        getattr(mt5, "ACCOUNT_TRADE_MODE_DEMO", 0): "demo",
        getattr(mt5, "ACCOUNT_TRADE_MODE_CONTEST", 1): "contest",
        getattr(mt5, "ACCOUNT_TRADE_MODE_REAL", 2): "live",
    }
    return mapping.get(trade_mode, "unknown")


def _last_error_code(mt5: Any) -> int | None:
    try:
        error = mt5.last_error()
        return int(error[0]) if error else None
    except Exception:
        return None


def _count(value: Any) -> int | None:
    return None if value is None else len(value)


def _select_symbol(mt5: Any, requested: str) -> str:
    if requested:
        return requested
    symbols = mt5.symbols_get()
    if symbols is None:
        raise RuntimeError("MT5_SYMBOLS_UNAVAILABLE")
    for candidate in symbols[:200]:
        name = str(getattr(candidate, "name", ""))
        if name and bool(getattr(candidate, "visible", False)) and mt5.symbol_info_tick(name) is not None:
            return name
    raise RuntimeError("MT5_SYMBOL_UNAVAILABLE")


def _symbol_snapshot(mt5: Any, symbol: str) -> dict[str, Any]:
    info = mt5.symbol_info(symbol)
    tick = mt5.symbol_info_tick(symbol)
    if info is None:
        raise RuntimeError("MT5_SYMBOL_INFO_UNAVAILABLE")
    return {
        "symbol": symbol,
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


def initialize_and_snapshot(mt5: Any, cfg: dict[str, Any]) -> dict[str, Any]:
    initialized = bool(
        mt5.initialize(
            cfg["terminal_path"],
            login=cfg["login"],
            password=cfg["password"],
            server=cfg["server"],
            timeout=cfg["timeout_ms"],
            portable=False,
        )
    )
    if not initialized:
        raise RuntimeError(mt5_initialize_error_class(mt5))
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

    positions = mt5.positions_get()
    orders = mt5.orders_get()
    history_from = datetime.now(timezone.utc) - timedelta(days=7)
    history_to = datetime.now(timezone.utc)
    history_orders = mt5.history_orders_get(history_from, history_to)
    history_deals = mt5.history_deals_get(history_from, history_to)
    selected_symbol = _select_symbol(mt5, cfg["symbol"])

    return _json_safe(
        {
            "mode": _mode_name(mt5, getattr(account, "trade_mode", None)),
            "login_matches": int(getattr(account, "login", 0)) == cfg["login"],
            "server_matches": str(getattr(account, "server", "")).strip().casefold()
            == cfg["server"].casefold(),
            "connected": bool(getattr(terminal, "connected", False)),
            "trade_allowed": bool(getattr(account, "trade_allowed", False)),
            "trade_expert": bool(getattr(account, "trade_expert", False)),
            "margin_mode": getattr(account, "margin_mode", None),
            "currency": getattr(account, "currency", None),
            "leverage": getattr(account, "leverage", None),
            "positions_count": _count(positions),
            "pending_orders_count": _count(orders),
            "history_orders_count_7d": _count(history_orders),
            "history_deals_count_7d": _count(history_deals),
            "symbol_specification": _symbol_snapshot(mt5, selected_symbol),
            "last_error_code": _last_error_code(mt5),
        }
    )


def mt5_initialize_error_class(mt5: Any) -> str:
    """Map MetaTrader Python IPC diagnostics to a bounded, non-sensitive class."""
    try:
        raw_error = mt5.last_error()
    except Exception:
        return "MT5_INITIALIZE_FAILED"
    if not isinstance(raw_error, (tuple, list)) or not raw_error:
        return "MT5_INITIALIZE_FAILED"
    try:
        code = int(raw_error[0])
    except (TypeError, ValueError):
        return "MT5_INITIALIZE_FAILED"
    detail = str(raw_error[1] if len(raw_error) > 1 else "").casefold()
    if code == -10003:
        if "process create failed" in detail:
            return "MT5_PROCESS_CREATE_FAILED"
        if "pipe server didn't answer" in detail:
            return "MT5_PIPE_SERVER_TIMEOUT"
        if "not found" in detail:
            return "MT5_TERMINAL_NOT_FOUND"
        return "MT5_IPC_INITIALIZE_FAILED"
    if code == -10005:
        return "MT5_IPC_TIMEOUT"
    if code == -10002:
        return "MT5_IPC_RECEIVE_FAILED"
    if code == -10001:
        return "MT5_IPC_SEND_FAILED"
    if code == -10000:
        return "MT5_IPC_FAILED"
    if code == -5:
        return "MT5_VERSION_UNSUPPORTED"
    return "MT5_INITIALIZE_FAILED"


def heartbeat_snapshot(mt5: Any, cfg: dict[str, Any]) -> dict[str, Any]:
    account = mt5.account_info()
    terminal = mt5.terminal_info()
    return {
        "healthy": account is not None and terminal is not None and bool(getattr(terminal, "connected", False)),
        "login_matches": account is not None and int(getattr(account, "login", 0)) == cfg["login"],
        "server_matches": account is not None
        and str(getattr(account, "server", "")).strip().casefold() == cfg["server"].casefold(),
        "last_error_code": _last_error_code(mt5),
    }


def _collect_snapshot_sync(mt5: Any, payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict) or set(payload) != {"symbols"}:
        raise AdapterInputError("invalid snapshot sync payload")
    raw_symbols = payload["symbols"]
    if not isinstance(raw_symbols, list) or len(raw_symbols) > MAX_SYNC_SYMBOLS:
        raise AdapterInputError("invalid snapshot sync symbols")
    symbols: list[str] = []
    seen: set[str] = set()
    for value in raw_symbols:
        if not isinstance(value, str):
            raise AdapterInputError("invalid snapshot sync symbol")
        symbol = value.strip()
        if not symbol or len(symbol) > 64 or any(ord(char) < 32 or ord(char) == 127 for char in symbol):
            raise AdapterInputError("invalid snapshot sync symbol")
        key = symbol.casefold()
        if key in seen:
            raise AdapterInputError("duplicate snapshot sync symbol")
        seen.add(key)
        symbols.append(symbol)
    return phase4_snapshots.collect_snapshots(mt5, symbols=symbols)


def _collect_history_sync(mt5: Any, payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict) or set(payload) != {"from_ms", "to_ms"}:
        raise AdapterInputError("invalid history sync payload")
    from_ms = payload["from_ms"]
    to_ms = payload["to_ms"]
    if (
        isinstance(from_ms, bool)
        or isinstance(to_ms, bool)
        or not isinstance(from_ms, int)
        or not isinstance(to_ms, int)
    ):
        raise AdapterInputError("invalid history sync window")
    return phase4_snapshots.collect_history_page(mt5, from_ms=from_ms, to_ms=to_ms)


def _json_safe(value: Any) -> Any:
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    return value


def _write_frame(frame: dict[str, Any]) -> None:
    output = json.dumps(frame, separators=(",", ":"), allow_nan=False)
    if len(output.encode("utf-8")) > MAX_FRAME_BYTES:
        raise RuntimeError("FRAME_TOO_LARGE")
    sys.stdout.write(output + "\n")
    sys.stdout.flush()


def run(mt5: Any, cfg: dict[str, Any]) -> int:
    output_sequence = 1
    input_sequence = 0
    initialized = False
    try:
        snapshot = initialize_and_snapshot(mt5, cfg)
        initialized = True
        _write_frame(
            sign_frame(
                cfg,
                sequence=output_sequence,
                kind="account_snapshot",
                payload=snapshot,
            )
        )
        output_sequence += 1
        cfg["password"] = None

        for raw_line in sys.stdin:
            command, input_sequence = verify_command_frame(
                cfg, raw_line.rstrip("\r\n"), last_sequence=input_sequence
            )
            if command["kind"] == "agent_heartbeat":
                _write_frame(
                    sign_frame(
                        cfg,
                        sequence=output_sequence,
                        kind="agent_heartbeat",
                        payload=heartbeat_snapshot(mt5, cfg),
                    )
                )
                output_sequence += 1
                continue
            if command["kind"] == "snapshot_sync":
                _write_frame(
                    sign_frame(
                        cfg,
                        sequence=output_sequence,
                        kind="snapshot_sync",
                        payload=_collect_snapshot_sync(mt5, command["payload"]),
                    )
                )
                output_sequence += 1
                continue
            if command["kind"] == "history_sync":
                _write_frame(
                    sign_frame(
                        cfg,
                        sequence=output_sequence,
                        kind="history_sync",
                        payload=_collect_history_sync(mt5, command["payload"]),
                    )
                )
                output_sequence += 1
                continue
            if command["kind"] == "stop_account":
                mt5.shutdown()
                initialized = False
                _write_frame(
                    sign_frame(
                        cfg,
                        sequence=output_sequence,
                        kind="account_runtime_status",
                        payload={"state": "stopped"},
                    )
                )
                return 0
        return 0
    except Exception as exc:
        error_class = str(exc) if str(exc).startswith(("MT5_", "FRAME_")) else type(exc).__name__
        _write_frame(
            sign_frame(
                cfg,
                sequence=output_sequence,
                kind="account_runtime_status",
                payload={
                    "state": "degraded",
                    "error_class": error_class,
                    "last_error_code": _last_error_code(mt5),
                },
            )
        )
        return 2
    finally:
        cfg["password"] = None
        cfg["login"] = 0
        cfg["server"] = ""
        for index in range(len(cfg["ipc_key"])):
            cfg["ipc_key"][index] = 0
        if initialized:
            mt5.shutdown()


def main() -> int:
    cfg: dict[str, Any] | None = None
    raw: dict[str, Any] | None = None
    try:
        raw_line = sys.stdin.readline(MAX_FRAME_BYTES + 1)
        if not raw_line or len(raw_line.encode("utf-8")) > MAX_FRAME_BYTES:
            raise AdapterInputError("missing or oversized bootstrap")
        raw = json.loads(raw_line)
        cfg = validate_bootstrap(raw)
    except Exception:
        sys.stderr.write("PHASE1_ADAPTER_BOOTSTRAP_BLOCKED\n")
        return 2
    finally:
        if raw is not None:
            raw["password"] = None
            raw["login"] = None
            raw["server"] = None
            raw["ipc_key_hex"] = None

    try:
        import MetaTrader5 as mt5  # type: ignore
    except Exception:
        sys.stderr.write("PHASE1_ADAPTER_DEPENDENCY_BLOCKED\n")
        return 2
    return run(mt5, cfg)


if __name__ == "__main__":
    raise SystemExit(main())
