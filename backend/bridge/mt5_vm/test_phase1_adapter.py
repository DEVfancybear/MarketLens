from __future__ import annotations

import ast
import inspect
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from . import phase1_adapter


class MT5Stub:
    ACCOUNT_TRADE_MODE_DEMO = 0
    ACCOUNT_TRADE_MODE_CONTEST = 1
    ACCOUNT_TRADE_MODE_REAL = 2

    def __init__(self) -> None:
        self.shutdown_calls = 0

    def initialize(self, path: str, timeout: int, portable: bool) -> bool:
        self.initialize_args = (path, timeout, portable)
        return True

    def login(self, login: int, *, password: str, server: str, timeout: int) -> bool:
        self.login_args = (login, password, server, timeout)
        return True

    def account_info(self):
        return SimpleNamespace(
            login=12345678,
            server="FTMO-Demo",
            trade_mode=0,
            trade_allowed=True,
            trade_expert=True,
            margin_mode=2,
            currency="USD",
            leverage=100,
        )

    def terminal_info(self):
        return SimpleNamespace(connected=True)

    def positions_get(self):
        return ()

    def orders_get(self):
        return ()

    def history_orders_get(self, _start, _end):
        return ()

    def history_deals_get(self, _start, _end):
        return ()

    def symbols_get(self):
        return (SimpleNamespace(name="EURUSD", visible=True),)

    def symbol_info_tick(self, symbol: str):
        return SimpleNamespace(bid=1.0, ask=1.1) if symbol == "EURUSD" else None

    def symbol_info(self, symbol: str):
        if symbol != "EURUSD":
            return None
        return SimpleNamespace(
            digits=5,
            point=0.00001,
            trade_mode=4,
            order_mode=127,
            filling_mode=3,
            volume_min=0.01,
            volume_max=50.0,
            volume_step=0.01,
            trade_stops_level=0,
            trade_freeze_level=0,
            trade_contract_size=100000.0,
            currency_base="EUR",
            currency_profit="USD",
            currency_margin="EUR",
        )

    def last_error(self):
        return (1, "Success")

    def shutdown(self) -> None:
        self.shutdown_calls += 1


