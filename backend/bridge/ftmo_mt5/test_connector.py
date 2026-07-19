from __future__ import annotations

import json
import os
from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch

from bridge.ftmo_mt5.config import companion_config
from bridge.ftmo_mt5.connector import _allowed_origins, create_service
from bridge.ftmo_mt5.connector_auth import (
    TicketValidationError,
    ValidatedTicket,
)
from bridge.ftmo_mt5.mt5_adapter import Mt5Adapter
from bridge.ftmo_mt5.protocol import envelope, now_ms
from bridge.ftmo_mt5.risk_guard import RiskGuard, _prague_trading_day
from bridge.ftmo_mt5.service import AuthenticatedSession, FtmoMt5Service


class _Socket:
    def __init__(self) -> None:
        self.sent: list[dict[str, object]] = []
        self.closed = False
        self.close_code: int | None = None

    async def send(self, raw: str) -> None:
        self.sent.append(json.loads(raw))

    async def close(self, code: int | None = None, reason: str = "") -> None:
        self.closed = True
        self.close_code = code


class _Validator:
    def __init__(
        self,
        result: ValidatedTicket | None = None,
        error: TicketValidationError | None = None,
    ) -> None:
        self.result = result
        self.error = error
        self.seen: list[str] = []

    def validate(self, ticket: str) -> ValidatedTicket:
        self.seen.append(ticket)
        if self.error is not None:
            raise self.error
        assert self.result is not None
        return self.result


class _AccountAdapter:
    def __init__(self, error: tuple[str, str] | None = None) -> None:
        self.error = error
        self.checks: list[tuple[str, str]] = []
        self.connects: list[tuple[str, str]] = []

    def connect(self, login: str = "", server: str = "") -> None:
        self.connects.append((login, server))

    def expected_account_error(
        self, login: str, server: str
    ) -> tuple[str, str] | None:
        self.checks.append((login, server))
        return self.error


