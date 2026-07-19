from __future__ import annotations

import io
import json
import os
import unittest
from unittest import mock
from types import SimpleNamespace
from typing import Any

from bridge.ftmo_mt5.verify_account import MESSAGES, run, verify_account


PASSWORD = "never-echo-this-password"


class FakeMt5:
    def __init__(
        self,
        *,
        initialize_result: bool = True,
        login_result: bool = True,
        account: Any | None = None,
        account_error: Exception | None = None,
    ) -> None:
        self.initialize_result = initialize_result
        self.login_result = login_result
        self.account = account
        self.account_error = account_error
        self.initialize_calls = 0
        self.last_initialize_kwargs: dict[str, Any] = {}
        self.login_calls: list[tuple[int, str, str]] = []
        self.shutdown_calls = 0

    def initialize(self, **kwargs: Any) -> bool:
        self.initialize_calls += 1
        self.last_initialize_kwargs = kwargs
        return self.initialize_result

    def login(self, login: int, *, password: str, server: str) -> bool:
        self.login_calls.append((login, password, server))
        return self.login_result

    def account_info(self) -> Any | None:
        if self.account_error is not None:
            raise self.account_error
        return self.account

    def shutdown(self) -> None:
        self.shutdown_calls += 1


def request() -> dict[str, str]:
    return {"login": "12345678", "server": "FTMO-Server4", "password": PASSWORD}


def account(**overrides: Any) -> SimpleNamespace:
    values = {
        "login": 12345678,
        "server": "FTMO-Server4",
        "currency": "USD",
        "trade_allowed": True,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


class VerifyAccountTests(unittest.TestCase):
    def test_success_requires_matching_trade_enabled_account_and_shuts_down(self) -> None:
        mt5 = FakeMt5(account=account())

        result = verify_account(request(), mt5)

        self.assertEqual(
            result,
            {
                "verified": True,
                "code": "verified",
                "message": MESSAGES["verified"],
                "account": {
                    "login": "12345678",
                    "server": "FTMO-Server4",
                    "currency": "USD",
                    "tradeAllowed": True,
                },
            },
        )
        self.assertEqual(mt5.initialize_calls, 1)
        self.assertEqual(mt5.login_calls, [(12345678, PASSWORD, "FTMO-Server4")])
        self.assertEqual(mt5.shutdown_calls, 1)
        self.assertNotIn(PASSWORD, json.dumps(result))

    def test_optional_terminal_path_is_passed_to_initialize(self) -> None:
        mt5 = FakeMt5(account=account())
        terminal_path = r"C:\\Program Files\\MetaTrader 5\\terminal64.exe"

        with mock.patch.dict(
            os.environ, {"MT5_VERIFY_TERMINAL_PATH": terminal_path}
        ):
            result = verify_account(request(), mt5)

        self.assertTrue(result["verified"])
        self.assertEqual(mt5.last_initialize_kwargs, {"path": terminal_path})

    def test_native_failures_return_only_sanitized_messages_and_shut_down(self) -> None:
        cases = [
            (FakeMt5(initialize_result=False), "initialize_failed"),
            (FakeMt5(login_result=False), "login_failed"),
            (FakeMt5(account=None), "account_unavailable"),
            (
                FakeMt5(account_error=RuntimeError(f"native error {PASSWORD}")),
                "internal_error",
            ),
        ]
        for mt5, expected_code in cases:
            with self.subTest(code=expected_code):
                result = verify_account(request(), mt5)
                self.assertEqual(result["code"], expected_code)
                self.assertFalse(result["verified"])
                self.assertNotIn("account", result)
                self.assertNotIn(PASSWORD, json.dumps(result))
                self.assertEqual(mt5.shutdown_calls, 1)

    def test_account_identity_and_trade_permission_are_mandatory(self) -> None:
        cases = [
            (account(login=12345679), "account_mismatch"),
            (account(server="Other-Server"), "account_mismatch"),
            (account(trade_allowed=False), "trading_not_allowed"),
        ]
        for returned_account, expected_code in cases:
            with self.subTest(code=expected_code, account=returned_account):
                mt5 = FakeMt5(account=returned_account)
                result = verify_account(request(), mt5)
                self.assertEqual(result["code"], expected_code)
                self.assertFalse(result["verified"])
                self.assertEqual(mt5.shutdown_calls, 1)

    def test_invalid_inputs_do_not_attempt_mt5_connection(self) -> None:
        cases = [
            (None, "invalid_request"),
            ({}, "missing_credentials"),
            ({"login": "not-a-number", "server": "S", "password": "P"}, "invalid_login"),
            ({"login": "0", "server": "S", "password": "P"}, "invalid_login"),
        ]
        for payload, expected_code in cases:
            with self.subTest(code=expected_code):
                mt5 = FakeMt5(account=account())
                result = verify_account(payload, mt5)
                self.assertEqual(result["code"], expected_code)
                self.assertEqual(mt5.initialize_calls, 0)
                self.assertEqual(mt5.shutdown_calls, 0)

    def test_cli_malformed_input_still_emits_one_json_result(self) -> None:
        stdout = io.StringIO()

        exit_code = run(io.StringIO("{bad-json"), stdout)

        self.assertEqual(exit_code, 0)
        self.assertEqual(
            json.loads(stdout.getvalue()),
            {
                "verified": False,
                "code": "invalid_request",
                "message": MESSAGES["invalid_request"],
            },
        )


if __name__ == "__main__":
    unittest.main()
