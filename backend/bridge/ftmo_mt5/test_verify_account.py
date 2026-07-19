from __future__ import annotations

import io
import json
import os
import threading
import unittest
import uuid
from unittest import mock
from types import SimpleNamespace
from typing import Any

from bridge.ftmo_mt5.verify_account import (
    MESSAGES,
    _mutex_timeout_ms,
    _verification_mutex,
    run,
    verify_account,
)


PASSWORD = "never-echo-this-password"


class FakeMt5:
    def __init__(
        self,
        *,
        initialize_result: bool = True,
        last_error: tuple[int, str] = (-1, "initialize failed"),
        account: Any | None = None,
        account_error: Exception | None = None,
    ) -> None:
        self.initialize_result = initialize_result
        self.last_error_result = last_error
        self.account = account
        self.account_error = account_error
        self.initialize_calls = 0
        self.last_initialize_args: tuple[Any, ...] = ()
        self.last_initialize_kwargs: dict[str, Any] = {}
        self.shutdown_calls = 0

    def initialize(self, *args: Any, **kwargs: Any) -> bool:
        self.initialize_calls += 1
        self.last_initialize_args = args
        self.last_initialize_kwargs = kwargs
        return self.initialize_result

    def last_error(self) -> tuple[int, str]:
        return self.last_error_result

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
        "company": "FTMO S.R.O.",
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
        self.assertEqual(mt5.last_initialize_args, ())
        self.assertEqual(
            mt5.last_initialize_kwargs,
            {
                "login": 12345678,
                "password": PASSWORD,
                "server": "FTMO-Server4",
                "timeout": 8_000,
            },
        )
        self.assertEqual(mt5.shutdown_calls, 1)
        self.assertNotIn(PASSWORD, json.dumps(result))

    def test_managed_terminal_path_uses_positional_portable_initialize(self) -> None:
        mt5 = FakeMt5(account=account())
        terminal_path = r"C:\\Program Files\\MetaTrader 5\\terminal64.exe"

        with mock.patch.dict(
            os.environ,
            {
                "MT5_VERIFY_TERMINAL_PATH": terminal_path,
                "MT5_VERIFY_PORTABLE": "true",
            },
        ):
            result = verify_account(request(), mt5)

        self.assertTrue(result["verified"])
        self.assertEqual(mt5.last_initialize_args, (terminal_path,))
        self.assertEqual(
            mt5.last_initialize_kwargs,
            {
                "login": 12345678,
                "password": PASSWORD,
                "server": "FTMO-Server4",
                "timeout": 8_000,
                "portable": True,
            },
        )

    def test_explicit_terminal_override_does_not_force_portable_mode(self) -> None:
        mt5 = FakeMt5(account=account())
        terminal_path = r"C:\\Broker\\MetaTrader 5\\terminal64.exe"

        with mock.patch.dict(
            os.environ,
            {
                "MT5_VERIFY_TERMINAL_PATH": terminal_path,
                "MT5_VERIFY_PORTABLE": "",
            },
        ):
            result = verify_account(request(), mt5)

        self.assertTrue(result["verified"])
        self.assertEqual(mt5.last_initialize_args, (terminal_path,))
        self.assertNotIn("portable", mt5.last_initialize_kwargs)

    def test_native_timeout_is_configurable_and_safely_bounded(self) -> None:
        cases = [
            ("invalid", 8_000),
            ("100", 1_000),
            ("5000", 5_000),
            ("60000", 12_000),
        ]
        for configured, expected in cases:
            with self.subTest(configured=configured):
                mt5 = FakeMt5(account=account())
                with mock.patch.dict(
                    os.environ,
                    {"MT5_VERIFY_NATIVE_TIMEOUT_MS": configured},
                ):
                    result = verify_account(request(), mt5)
                self.assertTrue(result["verified"])
                self.assertEqual(
                    mt5.last_initialize_kwargs["timeout"], expected
                )

    def test_mutex_timeout_is_configurable_and_safely_bounded(self) -> None:
        cases = [
            ("invalid", 15_000),
            ("1", 100),
            ("5000", 5_000),
            ("60000", 17_000),
        ]
        for configured, expected in cases:
            with self.subTest(configured=configured):
                with mock.patch.dict(
                    os.environ,
                    {"MT5_VERIFY_MUTEX_TIMEOUT_MS": configured},
                ):
                    self.assertEqual(_mutex_timeout_ms(), expected)

    def test_non_windows_mutex_fallback_is_a_noop(self) -> None:
        with mock.patch(
            "bridge.ftmo_mt5.verify_account._platform_is_windows",
            return_value=False,
        ):
            with _verification_mutex(name="unused", timeout_ms=1):
                pass

    @unittest.skipUnless(os.name == "nt", "Windows named mutex test")
    def test_mutex_timeout_prevents_any_native_mt5_call(self) -> None:
        mutex_name = (
            r"Global\SMCTradingTerminal.MT5Verifier.Test."
            + uuid.uuid4().hex
        )
        ready = threading.Event()
        release = threading.Event()
        holder_errors: list[BaseException] = []

        def hold_mutex() -> None:
            try:
                with _verification_mutex(name=mutex_name, timeout_ms=1_000):
                    ready.set()
                    if not release.wait(5):
                        raise TimeoutError("test did not release the mutex holder")
            except BaseException as exc:  # Surface worker failures in the test.
                holder_errors.append(exc)
                ready.set()

        holder = threading.Thread(target=hold_mutex, daemon=True)
        holder.start()
        self.assertTrue(ready.wait(2), "mutex holder did not start")

        mt5 = FakeMt5(account=account())
        try:
            if holder_errors:
                raise holder_errors[0]
            with mock.patch.dict(
                os.environ,
                {
                    "MT5_VERIFY_MUTEX_NAME": mutex_name,
                    "MT5_VERIFY_MUTEX_TIMEOUT_MS": "100",
                },
            ):
                result = verify_account(request(), mt5)
        finally:
            release.set()
            holder.join(2)

        self.assertFalse(holder.is_alive())
        self.assertEqual(holder_errors, [])
        self.assertEqual(result["code"], "internal_error")
        self.assertEqual(mt5.initialize_calls, 0)
        self.assertEqual(mt5.shutdown_calls, 0)

    @unittest.skipUnless(os.name == "nt", "Windows named mutex test")
    def test_abandoned_windows_mutex_is_recovered_and_released(self) -> None:
        import ctypes
        from ctypes import wintypes

        mutex_name = (
            r"Global\SMCTradingTerminal.MT5Verifier.Test."
            + uuid.uuid4().hex
        )
        ready = threading.Event()
        handles: list[tuple[Any, Any]] = []
        worker_errors: list[BaseException] = []

        def create_and_abandon_mutex() -> None:
            try:
                kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
                kernel32.CreateMutexW.argtypes = (
                    wintypes.LPVOID,
                    wintypes.BOOL,
                    wintypes.LPCWSTR,
                )
                kernel32.CreateMutexW.restype = wintypes.HANDLE
                kernel32.CloseHandle.argtypes = (wintypes.HANDLE,)
                kernel32.CloseHandle.restype = wintypes.BOOL
                handle = kernel32.CreateMutexW(None, True, mutex_name)
                if not handle:
                    raise OSError("test could not create a named mutex")
                # Keep the handle open after this owning thread exits so the
                # next waiter receives WAIT_ABANDONED.
                handles.append((kernel32, handle))
            except BaseException as exc:
                worker_errors.append(exc)
            finally:
                ready.set()

        owner = threading.Thread(target=create_and_abandon_mutex, daemon=True)
        owner.start()
        self.assertTrue(ready.wait(2), "abandoned mutex owner did not start")
        owner.join(2)
        self.assertFalse(owner.is_alive())

        try:
            if worker_errors:
                raise worker_errors[0]
            with _verification_mutex(name=mutex_name, timeout_ms=1_000):
                pass
        finally:
            for kernel32, handle in handles:
                kernel32.CloseHandle(handle)

        self.assertEqual(worker_errors, [])

    def test_native_failures_return_only_sanitized_messages_and_shut_down(self) -> None:
        cases = [
            (FakeMt5(initialize_result=False), "initialize_failed"),
            (
                FakeMt5(
                    initialize_result=False,
                    last_error=(-6, f"authorization failed {PASSWORD}"),
                ),
                "login_failed",
            ),
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

        other_request = {**request(), "server": "Other-Server"}
        mt5 = FakeMt5(
            account=account(server="Other-Server", company="Other Broker")
        )
        result = verify_account(other_request, mt5)
        self.assertEqual(result["code"], "unsupported_broker")
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