class ConnectorServiceTests(unittest.IsolatedAsyncioTestCase):
    def make_service(self, validator: _Validator) -> FtmoMt5Service:
        return FtmoMt5Service(
            companion_config(data_dir=Path(".test-connector-data")),
            ticket_validator=validator,
            allowed_origins=("https://tradingterminal.io.vn",),
        )

    async def test_valid_ticket_requires_matching_live_account_before_auth_ok(self) -> None:
        validator = _Validator(
            ValidatedTicket("12345678", "FTMO-Server4", now_ms() + 60_000)
        )
        service = self.make_service(validator)
        adapter = _AccountAdapter()
        service.adapter = adapter  # type: ignore[assignment]
        service.send_snapshots = AsyncMock()  # type: ignore[method-assign]
        socket = _Socket()

        await service.handle_message(
            socket,
            json.dumps(envelope("auth.request", {"token": "pair-ticket"}, "req-1")),
        )

        self.assertEqual(validator.seen, ["pair-ticket"])
        self.assertEqual(adapter.checks, [("12345678", "FTMO-Server4")])
        self.assertEqual(socket.sent[0]["type"], "auth.ok")
        self.assertIn(socket, service.sessions)
        service.send_snapshots.assert_awaited_once_with(socket)

    async def test_account_mismatch_rejects_and_closes_without_snapshots(self) -> None:
        validator = _Validator(
            ValidatedTicket("12345678", "FTMO-Server4", now_ms() + 60_000)
        )
        service = self.make_service(validator)
        service.adapter = _AccountAdapter(  # type: ignore[assignment]
            ("MT5_ACCOUNT_MISMATCH", "different account")
        )
        service.send_snapshots = AsyncMock()  # type: ignore[method-assign]
        socket = _Socket()

        await service.handle_message(
            socket,
            json.dumps(envelope("auth.request", {"token": "ticket"}, "req-2")),
        )

        self.assertEqual(socket.sent[0]["type"], "auth.reject")
        self.assertEqual(socket.sent[0]["payload"], {"reason": "account_mismatch"})
        self.assertTrue(socket.closed)
        self.assertEqual(
            service.adapter.connects, [("12345678", "FTMO-Server4")]  # type: ignore[attr-defined]
        )
        service.send_snapshots.assert_not_awaited()

    async def test_rejected_ticket_closes_socket(self) -> None:
        service = self.make_service(
            _Validator(error=TicketValidationError("invalid_ticket"))
        )
        socket = _Socket()

        await service.handle_message(
            socket,
            json.dumps(envelope("auth.request", {"token": "bad"}, "req-3")),
        )

        self.assertEqual(socket.sent[0]["type"], "auth.reject")
        self.assertTrue(socket.closed)
        self.assertEqual(socket.close_code, 1008)

    async def test_no_heartbeat_or_order_is_accepted_before_auth(self) -> None:
        service = self.make_service(
            _Validator(ValidatedTicket("1", "FTMO", now_ms() + 60_000))
        )
        socket = _Socket()

        await service.handle_message(
            socket,
            json.dumps(envelope("heartbeat", {"ts": now_ms()}, "req-4")),
        )
        await service.handle_message(
            socket,
            json.dumps(
                envelope(
                    "order.cancel",
                    {"clientOrderId": "order-1", "ticket": "99"},
                    "req-5",
                )
            ),
        )

        self.assertEqual([item["type"] for item in socket.sent], ["error", "error"])
        self.assertTrue(
            all(item["payload"]["code"] == "AUTH_REQUIRED" for item in socket.sent)  # type: ignore[index]
        )

    async def test_snapshot_sender_is_silent_before_auth(self) -> None:
        service = self.make_service(
            _Validator(ValidatedTicket("1", "FTMO", now_ms() + 60_000))
        )
        socket = _Socket()

        await service.send_snapshots(socket)

        self.assertEqual(socket.sent, [])

    async def test_malformed_envelope_is_rejected_without_crashing(self) -> None:
        service = self.make_service(
            _Validator(ValidatedTicket("1", "FTMO", now_ms() + 60_000))
        )
        socket = _Socket()

        await service.handle_message(socket, json.dumps(["not", "an", "envelope"]))

        self.assertEqual(socket.sent[0]["type"], "error")
        self.assertEqual(socket.sent[0]["payload"]["code"], "INVALID_MESSAGE")  # type: ignore[index]

    async def test_every_order_rechecks_current_account(self) -> None:
        service = self.make_service(
            _Validator(ValidatedTicket("1", "FTMO", now_ms() + 60_000))
        )
        adapter = _AccountAdapter(
            ("MT5_ACCOUNT_MISMATCH", "The account changed.")
        )
        service.adapter = adapter  # type: ignore[assignment]
        service.reject_order = AsyncMock()  # type: ignore[method-assign]
        service.handle_order_cancel = AsyncMock()  # type: ignore[method-assign]
        socket = _Socket()
        service.sessions[socket] = AuthenticatedSession(
            "session", "12345678", "FTMO-Server4", now_ms() + 60_000
        )
        message = envelope(
            "order.cancel",
            {"clientOrderId": "order-2", "ticket": "100"},
            "req-6",
        )

        await service.handle_message(socket, json.dumps(message))

        self.assertEqual(adapter.checks, [("12345678", "FTMO-Server4")])
        service.reject_order.assert_awaited_once()
        service.handle_order_cancel.assert_not_awaited()

    async def test_expired_session_rejects_and_closes(self) -> None:
        service = self.make_service(
            _Validator(ValidatedTicket("1", "FTMO", now_ms() + 60_000))
        )
        socket = _Socket()
        service.sessions[socket] = AuthenticatedSession(
            "expired", "1", "FTMO", now_ms() - 1
        )

        await service.handle_message(
            socket,
            json.dumps(envelope("heartbeat", {"ts": now_ms()}, "req-7")),
        )

        self.assertEqual(socket.sent[0]["type"], "auth.reject")
        self.assertEqual(socket.sent[0]["payload"], {"reason": "session_expired"})
        self.assertTrue(socket.closed)

    async def test_different_account_cannot_replace_an_active_session(self) -> None:
        validator = _Validator(
            ValidatedTicket("222", "FTMO-Server4", now_ms() + 60_000)
        )
        service = self.make_service(validator)
        adapter = _AccountAdapter(("MT5_ACCOUNT_MISMATCH", "different account"))
        service.adapter = adapter  # type: ignore[assignment]
        active_socket = _Socket()
        service.sessions[active_socket] = AuthenticatedSession(
            "active", "111", "FTMO-Server3", now_ms() + 60_000
        )
        candidate_socket = _Socket()

        await service.handle_message(
            candidate_socket,
            json.dumps(envelope("auth.request", {"token": "ticket-b"}, "req-b")),
        )

        self.assertEqual(candidate_socket.sent[0]["type"], "auth.reject")
        self.assertEqual(
            candidate_socket.sent[0]["payload"], {"reason": "account_mismatch"}
        )
        self.assertEqual(adapter.connects, [])
        self.assertEqual(adapter.checks, [])
        self.assertIn(active_socket, service.sessions)

    async def test_reauth_on_same_socket_is_closed_without_switch_or_snapshot(self) -> None:
        validator = _Validator(
            ValidatedTicket("222", "FTMO-Server4", now_ms() + 60_000)
        )
        service = self.make_service(validator)
        adapter = _AccountAdapter()
        service.adapter = adapter  # type: ignore[assignment]
        service.send_snapshots = AsyncMock()  # type: ignore[method-assign]
        socket = _Socket()
        original_session = AuthenticatedSession(
            "original", "111", "FTMO-Server3", now_ms() + 60_000
        )
        service.sessions[socket] = original_session

        await service.handle_message(
            socket,
            json.dumps(envelope("auth.request", {"token": "ticket-b"}, "req-reauth")),
        )

        self.assertEqual(validator.seen, [])
        self.assertEqual(adapter.connects, [])
        self.assertEqual(adapter.checks, [])
        self.assertEqual([item["type"] for item in socket.sent], ["auth.reject"])
        self.assertEqual(
            socket.sent[0]["payload"], {"reason": "already_authenticated"}
        )
        self.assertTrue(socket.closed)
        self.assertEqual(socket.close_code, 1008)
        self.assertNotIn(socket, service.sessions)
        service.send_snapshots.assert_not_awaited()

    async def test_account_mismatch_order_reject_does_not_query_risk(self) -> None:
        service = self.make_service(
            _Validator(ValidatedTicket("1", "FTMO", now_ms() + 60_000))
        )
        service.adapter = _AccountAdapter(  # type: ignore[assignment]
            ("MT5_ACCOUNT_MISMATCH", "The account changed.")
        )
        service.risk_snapshot = lambda **_kwargs: (_ for _ in ()).throw(  # type: ignore[method-assign]
            AssertionError("mismatched account risk must not be queried")
        )
        socket = _Socket()
        service.sessions[socket] = AuthenticatedSession(
            "session", "12345678", "FTMO-Server4", now_ms() + 60_000
        )

        await service.handle_message(
            socket,
            json.dumps(
                envelope(
                    "order.cancel",
                    {"clientOrderId": "cancel-mismatch", "ticket": "1"},
                    "req-mismatch",
                )
            ),
        )

        rejection = socket.sent[0]
        self.assertEqual(rejection["type"], "order.reject")
        self.assertEqual(rejection["payload"]["code"], "MT5_ACCOUNT_MISMATCH")  # type: ignore[index]
        self.assertNotIn("snapshot", rejection["payload"])  # type: ignore[operator]

    async def test_modify_and_cancel_emit_terminal_execution_reports(self) -> None:
        config = replace(
            companion_config(data_dir=Path(".test-connector-data")),
            dry_run=True,
            allow_live=False,
            attached_account=False,
            login="1",
            server="FTMO-DryRun",
        )
        service = FtmoMt5Service(config)
        socket = _Socket()
        service.clients.add(socket)
        service.sessions[socket] = AuthenticatedSession(
            "session", "1", "FTMO-DryRun", now_ms() + 60_000
        )

        await service.handle_message(
            socket,
            json.dumps(
                envelope(
                    "order.modify",
                    {"clientOrderId": "modify-1", "ticket": "10", "sl": 1.0},
                    "req-modify",
                )
            ),
        )
        await service.handle_message(
            socket,
            json.dumps(
                envelope(
                    "order.cancel",
                    {"clientOrderId": "cancel-1", "ticket": "11"},
                    "req-cancel",
                )
            ),
        )

        reports = [item for item in socket.sent if item["type"] == "execution.report"]
        self.assertEqual(
            [item["payload"]["status"] for item in reports],  # type: ignore[index]
            ["modified", "cancelled"],
        )

    async def test_client_message_rate_limit_is_enforced(self) -> None:
        config = replace(
            companion_config(data_dir=Path(".test-connector-data")),
            max_messages_per_minute=2,
        )
        service = FtmoMt5Service(config)
        socket = _Socket()

        self.assertTrue(service.client_message_allowed(socket))
        self.assertTrue(service.client_message_allowed(socket))
        self.assertFalse(service.client_message_allowed(socket))