class Phase1AdapterTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.bootstrap = {
            "protocol_version": 1,
            "worker_id": "worker-01",
            "account_id": "account-a",
            "lease_generation": 7,
            "ipc_key_hex": "07" * 32,
            "terminal_path": str(Path(self.temp_dir.name) / "terminal64.exe"),
            "login": "12345678",
            "password": "sensitive-test-password",
            "server": "FTMO-Demo",
            "symbol": "EURUSD",
            "timeout_ms": 12_000,
        }

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_snapshot_is_complete_and_contains_no_credentials(self) -> None:
        cfg = phase1_adapter.validate_bootstrap(dict(self.bootstrap))
        stub = MT5Stub()
        result = phase1_adapter.initialize_and_snapshot(stub, cfg)
        serialized = json.dumps(result)
        self.assertEqual("demo", result["mode"])
        self.assertTrue(result["login_matches"])
        self.assertTrue(result["server_matches"])
        self.assertIn("symbol_specification", result)
        self.assertNotIn(self.bootstrap["login"], serialized)
        self.assertNotIn(self.bootstrap["password"], serialized)
        self.assertNotIn(self.bootstrap["server"], serialized)
        self.assertEqual(
            (self.bootstrap["terminal_path"], 12_000, True),
            stub.initialize_args,
        )

    def test_initialize_failure_is_bounded_to_safe_error_classes(self) -> None:
        cfg = phase1_adapter.validate_bootstrap(dict(self.bootstrap))
        cases = (
            (
                (-10003, "IPC initialize failed, Process create failed C:/private/path"),
                "MT5_PROCESS_CREATE_FAILED",
            ),
            (
                (-10003, "IPC initialize failed, Pipe server didn't answer in 60 sec"),
                "MT5_PIPE_SERVER_TIMEOUT",
            ),
            ((-10003, "internal IPC initialization fail"), "MT5_IPC_INITIALIZE_FAILED"),
            ((-10005, "internal timeout"), "MT5_IPC_TIMEOUT"),
        )
        for last_error, expected in cases:
            with self.subTest(expected=expected):
                stub = MT5Stub()
                stub.initialize = mock.Mock(return_value=False)
                stub.last_error = mock.Mock(return_value=last_error)
                with self.assertRaisesRegex(RuntimeError, f"^{expected}$"):
                    phase1_adapter.initialize_and_snapshot(stub, cfg)

    def test_authenticated_command_rejects_tamper_replay_and_expiry(self) -> None:
        cfg = phase1_adapter.validate_bootstrap(dict(self.bootstrap))
        frame = phase1_adapter.sign_frame(
            cfg,
            sequence=1,
            kind="agent_heartbeat",
            payload={},
            now_ms=1_000,
            ttl_ms=1_000,
        )
        command, sequence = phase1_adapter.verify_command_frame(
            cfg, json.dumps(frame), last_sequence=0, now_ms=1_500
        )
        self.assertEqual("agent_heartbeat", command["kind"])
        with self.assertRaises(phase1_adapter.AdapterInputError):
            phase1_adapter.verify_command_frame(
                cfg, json.dumps(frame), last_sequence=sequence, now_ms=1_500
            )
        tampered = dict(frame)
        tampered["payload_json"] = '{"unsafe":true}'
        with self.assertRaises(phase1_adapter.AdapterInputError):
            phase1_adapter.verify_command_frame(
                cfg, json.dumps(tampered), last_sequence=0, now_ms=1_500
            )
        with self.assertRaises(phase1_adapter.AdapterInputError):
            phase1_adapter.verify_command_frame(
                cfg, json.dumps(frame), last_sequence=0, now_ms=3_000
            )

    def test_main_runs_snapshot_heartbeat_and_graceful_stop(self) -> None:
        signing_cfg = phase1_adapter.validate_bootstrap(dict(self.bootstrap))
        heartbeat = phase1_adapter.sign_frame(
            signing_cfg,
            sequence=1,
            kind="agent_heartbeat",
            payload={},
        )
        stop = phase1_adapter.sign_frame(
            signing_cfg,
            sequence=2,
            kind="stop_account",
            payload={},
        )
        stdin = io.StringIO(
            "\n".join(
                [
                    json.dumps(self.bootstrap),
                    json.dumps(heartbeat),
                    json.dumps(stop),
                    "",
                ]
            )
        )
        stdout = io.StringIO()
        stderr = io.StringIO()
        stub = MT5Stub()
        with (
            mock.patch.object(sys, "stdin", stdin),
            mock.patch.object(sys, "stdout", stdout),
            mock.patch.object(sys, "stderr", stderr),
            mock.patch.dict(sys.modules, {"MetaTrader5": stub}),
        ):
            exit_code = phase1_adapter.main()

        self.assertEqual(0, exit_code)
        frames = [json.loads(line) for line in stdout.getvalue().splitlines()]
        self.assertEqual(
            ["account_snapshot", "agent_heartbeat", "account_runtime_status"],
            [frame["kind"] for frame in frames],
        )
        output = stdout.getvalue() + stderr.getvalue()
        for secret in (
            self.bootstrap["login"],
            self.bootstrap["password"],
            self.bootstrap["server"],
            self.bootstrap["ipc_key_hex"],
        ):
            self.assertNotIn(secret, output)
        self.assertEqual(1, stub.shutdown_calls)

    def test_bootstrap_fails_closed_for_partial_extra_and_control_characters(self) -> None:
        for mutate in ("missing", "extra", "control"):
            raw = dict(self.bootstrap)
            if mutate == "missing":
                raw.pop("password")
            elif mutate == "extra":
                raw["unexpected"] = True
            else:
                raw["server"] = "FTMO-Demo\nforged"
            with self.assertRaises(phase1_adapter.AdapterInputError):
                phase1_adapter.validate_bootstrap(raw)

    def test_adapter_has_no_network_or_trade_mutation_surface(self) -> None:
        tree = ast.parse(inspect.getsource(phase1_adapter))
        imported = {
            alias.name
            for node in ast.walk(tree)
            if isinstance(node, (ast.Import, ast.ImportFrom))
            for alias in node.names
        }
        called_attributes = {
            node.func.attr
            for node in ast.walk(tree)
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
        }
        self.assertNotIn("socket", imported)
        self.assertTrue({"order_send", "order_check"}.isdisjoint(called_attributes))


if __name__ == "__main__":
    unittest.main()
