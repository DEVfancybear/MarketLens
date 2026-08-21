from __future__ import annotations

import ast
import io
import inspect
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from . import phase0_probe
from .phase0_probe import ProbeInputError, _validate_request, run_probe


class MT5Stub:
    __version__ = "5.0.test"
    ACCOUNT_TRADE_MODE_DEMO = 0
    ACCOUNT_TRADE_MODE_CONTEST = 1
    ACCOUNT_TRADE_MODE_REAL = 2

    def __init__(
        self,
        *,
        mode: int = 0,
        initialize_ok: bool = True,
        login_ok: bool = True,
        observed_terminal_path: str | None = None,
    ) -> None:
        self.mode = mode
        self.initialize_ok = initialize_ok
        self.login_ok = login_ok
        self.observed_terminal_path = observed_terminal_path
        self.shutdown_calls = 0
        self.login_args = None

    def initialize(
        self,
        path: str,
        *,
        login: int,
        password: str,
        server: str,
        timeout: int,
        portable: bool,
    ) -> bool:
        self.initialize_args = (path, login, password, server, timeout, portable)
        return self.initialize_ok

    def login(self, login: int, *, password: str, server: str, timeout: int) -> bool:
        self.login_args = (login, password, server, timeout)
        return self.login_ok

    def account_info(self):
        return SimpleNamespace(
            login=12345678,
            server="FTMO-Demo",
            trade_mode=self.mode,
            trade_allowed=True,
            trade_expert=True,
            margin_mode=2,
            currency="USD",
            leverage=100,
        )

    def terminal_info(self):
        return SimpleNamespace(
            connected=True,
            path=self.observed_terminal_path or self.initialize_args[0],
        )

    def positions_get(self):
        return ()

    def orders_get(self):
        return ()

    def symbols_total(self):
        return 1

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
            filling_mode=1,
            volume_min=0.01,
            volume_max=100.0,
            volume_step=0.01,
            trade_stops_level=0,
            trade_freeze_level=0,
            trade_contract_size=100000.0,
            currency_base="EUR",
            currency_profit="USD",
            currency_margin="EUR",
        )

    def history_orders_get(self, _start, _end):
        return ()

    def history_deals_get(self, _start, _end):
        return ()

    def last_error(self):
        return (1, "Success")

    def shutdown(self) -> None:
        self.shutdown_calls += 1