class _FakeMt5:
    def __init__(self, account: object) -> None:
        self.account = account
        self.initialize_calls: list[tuple[tuple[object, ...], dict[str, object]]] = []
        self.shutdown_calls = 0
        self.deals: list[object] = []
        self.DEAL_TYPE_BALANCE = 2

    def initialize(self, *args: object, **kwargs: object) -> bool:
        self.initialize_calls.append((args, kwargs))
        return True

    def account_info(self) -> object:
        return self.account

    def shutdown(self) -> None:
        self.shutdown_calls += 1

    def history_deals_get(self, *_args: object) -> list[object]:
        return self.deals


class _MultiTerminalMt5(_FakeMt5):
    def __init__(self, accounts: dict[str, object]) -> None:
        super().__init__(account=next(iter(accounts.values())))
        self.accounts = accounts

    def initialize(self, *args: object, **kwargs: object) -> bool:
        super().initialize(*args, **kwargs)
        path = str(args[0]) if args else ""
        account = self.accounts.get(path)
        if account is None:
            return False
        self.account = account
        return True


class ConnectorAdapterTests(unittest.TestCase):
    def test_attaches_to_logged_in_ftmo_without_login_or_config_path(self) -> None:
        account = SimpleNamespace(
            login=12345678,
            server="FTMO-Server4",
            company="FTMO S.R.O.",
            trade_allowed=True,
        )
        mt5 = _FakeMt5(account)
        adapter = Mt5Adapter(
            companion_config(data_dir=Path(".test-connector-data")),
            mt5_module=mt5,
            terminal_path_provider=lambda: [r"C:\Program Files\FTMO MT5\terminal64.exe"],
        )

        adapter.connect()

        self.assertTrue(adapter.initialized)
        self.assertEqual(
            mt5.initialize_calls,
            [
                (
                    (r"C:\Program Files\FTMO MT5\terminal64.exe",),
                    {"timeout": 8000},
                )
            ],
        )
        self.assertFalse(hasattr(mt5, "login"))
        self.assertIsNone(adapter.expected_account_error("12345678", "ftmo-server4"))

    def test_non_ftmo_account_is_not_accepted(self) -> None:
        mt5 = _FakeMt5(
            SimpleNamespace(
                login=7,
                server="OtherBroker-Live",
                company="Other Broker",
                trade_allowed=True,
            )
        )
        adapter = Mt5Adapter(
            companion_config(data_dir=Path(".test-connector-data")),
            mt5_module=mt5,
            terminal_path_provider=lambda: [],
        )

        with self.assertRaisesRegex(RuntimeError, "No logged-in FTMO"):
            adapter.connect()

    def test_selects_terminal_matching_backend_ticket_account(self) -> None:
        first_path = r"C:\FTMO-One\terminal64.exe"
        second_path = r"C:\FTMO-Two\terminal64.exe"
        mt5 = _MultiTerminalMt5(
            {
                first_path: SimpleNamespace(
                    login=111,
                    server="FTMO-Server3",
                    company="FTMO S.R.O.",
                    trade_allowed=True,
                ),
                second_path: SimpleNamespace(
                    login=222,
                    server="FTMO-Server4",
                    company="FTMO S.R.O.",
                    trade_allowed=True,
                ),
            }
        )
        adapter = Mt5Adapter(
            companion_config(data_dir=Path(".test-connector-data")),
            mt5_module=mt5,
            terminal_path_provider=lambda: [first_path, second_path],
        )

        adapter.connect("222", "ftmo-server4")

        self.assertEqual(adapter.attached_terminal_path, second_path)
        self.assertEqual(
            [call[0] for call in mt5.initialize_calls],
            [(first_path,), (second_path,)],
        )
        self.assertIsNone(adapter.expected_account_error("222", "FTMO-Server4"))

    def test_initial_balance_uses_earliest_funding_not_later_top_up(self) -> None:
        account = SimpleNamespace(
            login=12345678,
            server="FTMO-Server4",
            company="FTMO S.R.O.",
            trade_allowed=True,
        )
        mt5 = _FakeMt5(account)
        mt5.deals = [
            SimpleNamespace(type=mt5.DEAL_TYPE_BALANCE, profit=100_000, time=100),
            SimpleNamespace(type=mt5.DEAL_TYPE_BALANCE, profit=250_000, time=200),
        ]
        adapter = Mt5Adapter(
            companion_config(data_dir=Path(".test-connector-data")),
            mt5_module=mt5,
            terminal_path_provider=lambda: [r"C:\FTMO\terminal64.exe"],
        )
        adapter.connect("12345678", "FTMO-Server4")

        self.assertEqual(adapter.initial_balance_from_history(), 100_000)


