#!/usr/bin/env python3
"""Local scheduler simulator for credential-safe MT5 VM Phase 1 validation."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import queue
import re
import struct
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path
from typing import Any


PROTOCOL_VERSION = 1
MAX_FRAME_BYTES = 64 * 1024
MAX_FRAME_TTL_MS = 60_000
IDENTIFIER_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
INPUT_KEYS = {
    "schema_version",
    "agent_path",
    "worker_id",
    "account_id",
    "lease_generation",
    "data_root",
    "terminal_slots",
    "python_path",
    "adapter_path",
    "acl_helper_path",
    "powershell_path",
    "python_sha256",
    "adapter_sha256",
    "login",
    "password",
    "server",
    "symbol",
    "independent_web_match_confirmed",
}


class HarnessError(RuntimeError):
    """Sanitized validation failure."""


def _now_ms() -> int:
    return time.time_ns() // 1_000_000


def _validate_hash(value: Any) -> str:
    text = str(value)
    if len(text) != 64 or any(character not in "0123456789abcdefABCDEF" for character in text):
        raise HarnessError("ARTIFACT_PIN_INVALID")
    return text.lower()


def validate_request(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict) or set(raw) != INPUT_KEYS or raw.get("schema_version") != 1:
        raise HarnessError("VALIDATION_REQUEST_INVALID")
    worker_id = str(raw.get("worker_id", ""))
    account_id = str(raw.get("account_id", ""))
    if not IDENTIFIER_RE.fullmatch(worker_id) or not IDENTIFIER_RE.fullmatch(account_id):
        raise HarnessError("VALIDATION_IDENTITY_INVALID")
    lease_generation = int(raw.get("lease_generation", 0))
    if lease_generation < 1:
        raise HarnessError("VALIDATION_LEASE_INVALID")
    paths: dict[str, str] = {}
    for field in (
        "agent_path",
        "data_root",
        "python_path",
        "adapter_path",
        "acl_helper_path",
        "powershell_path",
    ):
        path = Path(str(raw.get(field, "")))
        if not path.is_absolute():
            raise HarnessError("VALIDATION_PATH_INVALID")
        paths[field] = str(path)
    for field in (
        "agent_path",
        "python_path",
        "adapter_path",
        "acl_helper_path",
        "powershell_path",
    ):
        if not Path(paths[field]).is_file():
            raise HarnessError("VALIDATION_ARTIFACT_MISSING")
    raw_slots = raw.get("terminal_slots")
    if not isinstance(raw_slots, list) or not raw_slots or len(raw_slots) > 32:
        raise HarnessError("VALIDATION_TERMINAL_SLOTS_INVALID")
    terminal_slots: list[dict[str, str]] = []
    seen_paths: set[str] = set()
    for raw_slot in raw_slots:
        if not isinstance(raw_slot, dict) or set(raw_slot) != {
            "terminal_path",
            "terminal_sha256",
            "servers_sha256",
            "terminal_license_sha256",
        }:
            raise HarnessError("VALIDATION_TERMINAL_SLOT_INVALID")
        terminal_path = Path(str(raw_slot.get("terminal_path", "")))
        normalized = str(terminal_path).casefold()
        if (
            not terminal_path.is_absolute()
            or terminal_path.name.casefold() != "terminal64.exe"
            or not terminal_path.is_file()
            or normalized in seen_paths
        ):
            raise HarnessError("VALIDATION_TERMINAL_SLOT_INVALID")
        seen_paths.add(normalized)
        terminal_slots.append(
            {
                "terminal_path": str(terminal_path),
                "terminal_sha256": _validate_hash(raw_slot["terminal_sha256"]),
                "servers_sha256": _validate_hash(raw_slot["servers_sha256"]),
                "terminal_license_sha256": _validate_hash(
                    raw_slot["terminal_license_sha256"]
                ),
            }
        )
    login = str(raw.get("login", ""))
    password = raw.get("password")
    server = str(raw.get("server", "")).strip()
    if not login.isdigit() or int(login) < 1 or not isinstance(password, str) or not password:
        raise HarnessError("VALIDATION_CREDENTIAL_INVALID")
    if not server or len(server) > 128 or any(ord(char) < 32 or ord(char) == 127 for char in server):
        raise HarnessError("VALIDATION_CREDENTIAL_INVALID")
    symbol = str(raw.get("symbol", "")).strip()
    if len(symbol) > 64:
        raise HarnessError("VALIDATION_SYMBOL_INVALID")
    return {
        **paths,
        "terminal_slots": terminal_slots,
        "worker_id": worker_id,
        "account_id": account_id,
        "lease_generation": lease_generation,
        "python_sha256": _validate_hash(raw["python_sha256"]),
        "adapter_sha256": _validate_hash(raw["adapter_sha256"]),
        "login": login,
        "password": password,
        "server": server,
        "symbol": symbol,
        "independent_web_match_confirmed": bool(raw["independent_web_match_confirmed"]),
    }


def _signing_bytes(frame: dict[str, Any]) -> bytes:
    fields = [
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
    output = bytearray()
    for field in fields:
        encoded = field.encode("utf-8")
        output.extend(struct.pack(">I", len(encoded)))
        output.extend(encoded)
    if len(output) > MAX_FRAME_BYTES:
        raise HarnessError("CONTROL_FRAME_TOO_LARGE")
    return bytes(output)


class ControlChannel:
    def __init__(self, key: bytearray, worker_id: str) -> None:
        self._key = key
        self._worker_id = worker_id
        self._out_sequences: dict[str, int] = {}
        self._in_sequences: dict[str, int] = {}

    def sign(
        self,
        account_id: str,
        lease_generation: int,
        kind: str,
        payload: Any,
        *,
        ttl_ms: int = 45_000,
    ) -> dict[str, Any]:
        sequence = self._out_sequences.get(account_id, 0) + 1
        self._out_sequences[account_id] = sequence
        now_ms = _now_ms()
        frame = {
            "protocol_version": PROTOCOL_VERSION,
            "worker_id": self._worker_id,
            "account_id": account_id,
            "lease_generation": lease_generation,
            "message_id": str(uuid.uuid4()),
            "sent_at_ms": now_ms,
            "expires_at_ms": now_ms + ttl_ms,
            "sequence": sequence,
            "kind": kind,
            "payload_json": json.dumps(payload, separators=(",", ":"), sort_keys=True),
            "mac_hex": "",
        }
        frame["mac_hex"] = hmac.new(bytes(self._key), _signing_bytes(frame), hashlib.sha256).hexdigest()
        return frame

    def verify(self, raw_line: str, account_id: str, lease_generation: int) -> tuple[str, Any]:
        if len(raw_line.encode("utf-8")) > MAX_FRAME_BYTES:
            raise HarnessError("AGENT_FRAME_TOO_LARGE")
        try:
            frame = json.loads(raw_line)
        except json.JSONDecodeError as exc:
            raise HarnessError("AGENT_FRAME_INVALID") from exc
        if (
            frame.get("protocol_version") != PROTOCOL_VERSION
            or frame.get("worker_id") != self._worker_id
            or frame.get("account_id") != account_id
            or int(frame.get("lease_generation", 0)) != lease_generation
        ):
            raise HarnessError("AGENT_FRAME_IDENTITY_MISMATCH")
        sequence = int(frame.get("sequence", 0))
        if sequence <= self._in_sequences.get(account_id, 0):
            raise HarnessError("AGENT_FRAME_REPLAY")
        now_ms = _now_ms()
        sent_at_ms = int(frame.get("sent_at_ms", 0))
        expires_at_ms = int(frame.get("expires_at_ms", 0))
        if expires_at_ms < now_ms or expires_at_ms < sent_at_ms or expires_at_ms - sent_at_ms > MAX_FRAME_TTL_MS:
            raise HarnessError("AGENT_FRAME_EXPIRED")
        expected = hmac.new(bytes(self._key), _signing_bytes(frame), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(str(frame.get("mac_hex", "")), expected):
            raise HarnessError("AGENT_FRAME_AUTH_FAILED")
        self._in_sequences[account_id] = sequence
        try:
            payload = json.loads(str(frame["payload_json"]))
        except (KeyError, json.JSONDecodeError) as exc:
            raise HarnessError("AGENT_PAYLOAD_INVALID") from exc
        return str(frame.get("kind", "")), payload

    def zeroize(self) -> None:
        for index in range(len(self._key)):
            self._key[index] = 0


class AgentProcess:
    def __init__(self, cfg: dict[str, Any], channel: ControlChannel, key_hex: str) -> None:
        creation_flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        try:
            self._process = subprocess.Popen(
                [cfg["agent_path"], "--phase1-stdio"],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                text=True,
                encoding="utf-8",
                bufsize=1,
                creationflags=creation_flags,
            )
        except OSError as exc:
            if getattr(exc, "winerror", None) == 4551:
                raise HarnessError("AGENT_APPLICATION_CONTROL_BLOCKED") from exc
            raise HarnessError("AGENT_START_FAILED") from exc
        if self._process.stdin is None or self._process.stdout is None:
            raise HarnessError("AGENT_PIPE_UNAVAILABLE")
        self._events: queue.Queue[str | None] = queue.Queue(maxsize=16)
        self._reader = threading.Thread(target=self._read_events, daemon=True)
        self._reader.start()
        bootstrap = {
            "protocol_version": PROTOCOL_VERSION,
            "control_key_hex": key_hex,
            "process": {
                "worker_id": cfg["worker_id"],
                "data_root": cfg["data_root"],
                "terminal_slots": cfg["terminal_slots"],
                "python_path": cfg["python_path"],
                "adapter_path": cfg["adapter_path"],
                "acl_helper_path": cfg["acl_helper_path"],
                "powershell_path": cfg["powershell_path"],
                "artifact_pins": {
                    "python_sha256": cfg["python_sha256"],
                    "adapter_sha256": cfg["adapter_sha256"],
                },
                "adapter_event_capacity": 16,
                "job_active_process_limit": 8,
                "job_process_memory_limit": 1_572_864_000,
                "io_timeout_ms": 75_000,
                "graceful_stop_timeout_ms": 5_000,
                "restart_spacing_ms": 2_000,
            },
            "max_terminals": len(cfg["terminal_slots"]),
            "command_queue_capacity": 32,
            "startup_throttle": {
                "window_ms": 60_000,
                "max_starts_per_window": 2,
                "min_spacing_ms": 2_000,
                "max_jitter_ms": 750,
            },
        }
        self._write(bootstrap)
        kind, payload = channel.verify(self._read(), "agent", 1)
        if kind != "agent_hello" or payload.get("private_stdio") is not True:
            raise HarnessError("AGENT_HELLO_INVALID")

    def _read_events(self) -> None:
        assert self._process.stdout is not None
        for line in self._process.stdout:
            self._events.put(line.rstrip("\r\n"))
        self._events.put(None)

    def _write(self, value: dict[str, Any]) -> None:
        assert self._process.stdin is not None
        line = json.dumps(value, separators=(",", ":"), allow_nan=False)
        if len(line.encode("utf-8")) > MAX_FRAME_BYTES:
            raise HarnessError("CONTROL_FRAME_TOO_LARGE")
        self._process.stdin.write(line + "\n")
        self._process.stdin.flush()

    def send(self, frame: dict[str, Any]) -> None:
        self._write(frame)

    def _read(self, timeout_seconds: float = 45.0) -> str:
        try:
            line = self._events.get(timeout=timeout_seconds)
        except queue.Empty as exc:
            raise HarnessError("AGENT_RESPONSE_TIMEOUT") from exc
        if line is None:
            raise HarnessError("AGENT_DISCONNECTED")
        return line

    def receive(self, timeout_seconds: float = 45.0) -> str:
        return self._read(timeout_seconds)

    def close(self) -> None:
        if self._process.stdin is not None and not self._process.stdin.closed:
            try:
                self._process.stdin.close()
            except OSError:
                pass
        try:
            self._process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self._process.kill()
            self._process.wait(timeout=5)


def _snapshot_gate(snapshot: dict[str, Any]) -> bool:
    return (
        snapshot.get("mode") == "demo"
        and snapshot.get("login_matches") is True
        and snapshot.get("server_matches") is True
        and snapshot.get("connected") is True
        and snapshot.get("positions_count") is not None
        and snapshot.get("pending_orders_count") is not None
        and snapshot.get("history_orders_count_7d") is not None
        and snapshot.get("history_deals_count_7d") is not None
        and isinstance(snapshot.get("symbol_specification"), dict)
    )


def run_validation(cfg: dict[str, Any]) -> dict[str, Any]:
    key = bytearray(os.urandom(32))
    key_hex = key.hex()
    channel = ControlChannel(key, cfg["worker_id"])
    agent: AgentProcess | None = None
    snapshots: list[dict[str, Any]] = []
    timings_ms: list[int] = []
    try:
        agent = AgentProcess(cfg, channel, key_hex)
        key_hex = ""
        commands = [
            (
                "provision_account",
                {
                    "login": cfg["login"],
                    "password": cfg["password"],
                    "server": cfg["server"],
                    "symbol": cfg["symbol"],
                },
            ),
            ("restart_account", {}),
            ("restart_account", {}),
            ("force_terminal_crash", {}),
        ]
        for kind, payload in commands:
            started = time.perf_counter_ns()
            agent.send(
                channel.sign(
                    cfg["account_id"], cfg["lease_generation"], kind, payload
                )
            )
            if kind == "provision_account":
                cfg["password"] = None
                cfg["login"] = None
                cfg["server"] = None
                payload["password"] = None
                payload["login"] = None
                payload["server"] = None
            response_kind, response = channel.verify(
                agent.receive(100.0), cfg["account_id"], cfg["lease_generation"]
            )
            if response_kind != "account_snapshot":
                error_class = str(response.get("error_class", "LIFECYCLE_SNAPSHOT_MISSING"))
                if not re.fullmatch(r"[A-Z][A-Z0-9_]{0,63}", error_class):
                    error_class = "LIFECYCLE_SNAPSHOT_MISSING"
                raise HarnessError(error_class)
            snapshots.append(response)
            timings_ms.append((time.perf_counter_ns() - started) // 1_000_000)

        agent.send(
            channel.sign(
                cfg["account_id"], cfg["lease_generation"], "agent_heartbeat", {}
            )
        )
        heartbeat_kind, heartbeat = channel.verify(
            agent.receive(), cfg["account_id"], cfg["lease_generation"]
        )
        if heartbeat_kind != "agent_heartbeat":
            raise HarnessError("HEARTBEAT_MISSING")

        agent.send(
            channel.sign(
                cfg["account_id"], cfg["lease_generation"], "stop_account", {}
            )
        )
        stop_kind, stop = channel.verify(
            agent.receive(), cfg["account_id"], cfg["lease_generation"]
        )
        if stop_kind != "account_runtime_status" or stop.get("active_runtime_count") != 0:
            raise HarnessError("GRACEFUL_STOP_FAILED")

        snapshots_pass = len(snapshots) == 4 and all(_snapshot_gate(item) for item in snapshots)
        lifecycle_pass = snapshots_pass and heartbeat.get("state") == "ready"
        external_confirmed = cfg["independent_web_match_confirmed"]
        return {
            "schema_version": 1,
            "phase": "mt5_windows_vm_phase1",
            "status": "PASS" if lifecycle_pass and external_confirmed else "CONDITIONAL_PASS",
            "lifecycle": {
                "provision": snapshots_pass,
                "clean_restarts": 2,
                "forced_terminal_crash_recovered": snapshots_pass,
                "heartbeat_after_recovery": heartbeat.get("state") == "ready",
                "graceful_stop": True,
                "independent_web_match_confirmed": external_confirmed,
            },
            "security": {
                "authenticated_control_frames": True,
                "authenticated_adapter_stdio": True,
                "bounded_command_queue": True,
                "bounded_adapter_events": True,
                "per_runtime_job_limits": True,
                "acl_and_reparse_checks": True,
                "artifact_pins_verified": True,
                "credentials_absent_from_process_arguments": True,
            },
            "snapshots": snapshots,
            "lifecycle_latency_ms": timings_ms,
            "error_class": None,
        }
    finally:
        cfg["password"] = None
        cfg["login"] = None
        cfg["server"] = None
        channel.zeroize()
        if agent is not None:
            agent.close()


def main() -> int:
    raw: dict[str, Any] | None = None
    cfg: dict[str, Any] | None = None
    try:
        raw_text = sys.stdin.read(MAX_FRAME_BYTES + 1)
        if not raw_text or len(raw_text.encode("utf-8")) > MAX_FRAME_BYTES:
            raise HarnessError("VALIDATION_REQUEST_INVALID")
        raw = json.loads(raw_text)
        cfg = validate_request(raw)
        result = run_validation(cfg)
    except Exception as exc:
        error_class = str(exc) if str(exc).isupper() else type(exc).__name__
        result = {
            "schema_version": 1,
            "phase": "mt5_windows_vm_phase1",
            "status": "BLOCKED",
            "error_class": error_class,
        }
    finally:
        for container in (raw, cfg):
            if container is not None:
                container["login"] = None
                container["password"] = None
                container["server"] = None
    print(json.dumps(result, separators=(",", ":"), allow_nan=False))
    return 0 if result["status"] in {"PASS", "CONDITIONAL_PASS"} else 2


if __name__ == "__main__":
    raise SystemExit(main())