class Phase0ProbeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.terminal_path = str(Path(self.temp_dir.name) / "terminal64.exe")
        self.request = {
            "schema_version": 1,
            "account_alias": "ftmo-free-trial",
            "terminal_path": self.terminal_path,
            "login": "12345678",
            "password": "sensitive-test-value",
            "server": "FTMO-Demo",
            "symbol": "EURUSD",
            "timeout_ms": 60_000,
        }

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_demo_read_only_probe_passes_without_emitting_credentials(self) -> None:
        stub = MT5Stub()
        result = run_probe(stub, dict(self.request))

        self.assertEqual("PASS", result["status"])
        self.assertEqual("demo", result["account"]["mode"])
        self.assertTrue(result["account"]["login_matches"])
        self.assertTrue(result["account"]["server_matches"])
        self.assertTrue(result["account"]["terminal_path_matches"])
        self.assertEqual(
            (
                self.request["terminal_path"],
                int(self.request["login"]),
                self.request["password"],
                self.request["server"],
                60_000,
                False,
            ),
            stub.initialize_args,
        )
        self.assertEqual(1, stub.shutdown_calls)
        serialized = json.dumps(result)
        self.assertNotIn(self.request["password"], serialized)
        self.assertNotIn(self.request["login"], serialized)

    def test_live_account_fails_the_phase_zero_gate(self) -> None:
        stub = MT5Stub(mode=MT5Stub.ACCOUNT_TRADE_MODE_REAL)
        result = run_probe(stub, dict(self.request))

        self.assertEqual("BLOCKED", result["status"])
        self.assertEqual("live", result["account"]["mode"])
        account_mode_test = next(item for item in result["tests"] if item["id"] == "ACC-04")
        self.assertEqual("FAIL", account_mode_test["status"])

    def test_initialize_failure_is_sanitized_and_does_not_call_shutdown(self) -> None:
        stub = MT5Stub(initialize_ok=False)
        result = run_probe(stub, dict(self.request))

        self.assertEqual("BLOCKED", result["status"])
        self.assertEqual("MT5_INITIALIZE_FAILED", result["error_class"])
        self.assertEqual(0, stub.shutdown_calls)
        self.assertNotIn(self.request["password"], json.dumps(result))

    def test_login_failure_is_sanitized_and_shuts_down(self) -> None:
        stub = MT5Stub(login_ok=False)
        result = run_probe(stub, dict(self.request))

        self.assertEqual("BLOCKED", result["status"])
        self.assertEqual("MT5_LOGIN_FAILED", result["error_class"])
        self.assertEqual(1, stub.shutdown_calls)
        serialized = json.dumps(result)
        self.assertNotIn(self.request["password"], serialized)
        self.assertNotIn(self.request["login"], serialized)

    def test_wrong_observed_terminal_path_fails_closed_and_shuts_down(self) -> None:
        wrong_path = str(Path(self.temp_dir.name) / "other" / "terminal64.exe")
        stub = MT5Stub(observed_terminal_path=wrong_path)

        result = run_probe(stub, dict(self.request))

        self.assertEqual("BLOCKED", result["status"])
        self.assertEqual("MT5_TERMINAL_PATH_MISMATCH", result["error_class"])
        self.assertEqual(1, stub.shutdown_calls)
        serialized = json.dumps(result)
        self.assertNotIn(wrong_path, serialized)
        self.assertNotIn(self.request["password"], serialized)

    def test_timeout_defaults_to_sixty_seconds_and_is_strictly_bounded(self) -> None:
        defaulted = dict(self.request)
        defaulted.pop("timeout_ms")
        self.assertEqual(60_000, _validate_request(defaulted)["timeout_ms"])

        self.assertEqual(60_000, _validate_request(dict(self.request))["timeout_ms"])
        for invalid_timeout in (999, 60_001):
            with self.subTest(timeout_ms=invalid_timeout):
                invalid = dict(self.request)
                invalid["timeout_ms"] = invalid_timeout
                with self.assertRaises(ProbeInputError):
                    _validate_request(invalid)

    def test_partial_or_extra_credentials_fail_closed(self) -> None:
        missing_password = dict(self.request)
        missing_password.pop("password")
        with self.assertRaises(ProbeInputError):
            _validate_request(missing_password)

        extra_field = dict(self.request)
        extra_field["unexpected"] = "value"
        with self.assertRaises(ProbeInputError):
            _validate_request(extra_field)

    def test_probe_source_contains_no_trade_mutation_api(self) -> None:
        tree = ast.parse(inspect.getsource(phase0_probe))
        called_attributes = {
            node.func.attr
            for node in ast.walk(tree)
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
        }
        forbidden = {"order_send", "order_check"}
        self.assertTrue(forbidden.isdisjoint(called_attributes))

    def test_server_control_characters_fail_closed(self) -> None:
        request = dict(self.request)
        request["server"] = "FTMO-Demo\nforged-log"
        with self.assertRaises(ProbeInputError):
            _validate_request(request)

    def test_main_runs_the_validated_request(self) -> None:
        stub = MT5Stub()
        stdout = io.StringIO()

        with (
            mock.patch.object(sys, "stdin", io.StringIO(json.dumps(self.request))),
            mock.patch.object(sys, "stdout", stdout),
            mock.patch.dict(sys.modules, {"MetaTrader5": stub}),
        ):
            exit_code = phase0_probe.main()

        self.assertEqual(0, exit_code)
        self.assertEqual("PASS", json.loads(stdout.getvalue())["status"])


if __name__ == "__main__":
    unittest.main()