class ConnectorEntrypointTests(unittest.TestCase):
    def test_defaults_are_loopback_ticket_authenticated_and_origin_limited(self) -> None:
        service = create_service([])
        self.assertEqual(service.config.host, "127.0.0.1")
        self.assertEqual(service.config.port, 8787)
        self.assertTrue(service.config.attached_account)
        self.assertEqual(
            service.allowed_origins, ("https://tradingterminal.io.vn",)
        )

    def test_companion_ignores_legacy_broker_environment(self) -> None:
        with patch.dict(
            os.environ,
            {
                "FTMO_MT5_LOGIN": "should-not-load",
                "FTMO_MT5_PASSWORD": "should-not-load",
                "FTMO_MT5_SERVER": "should-not-load",
                "FTMO_MT5_TERMINAL_PATH": r"C:\unsafe\terminal64.exe",
                "FTMO_BRIDGE_BIND_HOST": "0.0.0.0",
            },
        ):
            config = companion_config(data_dir=Path(".test-connector-data"))

        self.assertEqual(config.host, "127.0.0.1")
        self.assertEqual(config.login, "")
        self.assertEqual(config.password, "")
        self.assertEqual(config.server, "")
        self.assertEqual(config.terminal_path, "")

    def test_dev_origin_must_be_an_exact_http_origin(self) -> None:
        self.assertEqual(
            _allowed_origins(["http://localhost:3000/"]),
            ("https://tradingterminal.io.vn", "http://localhost:3000"),
        )
        with self.assertRaises(ValueError):
            _allowed_origins(["https://evil.example/path"])


class ConnectorRiskBaselineTests(unittest.TestCase):
    def test_persisted_account_baseline_measures_drawdown_after_restart(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "risk-baselines.json"
            config = companion_config(data_dir=Path(directory))
            guard = RiskGuard(config, state_path=path)

            first = guard.snapshot(
                95_000,
                account_key="111|ftmo-server3",
                balance=95_000,
                initial_balance=100_000,
            )
            guard.mark_order(
                "111|ftmo-server3",
                balance=95_000,
                equity=95_000,
                initial_balance=100_000,
            )
            self.assertEqual(first["maxLossUsed"], 5_000)
            self.assertEqual(first["accountSizeSource"], "mt5_balance_history")

            restored = RiskGuard(config, state_path=path)
            later = restored.snapshot(
                94_000,
                account_key="111|ftmo-server3",
                balance=94_000,
            )
            other = restored.snapshot(
                25_000,
                account_key="222|ftmo-server4",
                balance=25_000,
                initial_balance=25_000,
            )

            self.assertEqual(later["maxReferenceBalance"], 100_000)
            self.assertEqual(later["maxLossUsed"], 6_000)
            self.assertEqual(later["dailyReferenceBalance"], 100_000)
            self.assertEqual(later["dailyLossThreshold"], 97_000)
            self.assertEqual(later["dailyLossUsed"], 6_000)
            self.assertEqual(later["dailyLossRemaining"], 0)
            self.assertEqual(later["dailyOrderCount"], 1)
            self.assertEqual(other["maxReferenceBalance"], 25_000)
            self.assertEqual(other["dailyOrderCount"], 0)

    def test_companion_daily_limit_defaults_to_three_percent(self) -> None:
        self.assertEqual(
            companion_config(data_dir=Path(".test-connector-data")).max_daily_loss_pct,
            3,
        )

    def test_loss_amount_stays_based_on_initial_capital(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            guard = RiskGuard(
                companion_config(data_dir=Path(directory)),
                state_path=Path(directory) / "risk-baselines.json",
            )
            first = guard.snapshot(
                110_000,
                account_key="111|ftmo-server3",
                balance=110_000,
                initial_balance=100_000,
            )
            dropped = guard.snapshot(
                99_000,
                account_key="111|ftmo-server3",
                balance=99_000,
                initial_balance=100_000,
            )

            self.assertEqual(first["maxReferenceBalance"], 110_000)
            self.assertEqual(first["maxLossLimit"], 10_000)
            self.assertEqual(first["maxLossThreshold"], 100_000)
            self.assertEqual(dropped["maxLossRemaining"], 0)
            self.assertFalse(dropped["canTrade"])

    def test_corrupt_or_unsafe_persisted_baseline_fails_closed(self) -> None:
        unsafe_payload = {
            "version": 2,
            "accounts": {
                "111|ftmo-server3": {
                    "day": "2026-07-20",
                    "initial_capital": 100_000,
                    "daily_reference_balance": 90_000,
                    "max_reference_balance": 90_000,
                    "orders": 0,
                    "initial_source": "runtime_balance",
                }
            },
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "risk-baselines.json"
            path.write_text(json.dumps(unsafe_payload), encoding="utf-8")

            guard = RiskGuard(
                companion_config(data_dir=Path(directory)), state_path=path
            )
            snapshot = guard.snapshot(
                100_000,
                account_key="111|ftmo-server3",
                balance=100_000,
            )

            self.assertFalse(snapshot["baselinePersisted"])
            self.assertFalse(snapshot["canTrade"])
            self.assertEqual(
                snapshot["reason"], "Account risk baseline is not safely persisted"
            )

    def test_prague_trading_day_uses_cet_and_cest(self) -> None:
        self.assertEqual(
            _prague_trading_day(datetime(2026, 1, 1, 22, 30, tzinfo=timezone.utc)),
            "2026-01-01",
        )
        self.assertEqual(
            _prague_trading_day(datetime(2026, 7, 1, 22, 30, tzinfo=timezone.utc)),
            "2026-07-02",
        )


if __name__ == "__main__":
    unittest.main()
